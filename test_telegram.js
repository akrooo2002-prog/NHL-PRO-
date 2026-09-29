// Test du bot Telegram : on exécute le VRAI handler de netlify/functions/telegram.js
// en ne simulant que le réseau (index.json lu depuis dist/, sendMessage capturé).
const fs = require("fs");
const path = require("path");

process.env.TELEGRAM_BOT_TOKEN = "TEST-TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "TEST-SECRET";
process.env.TELEGRAM_OWNER_ID = "4242";
const { handler } = require("./netlify/functions/telegram.js");

const INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, "dist/data/index.json"), "utf8"));
let envois = [];
global.fetch = async (url, opts) => {
  url = String(url);
  if (url.includes("/data/index.json")) return { ok: true, status: 200, json: async () => INDEX };
  const mj = url.match(/\/data\/jour-([\d-]+)\.json/);
  if (mj) {
    const f = path.join(__dirname, "dist/data/jour-" + mj[1] + ".json");
    if (!fs.existsSync(f)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
  }
  if (url.includes("sendMessage")) {
    const body = JSON.parse(opts.body);
    envois.push(body);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  throw new Error("fetch non simulé : " + url);
};

const hdr = { "x-telegram-bot-api-secret-token": "TEST-SECRET", "content-type": "application/json" };
let n = 0, echecs = 0;
function ok(cond, msg) { n++; if (!cond) { echecs++; console.log("ECHEC : " + msg); } else console.log("ok — " + msg); }

async function dire(text, chatId) {
  chatId = chatId === undefined ? 4242 : chatId;
  envois = [];
  const up = { update_id: 1, message: { message_id: 1, chat: { id: chatId }, text } };
  const r = await handler({ httpMethod: "POST", headers: hdr, body: JSON.stringify(up) });
  return { r, textes: envois.map((e) => e.text).join("\n"), morceaux: envois.length };
}

(async () => {
  // 1. santé
  const g = await handler({ httpMethod: "GET", headers: {} });
  ok(g.statusCode === 200 && JSON.parse(g.body).bot === true, "GET santé : bot configuré");

  // 2. sécurité : mauvais secret rejeté
  const bad = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ message: { chat: { id: 4242 }, text: "buteur" } }) });
  ok(bad.statusCode === 401, "webhook : secret invalide → 401");

  // 3. sécurité : autre utilisateur ignoré
  const autre = await dire("buteur", 999);
  ok(autre.r.statusCode === 200 && autre.morceaux === 0, "accès restreint : autre chat ignoré");

  // 4. aide
  const aide = await dire("/start");
  ok(aide.textes.includes("Filtres") && aide.textes.includes("outsider"), "/start → aide complète");

  // 5. liste des matchs
  const liste = await dire("matchs");
  ok(/1\. [A-Z]{2,4} @ [A-Z]{2,4}/.test(liste.textes), "« matchs » → liste numérotée du jour");

  // 6. filtres du site : buteur + outsider sur une équipe
  const q1 = await dire("buteur outsider FLA");
  ok(q1.textes.includes("BUTEUR (1+ BUT)") && q1.textes.includes("🔵 FLA"), "« buteur FLA » → top 3 FLA");
  ok(/OUTSIDERS/.test(q1.textes) && /forme|réussit|tir froid|hausse|carrière/.test(q1.textes), "« outsider » → outsiders justifiés");
  ok(!q1.textes.includes("PASSEUR"), "pas de marché non demandé");

  // 7. marchés à seuils + chances combinées, tous les matchs
  const q2 = await dire("2buts 3points double chance tout");
  ok(q2.textes.includes("DOUBLE BUTEUR") && q2.textes.includes("TRIPLE BUTEUR") === false, "« 2buts » seul ne déclenche pas 3buts");
  ok(q2.textes.includes("DOUBLE CHANCE") && q2.textes.includes("🎲") && q2.textes.includes("ou "), "« double chance » → 1 des 2 buteurs + probabilité combinée");
  ok(!q2.textes.includes("OUTSIDERS"), "outsider absent quand non demandé");

  // 8. triple chance + podium
  const q3 = await dire("triple chance podium");
  ok(q3.textes.includes("🥇") && q3.textes.includes("PODIUM"), "« podium » → top 3 du jour");

  // 9. numéros de match + date
  const q4 = await dire("pointeur match 1");
  const nb = (q4.textes.match(/🏒/g) || []).length;
  ok(nb === 1 && q4.textes.includes("POINTEUR"), "« match 1 » → un seul match");

  // 10. défaut = buteur + pointeur (comme le site)
  const q5 = await dire("FLA");
  ok(q5.textes.includes("BUTEUR") && q5.textes.includes("POINTEUR") && !q5.textes.includes("PASSEUR"), "équipe seule → buteur+pointeur par défaut");

  // 11. date inconnue
  const q6 = await dire("buteur 2030-01-01");
  ok(q6.textes.includes("Pas d'analyse"), "date inconnue → message clair");

  // 12. /dates
  const q7 = await dire("/dates");
  ok((q7.textes.match(/20\d\d-\d\d-\d\d/g) || []).length >= 5, "/dates → jours analysés");

  // 13. découpage : tout × tous les filtres tient dans les limites Telegram
  const q8 = await dire("buteur passeur pointeur 2buts 3buts 2points 3points double chance triple chance outsider tout");
  ok(q8.morceaux >= 1 && envois.every((e) => e.text.length <= 4096), "requête maximale : " + q8.morceaux + " messages, tous ≤ 4096 caractères");
  ok(q8.textes.includes("OUTSIDERS") && q8.textes.includes("TRIPLE CHANCE"), "requête maximale : tous les filtres présents");

  console.log(echecs === 0 ? "RESULTAT BOT TELEGRAM : TOUT EST OK (" + n + " vérifications)"
                           : "RESULTAT BOT TELEGRAM : " + echecs + " ECHECS / " + n);
  process.exit(echecs === 0 ? 0 : 1);
})();

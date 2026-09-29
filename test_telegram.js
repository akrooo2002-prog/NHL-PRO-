// Test du bot Telegram : on exécute le VRAI handler de netlify/functions/telegram.js
// en ne simulant que le réseau (données lues depuis dist/, appels Telegram capturés).
const fs = require("fs");
const path = require("path");

process.env.TELEGRAM_BOT_TOKEN = "TEST-TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "TEST-SECRET";
process.env.TELEGRAM_OWNER_ID = "4242";
const { handler } = require("./netlify/functions/telegram.js");

const INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, "dist/data/index.json"), "utf8"));
let apis = [];   // { methode, body } de tous les appels à api.telegram.org
global.fetch = async (url, opts) => {
  url = String(url);
  if (url.includes("/data/index.json")) return { ok: true, status: 200, json: async () => INDEX };
  const mj = url.match(/\/data\/jour-([\d-]+)\.json/);
  if (mj) {
    const f = path.join(__dirname, "dist/data/jour-" + mj[1] + ".json");
    if (!fs.existsSync(f)) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
  }
  const mt = url.match(/api\.telegram\.org\/bot[^/]+\/(\w+)/);
  if (mt) {
    apis.push({ methode: mt[1], body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  }
  throw new Error("fetch non simulé : " + url);
};

const hdr = { "x-telegram-bot-api-secret-token": "TEST-SECRET", "content-type": "application/json" };
let n = 0, echecs = 0;
function ok(cond, msg) { n++; if (!cond) { echecs++; console.log("ECHEC : " + msg); } else console.log("ok — " + msg); }
const envois = () => apis.filter((a) => a.methode === "sendMessage").map((a) => a.body);
const textes = () => envois().map((b) => b.text).join("\n");
const dernierClavier = () => { const e = envois(); return e.length ? e[e.length - 1].reply_markup : null; };
const editions = () => apis.filter((a) => a.methode === "editMessageText").map((a) => a.body);
const btns = (kb) => (kb && kb.inline_keyboard ? [].concat(...kb.inline_keyboard).map((b) => b.text + "|" + b.callback_data) : []);

async function dire(text, chatId) {
  apis = [];
  const up = { update_id: 1, message: { message_id: 1, chat: { id: chatId === undefined ? 4242 : chatId }, text } };
  const r = await handler({ httpMethod: "POST", headers: hdr, body: JSON.stringify(up) });
  return { r, textes: textes(), morceaux: envois().length, clavier: dernierClavier() };
}
async function clique(data, userId) {
  apis = [];
  const up = { update_id: 2, callback_query: { id: "CB-1", from: { id: userId === undefined ? 4242 : userId },
    data, message: { message_id: 7, chat: { id: 4242 } } } };
  const r = await handler({ httpMethod: "POST", headers: hdr, body: JSON.stringify(up) });
  return { r, edite: editions(), textes: textes(), clavier: editions().length ? editions()[editions().length - 1].reply_markup : dernierClavier() };
}

(async () => {
  /* ---------- sécurité ---------- */
  const g = await handler({ httpMethod: "GET", headers: {} });
  ok(g.statusCode === 200 && JSON.parse(g.body).bot === true, "GET santé : bot configuré");
  const bad = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify({ message: { chat: { id: 4242 }, text: "buteur" } }) });
  ok(bad.statusCode === 401, "webhook : secret invalide → 401");
  const autre = await dire("buteur", 999);
  ok(autre.r.statusCode === 200 && autre.morceaux === 0, "accès restreint : autre chat ignoré");
  const autreCb = await clique("F:13@0", 999);
  ok(autreCb.r.statusCode === 200 && autreCb.edite.length === 0, "accès restreint : autre utilisateur ignoré sur les boutons");

  /* ---------- /start = mini-app ---------- */
  const st = await dire("/start");
  const kb0 = st.clavier;
  ok(st.textes.includes("NHL Pronos") && !!kb0, "/start → accueil + clavier");
  const ids0 = btns(kb0).map((x) => x.split("|")[1]);
  ok(ids0.some((d) => d.startsWith("F:")) && ids0.some((d) => d.startsWith("G:"))
     && ids0.some((d) => d.startsWith("P:")) && ids0.some((d) => d.startsWith("K:")),
     "menu : onglets Filtres / Matchs / Podium / Jour");
  ok(apis.some((a) => a.methode === "sendMessage"), "/start envoyé en 1 message");

  /* ---------- onglet Filtres ---------- */
  const f = await clique("F:13@0");
  ok(f.edite.length === 1 && f.edite[0].text.includes("Filtres"), "⚙️ Filtres → édition du message (effet mini-app)");
  ok(apis.some((a) => a.methode === "answerCallbackQuery"), "clic acquitté (answerCallbackQuery)");
  const bf = btns(f.clavier);
  ok(bf.some((b) => b.startsWith("✅ Buteur")) && bf.some((b) => b.startsWith("✅ Pointeur"))
     && bf.some((b) => b.startsWith("◻️ Outsider")), "filtres par défaut : buteur ✅ pointeur ✅ outsider ◻️");
  ok(bf.some((b) => b.includes("L:13@0")), "bouton 🚀 Lancer présent");

  /* ---------- cocher outsider ---------- */
  const t = await clique("T:13@0:0");
  ok(btns(t.clavier).some((b) => b.startsWith("✅ Outsider")), "clic ◻️ Outsider → ✅ Outsider");
  const t2 = await clique("T:130@0:0");   // re-clic = décoche
  ok(btns(t2.clavier).some((b) => b.startsWith("◻️ Outsider")), "re-clic → décoché");
  const t3 = await clique("T:1@0:1");     // décocher le dernier restant
  ok(btns(t3.clavier).some((b) => b.startsWith("✅ Buteur")), "impossible de tout décocher");

  /* ---------- 🚀 lancer avec buteur+pointeur+outsider ---------- */
  const l = await clique("L:130@0");
  ok(l.textes.includes("BUTEUR") && l.textes.includes("POINTEUR") && l.textes.includes("OUTSIDERS"),
     "🚀 → résultats avec les 3 filtres cochés");
  ok(l.textes.includes("🎲") === false, "double chance absente quand non cochée");
  ok(!!l.clavier && btns(l.clavier).some((b) => b.split("|")[1].startsWith("F:")), "résultats → clavier menu principal en bas");

  /* ---------- 🗓 matchs : grille puis un match ---------- */
  const gr = await clique("G:13@0");
  const bg = btns(gr.clavier);
  ok(gr.edite.length === 1 && bg.some((b) => b.includes("S:13@0:1")) && bg.some((b) => b.includes("S:13@0:0")),
     "🗓 → grille des matchs + « tous les matchs »");
  const s1 = await clique("S:13@0:1");
  ok((s1.textes.match(/🏒/g) || []).length === 1, "clic sur un match → 1 seul match analysé");
  const s0 = await clique("S:13@0:0");
  ok((s0.textes.match(/🏒/g) || []).length >= 3, "« tous les matchs » → toute la journée");

  /* ---------- podium, jour, aide ---------- */
  const p = await clique("P:13@0");
  ok(p.textes.includes("🥇") && p.textes.includes("PODIUM"), "🏆 → podium du jour");
  const k = await clique("K:13@0");
  const bk = btns(k.clavier);
  ok(bk.some((b) => b.includes("D:13@")) && bk.some((b) => b.includes("aujourd'hui")), "📅 → sélecteur de jour");
  const dd = await clique("D:13@1");
  ok(dd.edite.length === 1 && dd.edite[0].text.includes("NHL Pronos"), "jour choisi → retour au menu mis à jour");
  const l2 = await clique("L:13@1");
  const date2 = (l2.textes.match(/📅 <b>([\d-]+)<\/b>/) || [])[1];
  const ds = [...new Set(INDEX.games.map((x) => x.date))].sort();
  const t0 = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const defaut = ds.find((x) => x >= t0) || ds[ds.length - 1];
  ok(date2 === ds[Math.min(ds.indexOf(defaut) + 1, ds.length - 1)], "« demain » pris en compte dans les résultats");
  const a = await clique("A");
  ok(a.textes.includes("Filtres") && a.textes.includes("outsider"), "❓ Aide → texte d'aide");

  /* ---------- le texte libre marche toujours ---------- */
  const q1 = await dire("buteur outsider FLA");
  ok(q1.textes.includes("BUTEUR (1+ BUT)") && q1.textes.includes("🔵 FLA") && /OUTSIDERS/.test(q1.textes),
     "texte libre : « buteur outsider FLA » inchangé");
  const q2 = await dire("2buts 3points double chance tout");
  ok(q2.textes.includes("DOUBLE BUTEUR") && !q2.textes.includes("TRIPLE BUTEUR") && q2.textes.includes("🎲"),
     "texte libre : seuils + double chance");
  const q3 = await dire("matchs");
  ok(/1\. [A-Z]{2,4} @ [A-Z]{2,4}/.test(q3.textes), "texte libre : liste des matchs");
  const q4 = await dire("FLA");
  ok(q4.textes.includes("BUTEUR") && q4.textes.includes("POINTEUR") && !q4.textes.includes("PASSEUR"),
     "texte libre : équipe seule → buteur+pointeur");
  const q5 = await dire("buteur 2030-01-01");
  ok(q5.textes.includes("Pas d'analyse"), "texte libre : date inconnue");
  const q6 = await dire("/dates");
  ok((q6.textes.match(/20\d\d-\d\d-\d\d/g) || []).length >= 5, "texte libre : /dates");

  /* ---------- limites Telegram ---------- */
  const q7 = await dire("buteur passeur pointeur 2buts 3buts 2points 3points double chance triple chance outsider tout");
  ok(envois().every((e) => e.text.length <= 4096) && q7.morceaux >= 1,
     "requête maximale : " + q7.morceaux + " messages, tous ≤ 4096");
  const toutesData = ["F:1234567890@34", "T:1234567890@34:0", "S:1234567890@34:15", "L:1234567890@34", "D:1234567890@34", "K:1234567890@34"];
  ok(toutesData.every((d) => d.length <= 64), "callback_data ≤ 64 octets (limite Telegram)");

  console.log(echecs === 0 ? "RESULTAT BOT TELEGRAM : TOUT EST OK (" + n + " vérifications)"
                           : "RESULTAT BOT TELEGRAM : " + echecs + " ECHECS / " + n);
  process.exit(echecs === 0 ? 0 : 1);
})();

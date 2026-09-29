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
  ok(autre.r.statusCode === 200 && autre.textes.includes("Accès privé") && autre.textes.includes("999"),
     "accès restreint : l'inconnu reçoit son ID pour demander l'accès");
  ok(!autre.textes.includes("BUTEUR"), "accès restreint : aucune donnée pour l'inconnu");
  const autreCb = await clique("F:13@0", 999);
  ok(autreCb.r.statusCode === 200 && autreCb.edite.length === 0
     && apis.some((a) => a.methode === "answerCallbackQuery" && a.body && a.body.text === "🔒 Accès privé"),
     "accès restreint : bouton → alerte « Accès privé », rien d'autre");
  process.env.TELEGRAM_OWNER_ID = "4242,777";                  // liste d'accès multiple
  const ami = await dire("podium", 777);
  ok(ami.textes.includes("🥇"), "accès multiple : l'ami autorisé (777) reçoit les données");
  process.env.TELEGRAM_OWNER_ID = "4242";

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
  ok(a.textes.includes("Commandes") && a.textes.includes("outsider"), "❓ Aide → texte d'aide");

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
  const q7 = await dire("buteur passeur pointeur 2buts 3buts 2points 3points double chance triple chance duo trio outsider outsider buteur outsider pointeur tout");
  ok(envois().every((e) => e.text.length <= 4096) && q7.morceaux >= 1,
     "requête maximale : " + q7.morceaux + " messages, tous ≤ 4096");
  const toutesData = ["F:1234567890@34", "T:1234567890@34:0", "S:1234567890@34:15", "L:1234567890@34", "D:1234567890@34", "K:1234567890@34"];
  ok(toutesData.every((d) => d.length <= 64), "callback_data ≤ 64 octets (limite Telegram)");

  /* ---------- toutes les commandes slash ---------- */
  const cB = await dire("/buteur");
  ok(cB.textes.includes("BUTEUR") && !cB.textes.includes("PASSEUR"), "/buteur → buteurs seulement");
  const cP = await dire("/passeur");
  ok(cP.textes.includes("PASSEUR"), "/passeur → passeurs");
  const cPt = await dire("/pointeur");
  ok(cPt.textes.includes("POINTEUR"), "/pointeur → pointeurs");
  const cO = await dire("/outsider");
  ok(cO.textes.includes("OUTSIDERS"), "/outsider → outsiders justifiés");
  const cD = await dire("/doublechance");
  ok(cD.textes.includes("DOUBLE CHANCE") && cD.textes.includes("🎲"), "/doublechance → 1 des 2");
  const cT = await dire("/triplechance");
  ok(cT.textes.includes("TRIPLE CHANCE"), "/triplechance → 1 des 3");
  const cDem = await dire("/demain");
  const dateDem = (cDem.textes.match(/📅 <b>([\d-]+)<\/b>/) || [])[1];
  ok(dateDem === ds[Math.min(ds.indexOf(defaut) + 1, ds.length - 1)], "/demain → jour suivant");
  const cA = await dire("/aide");
  ok(cA.textes.includes("Commandes") && cA.textes.includes("/doublechance") && cA.textes.includes("outsider"),
     "/aide → liste complète des commandes");
  const cM = await dire("/matchs");
  ok(/1\. [A-Z]{2,4} @ [A-Z]{2,4}/.test(cM.textes), "/matchs → liste du jour");
  const cPod = await dire("/podium");
  ok(cPod.textes.includes("🥇"), "/podium → top 3");
  const cDa = await dire("/dates");
  ok((cDa.textes.match(/20\d\d-\d\d-\d\d/g) || []).length >= 5, "/dates → jours analysés");

  /* ---------- nouveaux filtres : duo/trio 1,5 buts + outsiders par marché ---------- */
  const cDuo = await dire("duo trio tout");
  ok(cDuo.textes.includes("DUO 1,5 BUTS") && cDuo.textes.includes("TRIO 1,5 BUTS"),
     "« duo trio » → blocs 2+ buts cumulés");
  ok(cDuo.textes.includes("⚔️") && / \+ /.test(cDuo.textes), "duo/trio : noms joints par « + »");
  const cOB = await dire("outsider buteur tout");
  ok(cOB.textes.includes("OUTSIDER BUTEUR") && !cOB.textes.includes("OUTSIDER POINTEUR"),
     "« outsider buteur » → marché buteur seul (pas de confusion avec buteur seul)");
  ok(/OUTSIDER BUTEUR[\s\S]*?n°\d/.test(cOB.textes), "outsider buteur : rang affiché");
  const cOP = await dire("outsider pointeur tout");
  ok(cOP.textes.includes("OUTSIDER POINTEUR"), "« outsider pointeur »");
  const cSD = await dire("/duo");
  ok(cSD.textes.includes("DUO 1,5"), "/duo → bloc duo");
  const cST = await dire("/trio");
  ok(cST.textes.includes("TRIO 1,5"), "/trio → bloc trio");
  const cSOB = await dire("/outsiderbuteur");
  ok(cSOB.textes.includes("OUTSIDER BUTEUR"), "/outsiderbuteur");
  const cSOP = await dire("/outsiderpointeur");
  ok(cSOP.textes.includes("OUTSIDER POINTEUR"), "/outsiderpointeur");
  const f2 = await clique("F:13@0");
  const txtB = btns(f2.clavier).map((b) => b.split("|")[0]).join(" ");
  ok(txtB.includes("Duo 1,5") && txtB.includes("Trio 1,5") && txtB.includes("Outsider buteur")
     && txtB.includes("Outsider pointeur"), "clavier ⚙️ : les 4 nouveaux filtres sont cochables");
  const tg1 = await clique("T:13@0:c");
  ok(btns(tg1.clavier).some((b) => b.startsWith("✅ Duo")), "bouton : cocher Duo 1,5 buts");
  const lAll = await clique("L:1234567890cdab@0");
  ok(lAll.textes.includes("DUO 1,5") && lAll.textes.includes("TRIO 1,5")
     && lAll.textes.includes("OUTSIDER BUTEUR") && lAll.textes.includes("OUTSIDER POINTEUR"),
     "🚀 tout coché → les 14 filtres d'un coup");
  ok(["T:1234567890cdab@34:0", "L:1234567890cdab@34", "S:1234567890cdab@34:15"].every((d) => d.length <= 64),
     "callback_data 14 filtres ≤ 64 octets");

  console.log(echecs === 0 ? "RESULTAT BOT TELEGRAM : TOUT EST OK (" + n + " vérifications)"
                           : "RESULTAT BOT TELEGRAM : " + echecs + " ECHECS / " + n);
  process.exit(echecs === 0 ? 0 : 1);
})();

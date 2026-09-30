// Test du bot sur Cloudflare Worker : on exécute le VRAI handler exporté par
// worker/telegram.js, en ne simulant que le réseau (données de dist/, appels
// Telegram capturés). Mêmes vérifications clés que test_telegram.js.
const fs = require("fs");
const path = require("path");
const os = require("os");

const INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, "dist/data/index.json"), "utf8"));
let apis = [];
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

const ENV = { TELEGRAM_BOT_TOKEN: "TEST-TOKEN", TELEGRAM_WEBHOOK_SECRET: "TEST-SECRET", TELEGRAM_OWNER_ID: "4242" };
let n = 0, echecs = 0;
function ok(cond, msg) { n++; if (!cond) { echecs++; console.log("ECHEC : " + msg); } else console.log("ok — " + msg); }
const envois = () => apis.filter((a) => a.methode === "sendMessage").map((a) => a.body);
const textes = () => envois().map((b) => b.text).join("\n");
const dernierClavier = () => { const e = envois(); return e.length ? e[e.length - 1].reply_markup : null; };
const editions = () => apis.filter((a) => a.methode === "editMessageText").map((a) => a.body);

async function appel(update, secret) {
  apis = [];
  const headers = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret === undefined ? "TEST-SECRET" : secret;
  const req = new Request("https://bot.example/telegram", { method: "POST", headers, body: JSON.stringify(update) });
  const r = await WORKER.fetch(req, ENV);
  return { status: r.status, corps: await r.json() };
}
const dire = async (text, chatId) => { const r = await appel({ update_id: 1, message: { message_id: 1, chat: { id: chatId === undefined ? 4242 : chatId }, text } }); return { r, textes: textes(), clavier: dernierClavier(), morceaux: envois().length }; };
const clique = async (data, userId) => { const r = await appel({ update_id: 2, callback_query: { id: "CB", from: { id: userId === undefined ? 4242 : userId }, data, message: { message_id: 7, chat: { id: 4242 } } } }); return { r, edite: editions(), textes: textes(), clavier: editions().length ? editions()[editions().length - 1].reply_markup : dernierClavier() }; };

// le worker est un module ESM : on l'importe via une copie .mjs temporaire
const tmp = path.join(os.tmpdir(), "worker-telegram-test.mjs");
fs.copyFileSync(path.join(__dirname, "worker/telegram.js"), tmp);
let WORKER;

(async () => {
  WORKER = (await import("file://" + tmp)).default;

  const g = await WORKER.fetch(new Request("https://bot.example/telegram"), ENV);
  const gc = await g.json();
  ok(g.status === 200 && gc.bot === true, "GET santé : bot configuré");

  const bad = await appel({ message: { chat: { id: 4242 }, text: "buteur" } }, "MAUVAIS");
  ok(bad.status === 401, "webhook : secret invalide → 401");

  const autre = await dire("buteur", 999);
  ok(autre.textes.includes("Accès privé") && autre.textes.includes("999"), "accès restreint : l'inconnu reçoit son ID");

  const st = await dire("/start");
  ok(st.textes.includes("NHL Pronos") && !!st.clavier && st.clavier.inline_keyboard.length >= 3, "/start → accueil + mini-app");

  const ds = [...new Set(INDEX.games.map((x) => x.date))].sort();
  const t0 = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const defaut = ds.find((x) => x >= t0) || ds[ds.length - 1];
  const jeuTest = INDEX.games.filter((x) => x.date === defaut && (x.outsiders || []).length)[0] || INDEX.games.filter((x) => x.date === defaut)[0];
  const eq = jeuTest.away;

  const q1 = await dire("buteur outsider " + eq);
  ok(q1.textes.includes("BUTEUR (1+ BUT)") && /OUTSIDERS/.test(q1.textes), "texte libre : buteur + outsider (" + eq + ")");

  const q2 = await dire("duo trio double chance tout");
  ok(q2.textes.includes("DUO 1,5 BUTS") && q2.textes.includes("TRIO 1,5 BUTS") && q2.textes.includes("DOUBLE CHANCE"), "duo + trio + double chance");

  const f = await clique("F:13@0");
  ok(f.edite.length === 1 && f.edite[0].text.includes("Filtres") && apis.some((a) => a.methode === "answerCallbackQuery"), "bouton ⚙️ Filtres → édition + acquittement");

  const l = await clique("L:130@0");
  ok(l.textes.includes("BUTEUR") && l.textes.includes("OUTSIDERS") && !!l.clavier, "bouton 🚀 → résultats + menu");

  const p = await clique("P:13@0");
  ok(p.textes.includes("🥇"), "bouton 🏆 → podium");

  const q3 = await dire("podium");
  ok(q3.textes.includes("PODIUM"), "texte libre : podium");

  console.log(echecs === 0 ? "RESULTAT WORKER CLOUDFLARE : TOUT EST OK (" + n + " vérifications)"
                           : "RESULTAT WORKER CLOUDFLARE : " + echecs + " ECHECS / " + n);
  process.exit(echecs === 0 ? 0 : 1);
})();

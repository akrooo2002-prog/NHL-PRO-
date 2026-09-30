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

const kvStore = new Map();
const GARDIENS = {
  async list(o) { const pfx = (o && o.prefix) || ""; return { keys: [...kvStore.keys()].filter((k) => k.startsWith(pfx)).map((k) => ({ name: k, metadata: kvStore.get(k) })) }; },
  async put(k, v, o) { kvStore.set(k, (o && o.metadata) || {}); },
  async delete(k) { kvStore.delete(k); },
};
const ENV = { TELEGRAM_BOT_TOKEN: "TEST-TOKEN", TELEGRAM_WEBHOOK_SECRET: "TEST-SECRET", TELEGRAM_OWNER_ID: "4242", GARDIENS };
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

  // ---------- gardiens : annonce, saisie, adaptation fidèle ----------
  const gk1 = await dire("gardien");
  ok(gk1.textes.includes("🥅") && /(probable|confirmé)/.test(gk1.textes) && gk1.textes.includes("gardien VAN Demko"),
    "gardien : annonce des partants probables");

  const pctT = (x) => (Math.round(x * 1000) / 10).toFixed(1).replace(".", ",") + " %";
  const svMoy = INDEX.league.savePctAvg;
  const confT = (prob, gp, flags, preseason) => {
    const cR = 100 * Math.pow(Math.max(0, Math.min(1, prob)), 0.55);
    let cD = 100;
    if (gp < 20) cD = 42 + 58 * (gp / 20); else if (gp < 45) cD = 82 + 18 * ((gp - 20) / 25);
    if (flags.includes("absent")) cD *= 0.30; else if (flags.includes("hors_echantillon")) cD *= 0.90;
    if (flags.includes("echantillon")) cD *= 0.88;
    if (flags.includes("b2b")) cD *= 0.93;
    if (preseason) cD *= 0.80;
    return 0.80 * cR + 0.20 * cD;
  };
  const jr1 = (x, nd) => { const f = Math.pow(10, nd); return Math.floor(x * f + 0.5) / f; };
  const poisT = (lam, k) => { if (lam <= 0) return 0; let s2 = 0, t = Math.exp(-lam); for (let i = 0; i < k; i++) { s2 += t; t *= lam / (i + 1); } return Math.max(0, 1 - s2); };

  // un match du jour par défaut avec un gardien remplaçant DIFFÉRENT du probable
  const jd = JSON.parse(fs.readFileSync(path.join(__dirname, "dist/data/jour-" + defaut + ".json"), "utf8"));
  const joueursDe = (id) => ((jd.games.find((x) => String(x.id) === String(id)) || {}).players) || [];
  const jeuxDefaut = INDEX.games.filter((g) => g.date === defaut);
  let cible = null;
  jeuxDefaut.forEach((g) => {
    if (cible || !g.ctx || !g.ctx.away || !g.ctx.away.goalie) return;
    const alt = (INDEX.goalieList[g.home] || []).find((x) => x.playerId !== g.ctx.away.goalie.playerId && x.sv);
    if (alt && joueursDe(g.id).some((p) => p.abbr === g.away && p.lambdaSansGardien && !p.recrue && p.buteur && p.buteur.rank))
      cible = { g, alt, n: jeuxDefaut.indexOf(g) + 1 };
  });
  ok(!!cible, "données : un match avec gardien alternatif trouvable");
  if (cible) {
    const { g, alt, n: num } = cible;
    const fN = Math.max(0.5, Math.min(1.8, (1 - alt.sv) / (1 - svMoy)));
    const rows = joueursDe(g.id).filter((p) => p.abbr === g.away && p.buteur).map((p) => {
      if (!p.lambdaSansGardien || p.recrue)
        return { p, gP: p.buteur.prob, pP: p.pointeur.prob, sG: p.buteur.score, sP: p.pointeur.score, cG: p.buteur.confidence, cP: p.pointeur.confidence, lamG: p.buteur.lam };
      const ng = p.lambdaSansGardien.g * fN;
      const naL = (p.lambdaSansGardien.a - 0.6 * p.lambda.g) * fN + 0.6 * ng;
      const np = ng + naL;
      const gP = Math.round((1 - Math.exp(-ng)) * 10000) / 10000;
      const pP = Math.round((1 - Math.exp(-np)) * 10000) / 10000;
      const sG = jr1(100 * gP, 1), sP = jr1(100 * pP, 1);
      return { p, gP, pP, sG, sP, lamG: jr1(ng, 3),
        cG: sG > 0 ? jr1(confT(gP, p.gp, p.flags || [], !!g.preseason), 1) : 0,
        cP: sP > 0 ? jr1(confT(pP, p.gp, p.flags || [], !!g.preseason), 1) : 0 };
    });
    const topB = rows.filter((r) => r.sG > 0).sort((a, b) => b.cG - a.cG || b.sG - a.sG || (a.p.name < b.p.name ? -1 : 1));
    const topP = rows.filter((r) => r.sP > 0).sort((a, b) => b.cP - a.cP || b.sP - a.sP || (a.p.name < b.p.name ? -1 : 1));

    const set = await dire("gardien " + g.home + " " + alt.name);
    ok(set.textes.includes("pris en compte") && set.textes.includes(alt.name.split(" ").slice(-1)[0]),
      "saisie « gardien " + g.home + " … » : confirmation");
    ok(set.textes.includes("🧤"), "saisie : entête 🧤 analyses adaptées");
    const top3B = topB.slice(0, 3);
    ok(top3B.every((r) => set.textes.includes(r.p.name) && set.textes.includes(pctT(r.gP))),
      "adaptation : top 3 buteur EXACT (λ recalculées) — " + top3B.map((r) => r.p.name + " " + pctT(r.gP)).join(" | "));
    ok(set.textes.includes(topP[0].p.name) && set.textes.includes(pctT(topP[0].pP)),
      "adaptation : n°1 pointeur EXACT (formule passes) — " + topP[0].p.name + " " + pctT(topP[0].pP));

    const duoLam = topB[0].lamG + topB[1].lamG;
    const duoPct = pctT(Math.round(poisT(duoLam, 2) * 10000) / 10000);
    const dq = await dire("duo match " + num);
    ok(dq.textes.includes(duoPct), "adaptation : duo 1,5 recalculé EXACT (" + duoPct + ")");

    const pers = await dire("buteur match " + num);
    ok(pers.textes.includes(top3B[0].p.name) && pers.textes.includes(pctT(top3B[0].gP)) && pers.textes.includes("🧤"),
      "persistance : « buteur match » du jour reste adapté");

    const ann = await dire("gardien annule " + g.home);
    ok(ann.textes.includes("retour à l'annonce"), "annulation : confirmation");
    // les rangs sont globaux au match (les 2 équipes) : on prend le mieux classé de l'équipe
    const av = joueursDe(g.id).filter((p) => p.abbr === g.away && p.buteur && p.buteur.rank)
      .sort((x, y) => x.buteur.rank - y.buteur.rank)[0];
    const rev = await dire("buteur match " + num);
    ok(rev.textes.includes(pctT(av.buteur.prob)) && !rev.textes.includes("🧤"),
      "annulation : probabilités d'origine restaurées");
  }
  const yb = await clique("Y:13@0");
  ok(yb.textes.includes("🥅") && !!yb.clavier, "bouton 🥅 Gardiens → annonce + menu");

  console.log(echecs === 0 ? "RESULTAT WORKER CLOUDFLARE : TOUT EST OK (" + n + " vérifications)"
                           : "RESULTAT WORKER CLOUDFLARE : " + echecs + " ECHECS / " + n);
  process.exit(echecs === 0 ? 0 : 1);
})();

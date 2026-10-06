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
  if (url.includes("site.api.espn.com")) {
    if (!global.ESPN_FIXTURE) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => global.ESPN_FIXTURE };
  }
  if (url.includes("api-web.nhle.com")) {
    if (!global.NHL) return { ok: false, status: 404 };
    const mb = url.match(/gamecenter\/(\d+)\/boxscore/);
    if (mb) {
      const f = global.NHL.boxscores[mb[1]];
      return f ? { ok: true, status: 200, json: async () => f } : { ok: false, status: 404 };
    }
    return { ok: false, status: 404 };
  }
  if (url.includes("dailyfaceoff.com")) {
    dfoHits++;
    if (!global.DFO_FIXTURE) return { ok: false, status: 404 };
    return { ok: true, status: 200, text: async () => global.DFO_FIXTURE };
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
  async list(o) { const pfx = (o && o.prefix) || ""; return { keys: [...kvStore.keys()].filter((k) => k.startsWith(pfx)).map((k) => ({ name: k, metadata: kvStore.get(k).metadata })) }; },
  async put(k, v, o) { kvStore.set(k, { value: v, metadata: (o && o.metadata) || null }); },
  async get(k, type) { const e = kvStore.get(k); if (!e) return null; return type === "json" ? JSON.parse(e.value) : e.value; },
  async delete(k) { kvStore.delete(k); },
};
let dfoHits = 0;
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
  // même règle que jourDefaut du worker : avant 07h UTC, on reste sur la veille
  // (matchs américains encore en cours), sinon premier jour >= aujourd'hui UTC
  const u0 = new Date(), tU0 = u0.toISOString().slice(0, 10);
  const veille0 = ds.filter((x) => x < tU0).pop();
  const defaut = (u0.getUTCHours() < 7 && veille0) ? veille0
    : (ds.find((x) => x >= tU0) || ds[ds.length - 1]);
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
    if (alt && joueursDe(g.id).filter((p) => p.abbr === g.away && p.lambdaSansGardien && !p.recrue
      && p.buteur && p.buteur.rank && p.pointeur && p.pointeur.rank).length >= 2)
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

  // ---------- outsiders à seuils, étiquettes SÛR/🔥, top du jour ----------
  const jeuxD = INDEX.games.filter((g) => g.date === defaut);
  const jeu2p = jeuxD.find((g) => (g.outsidersDoublePointeur || []).length);
  if (jeu2p) {
    const num2 = jeuxD.indexOf(jeu2p) + 1;
    const q2p = await dire("outsider 2 points match " + num2);
    const o2 = jeu2p.outsidersDoublePointeur[0];
    ok(q2p.textes.includes("OUTSIDER 2+ POINTS") && q2p.textes.includes(o2.name)
      && q2p.textes.includes(o2.why.split(" ; ")[0].slice(0, 18)),
      "outsider 2+ points : bloc + n°1 (" + o2.name + ") + justification");
  } else {
    const q2p = await dire("outsider 2 points");
    ok(!q2p.textes.includes("OUTSIDER 2+ POINTS"), "outsider 2+ points : aucun ce jour → pas de bloc");
  }

  const tp = await dire("top");
  ok(tp.textes.includes("TOP DU JOUR") && tp.textes.includes("🥇") && tp.textes.includes("indice"),
    "/top : top du jour structuré");

  // exactitude : top 3 buteur = tri par indice sur les joueurs du jour
  const rowsB = [];
  jeuxD.forEach((g) => {
    const j = jd.games.find((x) => String(x.id) === String(g.id)) || {};
    (j.players || []).forEach((p) => { if (p.buteur && p.buteur.rank) rowsB.push(p); });
  });
  rowsB.sort((a, b) => b.buteur.confidence - a.buteur.confidence || b.buteur.prob - a.buteur.prob);
  const top3B = rowsB.slice(0, 3);
  ok(top3B.length > 0 && top3B.every((p) => tp.textes.includes(p.name)
    && tp.textes.includes(pctT(p.buteur.prob))),
    "top : sélection buteur EXACTE (tri par indice) — " + top3B.map((p) => p.name).join(" | "));
  const marq = top3B.filter((p) => p.buteur.valeur === "VALUE" || p.buteur.valeur === "SUR");
  if (marq.length) {
    const lig = tp.textes.split("\n").find((l) => l.includes(marq[0].name)) || "";
    ok(lig.includes(marq[0].buteur.valeur === "VALUE" ? "🔥" : "✅"),
      "top : étiquette " + marq[0].buteur.valeur + " visible sur " + marq[0].name);
  } else {
    ok(true, "top : aucune étiquette attendue sur le top 3 buteur du jour");
  }

  const tdf = await clique("T:13@0:g");
  ok(tdf.edite.length === 1 && tdf.edite[0].reply_markup.inline_keyboard.flat()
    .some((x) => /✅ Outsider 2\+ points/.test(x.text)),
    "mini-app : case « Outsider 2+ points » cochable");
  const lance = await clique("L:13g@0");
  ok(!jeu2p || lance.textes.includes("OUTSIDER 2+ POINTS"),
    "mini-app : 🚀 affiche le bloc outsider 2+ points");

  // ---------- Daily Faceoff : confirmations en temps réel dans le bot ----------
  const gjeu = jeuxDefaut.find((g) => g.ctx && (INDEX.goalieList[g.home] || []).length
    && (INDEX.goalieList[g.away] || []).length && (INDEX.teams[g.home] || {}).nameEn);
  const gkH = INDEX.goalieList[gjeu.home][0], gkA = INDEX.goalieList[gjeu.away][0];
  const nG = jeuxDefaut.indexOf(gjeu) + 1;
  global.DFO_FIXTURE = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({
    props: { pageProps: { data: [{
      date: defaut,
      awayTeamName: (INDEX.teams[gjeu.away] || {}).nameEn,
      homeTeamName: (INDEX.teams[gjeu.home] || {}).nameEn,
      awayGoalieName: gkA.name, homeGoalieName: gkH.name,
      awayNewsStrengthName: "Confirmed", homeNewsStrengthName: "Confirmed",
    }] } },
  }) + "</scr" + "ipt>";
  const avant = dfoHits;
  const an1 = await dire("gardien");
  ok(dfoHits === avant + 1 && /confirmé/.test(an1.textes) && an1.textes.includes("Daily Faceoff")
    && an1.textes.includes(gkH.name.split(" ").slice(-1)[0]),
    "DFO : l'annonce capte les confirmations EN DIRECT (" + gjeu.away + " @ " + gjeu.home + ")");
  const an2 = await dire("gardien");
  ok(dfoHits === avant + 1, "DFO : cache 20 min (pas de relecture à chaque demande)");

  // le gardien away confirmé = gkA → les joueurs de HOME sont recalculés (EXACT)
  const fNA = Math.max(0.5, Math.min(1.8, (1 - gkA.sv) / (1 - svMoy)));
  const rowsH = joueursDe(gjeu.id).filter((p) => p.abbr === gjeu.home && p.buteur).map((p) => {
    if (!p.lambdaSansGardien || p.recrue)
      return { p, prob: p.buteur.prob, score: p.buteur.score, conf: p.buteur.confidence };
    const ng = p.lambdaSansGardien.g * fNA;
    const prob = Math.round((1 - Math.exp(-ng)) * 10000) / 10000;
    const score = jr1(100 * prob, 1);
    return { p, prob, score, conf: score > 0 ? jr1(confT(prob, p.gp, p.flags || [], !!gjeu.preseason), 1) : 0 };
  });
  rowsH.sort((a, b) => b.conf - a.conf || b.score - a.score || (a.p.name < b.p.name ? -1 : 1));
  const top3H = rowsH.filter((r) => r.score > 0).slice(0, 3);
  const bb = await dire("buteur match " + nG);
  ok(top3H.length > 0 && bb.textes.includes("🧤")
    && top3H.every((r) => bb.textes.includes(r.p.name) && bb.textes.includes(pctT(r.prob))),
    "DFO : probabilités recalculées EXACTES avec le gardien confirmé — "
    + top3H.map((r) => r.p.name + " " + pctT(r.prob)).join(" | "));

  const altH = (INDEX.goalieList[gjeu.home] || []).find((x) => x.playerId !== gkH.playerId && x.sv);
  if (altH) {
    await dire("gardien " + gjeu.home + " " + altH.name);
    const an3 = await dire("gardien");
    ok(an3.textes.includes("Corrigés") && an3.textes.includes(altH.name.split(" ").slice(-1)[0]),
      "DFO : ta correction manuelle a priorité sur la source");
    await dire("gardien annule " + gjeu.home);
  } else {
    ok(true, "DFO : pas de gardien alternatif pour le test de priorité");
  }

  // ---------- bilan : pronos enregistrées → résultats → stats ----------
  const boxscores = {};
  jeuxDefaut.forEach((g) => {
    const vus = new Set(), fw = [];
    const ajouteJ = (id) => { if (!vus.has(id)) { vus.add(id); fw.push({ playerId: id, name: { default: "X" }, goals: 3, assists: 3, points: 6 }); } };
    joueursDe(g.id).forEach((p) => ajouteJ(p.id));
    ["away", "home"].forEach((side) => ["double", "triple", "duo15", "trio15"].forEach((t) => {
      const cb = ((g.combos || {})[side] || {})[t];
      ((cb || {}).members || []).forEach((m) => ajouteJ(m.id));
    }));
    ["outsiders", "outsidersButeur", "outsidersPointeur", "outsidersDoubleButeur",
     "outsidersTripleButeur", "outsidersDoublePointeur", "outsidersTriplePointeur"]
      .forEach((k) => (g[k] || []).forEach((o) => ajouteJ(o.id)));
    boxscores[String(g.id)] = { gameState: "OFF",
      playerByGameStats: { awayTeam: { forwards: fw, defense: [] },
                           homeTeam: { forwards: [], defense: [] } } };
  });
  global.NHL = { boxscores };
  const bb1 = await dire("bilan");
  const snap = JSON.parse(kvStore.get("prono:" + defaut).value);
  ok(snap && snap.picks.length >= jeuxDefaut.length * 7,
    "bilan : pronos enregistrées (" + (snap ? snap.picks.length : 0) + " picks — 7 marchés + outsiders + combos)");
  const res = JSON.parse(kvStore.get("result:" + defaut).value);
  ok(res && res.n === snap.picks.length && res.h === res.n
    && bb1.morceaux === 1 && bb1.textes.includes("100 %")
    && bb1.textes.includes("Par marché") && bb1.textes.includes("Buteur 1+"),
    "bilan : vérifié sur les résultats réels (100 %) — 1 seul message Telegram non vide");
  ok(bb1.textes.includes("trop prudent") || bb1.textes.includes("sous-évalué"),
    "bilan : verdict de calibration (annoncé vs réalisé)");
  // « hier » du worker = jour par défaut moins 1 jour calendrier
  const hier = new Date(new Date(defaut + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  kvStore.set("prono:" + hier, { value: JSON.stringify({ ts: Date.now(), date: hier,
    picks: [{ gid: 999, mk: "buteur", name: "Test", id: 1, prob: 0.5, conf: 50, pal: 3, val: "PROBABLE" }] }),
    metadata: null });
  global.NHL.boxscores["999"] = { gameState: "LIVE" };
  await dire("bilan");
  ok(!kvStore.get("result:" + hier), "bilan : match pas fini → pas encore vérifié (réessaiera)");
  const bj = await dire("bilan " + defaut);
  const snap0 = snap.picks.filter((x) => x.mk === "buteur")[0];
  ok(bj.textes.includes("BILAN " + defaut) && bj.textes.includes("100 %")
    && bj.textes.includes("✅ " + snap0.name),
    "bilan par date : détail pick par pick (" + snap0.name + " ✅)");
  const bh = await dire("bilan hier");
  ok(bh.textes.includes("pas finis") || bh.textes.includes("pas encore vérifiés"),
    "bilan hier : jour pas terminé → annoncé clairement");
  const bsm = await dire("bilan semaine");
  ok(bsm.textes.includes("7 DERNIERS JOURS") && bsm.textes.includes("100 %"),
    "bilan semaine : cumul des 7 derniers jours");
  const bz = await dire("bilan zzz");
  ok(bz.textes.includes("bilan hier"), "bilan : argument invalide → guidance");

  // ---------- /news : actus NHL en direct (ESPN) ----------
  global.ESPN_FIXTURE = { articles: [
    { headline: "Panthers' Aleksander Barkov avoids surgery; out 6-8 weeks", published: "2026-10-06T19:28Z" },
    { headline: "Scoreless Leafs rookie McKenna on slow start", published: "2026-10-06T20:20Z" }] };
  const nwa = await dire("news");
  ok(nwa.textes.includes("ACTUS NHL") && nwa.textes.includes("Barkov")
    && nwa.textes.includes("10-06 19:28"),
    "📰 /news : actus NHL en direct (ESPN)");

  console.log(echecs === 0 ? "RESULTAT WORKER CLOUDFLARE : TOUT EST OK (" + n + " vérifications)"
                           : "RESULTAT WORKER CLOUDFLARE : " + echecs + " ECHECS / " + n);
  process.exit(echecs === 0 ? 0 : 1);
})();

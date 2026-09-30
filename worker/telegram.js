// Bot Telegram sur Cloudflare Worker — 100 % gratuit, sans crédits Netlify.
// Mêmes données (GitHub Pages), mêmes filtres, mêmes claviers que le site.
// Secrets (env du Worker) : TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
// TELEGRAM_OWNER_ID (identifiants autorisés, séparés par des virgules).
const DATA = "https://akrooo2002-prog.github.io/NHL-PRO-";
let ENV = {};
const TOKEN = () => ENV.TELEGRAM_BOT_TOKEN || "";
const SECRET = () => ENV.TELEGRAM_WEBHOOK_SECRET || "";
const OWNER = () => ENV.TELEGRAM_OWNER_ID || "";
// Liste d'accès : identifiants Telegram séparés par des virgules. Vide = ouvert.
const autorise = (id) => {
  const liste = OWNER().split(",").map((x) => x.trim()).filter(Boolean);
  return !liste.length || liste.includes(String(id));
};

// Cloudflare attend de vraies Response (pas le format Netlify).
const j = (code, obj) => new Response(JSON.stringify(obj), {
  status: code,
  headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" },
});
const LIMITE = 3800; // Telegram coupe à 4096 — marge de sécurité

/* ---------- petits formats (mêmes conventions que le site) ---------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (p) => (Math.round((p || 0) * 1000) / 10).toFixed(1).replace(".", ",") + " %";
const f1 = (n) => (Math.round((n || 0) * 10) / 10).toFixed(1).replace(".", ",");
const na = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function heureFr(utc) {
  if (!utc) return "";
  return new Date(utc).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
}

/* ---------- marchés : mêmes clés + mêmes libellés que le site ---------- */
const MARCHES = [
  ["buteur", "Buteur (1+ but)", ["buteur", "1but", "1+but", "but 1+", "marqueur"]],
  ["passeur", "Passeur (1+ passe)", ["passeur", "1passe", "passe 1+", "assist"]],
  ["pointeur", "Pointeur (1+ point)", ["pointeur", "1point", "1+point", "point 1+"]],
  ["doubleButeur", "Double buteur (2+ buts)", ["2buts", "2+but", "2+ but", "doublebuteur", "double buteur", "doubler"]],
  ["tripleButeur", "Triple buteur (3+ buts)", ["3buts", "3+but", "3+ but", "triplebuteur", "triple buteur"]],
  ["doublePointeur", "Double pointeur (2+ points)", ["2points", "2+point", "2+ point", "doublepointeur", "double pointeur"]],
  ["triplePointeur", "Triple pointeur (3+ points)", ["3points", "3+point", "3+ point", "triplepointeur", "triple pointeur"]],
  ["doubleChance", "Double chance buteur (1 des 2)", ["doublechance", "double chance", "dchance", "2chances", "2 chances"]],
  ["tripleChance", "Triple chance buteur (1 des 3)", ["triplechance", "triple chance", "tchance", "3chances", "3 chances"]],
  ["duo15", "Duo 1,5 buts (2+ à deux)", ["duo", "duo15", "duo 1.5", "duo 1,5", "duobuts"]],
  ["trio15", "Trio 1,5 buts (2+ à trois)", ["trio", "trio15", "trio 1.5", "trio 1,5", "triobuts"]],
  ["outsiderButeur", "Outsider buteur", ["outsider buteur", "outsiders buteur", "outsiderbuteur", "outsidersbuteur"]],
  ["outsiderPointeur", "Outsider pointeur", ["outsider pointeur", "outsiders pointeur", "outsiderpointeur", "outsiderspointeur"]],
  ["outsider", "Outsiders justifiés", ["outsider", "outsiders"]],
];
const MK_SIMPLE = ["buteur", "passeur", "pointeur", "doubleButeur", "tripleButeur", "doublePointeur", "triplePointeur"];

const AIDE =
  "🏒 <b>Bot NHL Pronos</b> — mêmes données que le site, sans cote.\n\n" +
  "<b>Commandes</b>\n" +
  "/start — menu mini-app (boutons)\n" +
  "/matchs — liste des matchs du jour\n" +
  "/podium — top 3 du jour\n" +
  "/buteur — top 3 buteurs par équipe\n" +
  "/passeur — top 3 passeurs par équipe\n" +
  "/pointeur — top 3 pointeurs par équipe\n" +
  "/outsider — outsiders justifiés du jour\n" +
  "/doublechance — 1 des 2 buteurs marque\n" +
  "/triplechance — 1 des 3 buteurs marque\n" +
  "/duo — 2+ buts cumulés par les 2 meilleurs\n" +
  "/trio — 2+ buts cumulés par les 3 meilleurs\n" +
  "/outsiderbuteur — outsider du marché buteur\n" +
  "/outsiderpointeur — outsider du marché pointeur\n" +
  "/demain — analyse de demain\n" +
  "/gardien — gardiens probables + corriger un partant\n" +
  "/dates — jours analysés\n" +
  "/aide — cette aide\n\n" +
  "<b>Texte libre</b> — combine comme tu veux :\n" +
  "• filtres : buteur, passeur, pointeur, 2buts, 3buts, 2points, 3points, " +
  "double chance, triple chance, duo, trio, outsider, outsider buteur, " +
  "outsider pointeur\n" +
  "• matchs : une équipe (FLA, CAR…), « match 3 », ou « tout »\n" +
  "• jour : aujourd'hui, demain, ou une date (2026-10-01)\n\n" +
  "Exemples : « buteur pointeur FLA » · « double chance outsider tout » · " +
  "« 2buts 3points CAR demain »";

/* ---------- mini-app : boutons inline (état porté par callback_data) ----------
   état = <codes marchés>@<index du jour dans dates()>, ex. "13@0" =
   buteur+pointeur, premier jour. Rien à stocker côté serveur : chaque bouton
   transporte l'état, la fonction reste sans mémoire (serverless). */
const MK_CODE = { 1: "buteur", 2: "passeur", 3: "pointeur", 4: "doubleButeur", 5: "tripleButeur",
                  6: "doublePointeur", 7: "triplePointeur", 8: "doubleChance", 9: "tripleChance",
                  c: "duo15", d: "trio15", a: "outsiderButeur", b: "outsiderPointeur", 0: "outsider" };
const MK_LIB = { 1: "Buteur 1+", 2: "Passeur 1+", 3: "Pointeur 1+", 4: "2+ buts", 5: "3+ buts",
                 6: "2+ points", 7: "3+ points", 8: "Double chance", 9: "Triple chance",
                 c: "Duo 1,5 buts", d: "Trio 1,5 buts", a: "Outsider buteur", b: "Outsider pointeur",
                 0: "Outsiders (mixte)" };
const CODES = "1234567890cdab";
const ETAT_DEF = "13"; // buteur + pointeur, comme le site

function decodeEtat(etat) {
  const parties = String(etat || "").split("@");
  const codes = [...(parties[0] || "")].filter((c) => CODES.includes(c));
  const jourIdx = Math.max(0, parseInt(parties[1] || "0", 10) || 0);
  return { codes: codes.length ? codes : [...ETAT_DEF], jourIdx };
}
const btn = (texte, data) => ({ text: texte, callback_data: data });
function accueilTexte(d, etat) {
  const ds = dates(d), st = decodeEtat(etat);
  const date = ds[Math.min(st.jourIdx, ds.length - 1)];
  return "🏒 <b>NHL Pronos</b> — " + esc(date) + "\n"
    + "Filtres actifs : " + st.codes.map((c) => MK_LIB[c]).join(", ") + "\n\n"
    + "Clique sur ⚙️ pour cocher tes marchés, 🗓 pour choisir un match.\n"
    + "Tu peux aussi m'écrire : « buteur outsider FLA »\n"
    + "ou « gardien VAN Demko » pour adapter les analyses à un gardien.";
}
function kbMenu(etat, d) {
  const ds = dates(d), st = decodeEtat(etat);
  const date = ds[Math.min(st.jourIdx, ds.length - 1)] || "";
  return { inline_keyboard: [
    [btn("⚙️ Filtres", "F:" + etat), btn("🗓 Matchs", "G:" + etat)],
    [btn("🏆 Podium", "P:" + etat), btn("🥅 Gardiens", "Y:" + etat)],
    [btn("📅 " + date.slice(5).replace("-", "/"), "K:" + etat), btn("❓ Aide", "A")],
  ] };
}
function kbFiltres(etat) {
  const { codes } = decodeEtat(etat);
  const rows = [];
  for (let i = 0; i < CODES.length; i += 2) {
    rows.push(CODES.slice(i, i + 2).split("").map((c) =>
      btn((codes.includes(c) ? "✅ " : "◻️ ") + MK_LIB[c], "T:" + etat + ":" + c)));
  }
  rows.push([btn("🚀 Tous les matchs du jour", "L:" + etat)]);
  rows.push([btn("🗓 Choisir un match", "G:" + etat), btn("↩️ Menu", "M:" + etat)]);
  return { inline_keyboard: rows };
}
function kbMatchs(etat, jeux) {
  const rows = jeux.map((g, i) => [btn((i + 1) + ". " + g.away + " @ " + g.home
    + " · " + heureFr(g.startUtc), "S:" + etat + ":" + (i + 1))]);
  rows.push([btn("🎯 Tous les matchs", "S:" + etat + ":0"), btn("↩️ Menu", "M:" + etat)]);
  return { inline_keyboard: rows };
}
function kbJours(etat, d) {
  const ds = dates(d), t = aujourdhui();
  const rows = ds.slice(0, 14).map((dt, i) => [btn(dt.slice(5).replace("-", "/")
    + (dt === t ? "  (aujourd'hui)" : ""), "D:" + String(etat).split("@")[0] + "@" + i)]);
  rows.push([btn("↩️ Menu", "M:" + etat)]);
  return { inline_keyboard: rows };
}

/* ---------- chargement des données (index du site) ---------- */
async function index() {
  const r = await fetch(DATA + "/data/index.json");
  if (!r.ok) throw new Error("index.json HTTP " + r.status);
  return await r.json();
}
// Les joueurs classés ne sont QUE dans les fichiers jour — l'index ne porte que
// les matchs (combos, outsiders, horaires). On charge le jour demandé à la volée.
async function jour(date) {
  const r = await fetch(DATA + "/data/jour-" + date + ".json");
  if (!r.ok) throw new Error("jour-" + date + ".json HTTP " + r.status);
  return await r.json();
}
// Le fichier jour ne porte QUE {id, effectif, players} : les métadonnées
// (équipes, horaires, combos, outsiders) sont dans l'index. On fusionne par id,
// exactement comme le fait le site après jourDe().
async function jourComplet(date) {
  const d = await index();
  const jd = await jour(date);
  const parId = {};
  jd.games.forEach((x) => { parId[x.id] = x; });
  return jeuxDuJour(d, date).map((g) => Object.assign({}, g, { players: (parId[g.id] || {}).players || [] }));
}

/* ---------- gardiens : annonce, saisie manuelle, adaptation fidèle ---------- */
const PALIERS_DEF = [[88, 5], [75, 4], [62, 3], [50, 2], [0, 1]];
const BAREMES_DEF = {
  doubleButeur: [[8, 5], [5, 4], [2.5, 3], [1, 2], [0, 1]],
  tripleButeur: [[3, 5], [2, 4], [1, 3], [0.5, 2], [0, 1]],
  doublePointeur: [[35, 5], [25, 4], [15, 3], [8, 2], [0, 1]],
  triplePointeur: [[12, 5], [8, 4], [4, 3], [2, 2], [0, 1]],
  doubleChance: [[65, 5], [55, 4], [45, 3], [35, 2], [0, 1]],
  tripleChance: [[75, 5], [65, 4], [55, 3], [45, 2], [0, 1]],
  duo15: [[40, 5], [30, 4], [22, 3], [14, 2], [0, 1]],
  trio15: [[50, 5], [40, 4], [30, 3], [20, 2], [0, 1]],
};
const jsRound = (x, nd) => { const f = Math.pow(10, nd === undefined ? 1 : nd); return Math.floor(x * f + 0.5) / f; };
const clampGardien = (x) => Math.max(0.5, Math.min(1.8, x));
function poissonGeq(lam, k) {
  if (lam <= 0) return 0;
  let s2 = 0, t = Math.exp(-lam);
  for (let i = 0; i < k; i++) { s2 += t; t *= lam / (i + 1); }
  return Math.max(0, 1 - s2);
}
const etoilesDe = (n) => "★".repeat(n) + "☆".repeat(5 - n);
function palierDe(c, paliers) { for (const [seuil, n] of paliers) if (c >= seuil) return n; return 1; }
function baremeDe(score, mk, baremes) { for (const [seuil, n] of (baremes[mk] || [])) if (score >= seuil) return n; return 1; }
// même indice que engine.py : 80 % la probabilité du marché, 20 % la fiabilité des données.
function confidenceFr(prob, gp, flags, preseason) {
  const cRank = 100 * Math.pow(Math.max(0, Math.min(1, prob)), 0.55);
  let cData = 100;
  if (gp < 20) cData = 42 + 58 * (gp / 20);
  else if (gp < 45) cData = 82 + 18 * ((gp - 20) / 25);
  if (flags.includes("absent")) cData *= 0.30;
  else if (flags.includes("hors_echantillon")) cData *= 0.90;
  if (flags.includes("echantillon")) cData *= 0.88;
  if (flags.includes("b2b")) cData *= 0.93;
  if (preseason) cData *= 0.80;
  return 0.80 * cRank + 0.20 * cData;
}
const f1fr = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(1).replace(".", ","));
const f2fr = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(2).replace(".", ","));
const pcfr = (x, dd) => (x === null || x === undefined ? "—"
  : (x * 100).toFixed(dd === undefined ? 1 : dd).replace(".", ",") + " %");

// ---- gardiens corrigés à la main : stockage Cloudflare KV (vie : 3 jours) ----
async function overridesJour(date) {
  if (!ENV.GARDIENS) return {};
  try {
    const l = await ENV.GARDIENS.list({ prefix: "g:" + date + ":" });
    const out = {};
    (l.keys || []).forEach((k) => {
      const t = (k.name.split(":")[2] || "").trim();
      if (t && k.metadata) out[t] = k.metadata;
    });
    return out;
  } catch (e) { return {}; }
}
async function poseGardien(date, team, g) {
  if (!ENV.GARDIENS) return false;
  await ENV.GARDIENS.put("g:" + date + ":" + team, "", {
    metadata: { name: g.name, playerId: g.playerId, sv: g.sv }, expirationTtl: 259200,
  });
  return true;
}
async function retireGardien(date, team) {
  if (!ENV.GARDIENS) return false;
  await ENV.GARDIENS.delete("g:" + date + ":" + team);
  return true;
}

// ---- adaptation : MÊMES formules que engine.py, via les λ publiées sans gardien ----
// λ'g = λg(sans gardien) × f'   ;   λ'a = (λa(sans gardien) − 0,6·λg) × f' + 0,6·λ'g
function adapteMatch(m, ov, d) {
  const paliers = d.paliers || PALIERS_DEF;
  const baremes = d.baremes || BAREMES_DEF;
  const svMoy = (d.league && d.league.savePctAvg) || 0.8945;
  const preseason = !!m.preseason;
  m.adaptations = [];
  for (const side of ["away", "home"]) {
    const o = ov[m[side]];
    if (!o || !o.sv) continue;
    const oppSide = side === "away" ? "home" : "away";
    const ctx = m.ctx[oppSide];                     // joueurs qui font face à ce gardien
    const fNouv = clampGardien((1 - o.sv) / (1 - svMoy));
    m.adaptations.push({ equipe: m[side], nom: o.name,
      ancien: (ctx.goalie || {}).name || null, fNouv });
    ctx.goalie = { name: o.name, playerId: o.playerId, sv: o.sv, estimated: false };
    for (const p of m.players) {
      if (p.abbr !== m[oppSide] || !p.lambdaSansGardien || p.recrue) continue;
      const ng = p.lambdaSansGardien.g * fNouv;
      const na = (p.lambdaSansGardien.a - 2 * 0.30 * p.lambda.g) * fNouv + 2 * 0.30 * ng;
      const np = ng + na;
      p.lambda = { g: jsRound(ng, 3), a: jsRound(na, 3), pts: jsRound(np, 3) };
      p.goalieF = fNouv; p.oppGoalie = o.name;
      [["buteur", ng], ["passeur", na], ["pointeur", np]].forEach(([mk, lam]) => {
        const rec = p[mk]; if (!rec) return;
        rec.prob = Math.round((1 - Math.exp(-lam)) * 10000) / 10000;
        rec.lam = jsRound(lam, 3);
        rec.score = jsRound(100 * rec.prob, 1);
        if (rec.score > 0) {
          rec.confidence = jsRound(confidenceFr(rec.prob, p.gp, p.flags || [], preseason), 1);
          rec.palier = palierDe(rec.confidence, paliers);
        } else { rec.confidence = 0; rec.palier = 1; }
        rec.etoiles = etoilesDe(rec.palier);
        rec.rank = null;
      });
      [["doubleButeur", ng, 2], ["tripleButeur", ng, 3],
       ["doublePointeur", np, 2], ["triplePointeur", np, 3]].forEach(([mk, lam, k]) => {
        const rec = p[mk]; if (!rec) return;
        rec.prob = Math.round(poissonGeq(lam, k) * 10000) / 10000;
        rec.lam = jsRound(lam, 3);
        rec.score = jsRound(100 * rec.prob, 1);
        if (rec.score > 0) rec.confidence = jsRound(confidenceFr(rec.prob, p.gp, p.flags || [], preseason), 1);
        rec.palier = baremeDe(rec.score, mk, baremes);
        rec.etoiles = etoilesDe(rec.palier);
        rec.rank = null;
      });
    }
  }
  if (!m.adaptations.length) return m;
  // mêmes départages que le moteur : indice → score affiché → nom (ordre codepoint)
  const cmpNom = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  ["buteur", "passeur", "pointeur"].forEach((mk) => {
    m.players.filter((p) => p[mk] && p[mk].score > 0)
      .sort((a, b) => b[mk].confidence - a[mk].confidence || b[mk].score - a[mk].score || cmpNom(a.name, b.name))
      .forEach((p, i) => { p[mk].rank = i + 1; });
  });
  ["doubleButeur", "tripleButeur", "doublePointeur", "triplePointeur"].forEach((mk) => {
    m.players.filter((p) => p[mk] && p[mk].score > 0)
      .sort((a, b) => b[mk].score - a[mk].score || cmpNom(a.name, b.name))
      .forEach((p, i) => { p[mk].rank = i + 1; });
  });
  m.outsiders = outsidersDe(m, null);
  m.outsidersButeur = outsidersDe(m, "buteur");
  m.outsidersPointeur = outsidersDe(m, "pointeur");
  m.combos = {};
  [["away", m.away], ["home", m.home]].forEach(([side, ab]) => {
    m.combos[side] = {
      double: comboDe(m, ab, 2, "doubleChance", 1, baremes),
      triple: comboDe(m, ab, 3, "tripleChance", 1, baremes),
      duo15: comboDe(m, ab, 2, "duo15", 2, baremes),
      trio15: comboDe(m, ab, 3, "trio15", 2, baremes),
    };
  });
  return m;
}
// outsiders : port exact de _outsiders() d'engine.py
function outsidersDe(m, mkt) {
  const mks = mkt ? [mkt] : ["buteur", "pointeur"];
  const top3 = new Set();
  mks.forEach((m2) => m.players.forEach((p) => {
    if (p[m2] && p[m2].rank && p[m2].rank <= 3) top3.add(p.id);
  }));
  const out = [];
  for (const p of m.players) {
    if (top3.has(p.id) || (p.flags || []).includes("absent") || p.recrue) continue;
    const mk = mkt || ((p.pointeur.confidence || 0) >= (p.buteur.confidence || 0) ? "pointeur" : "buteur");
    const conf = p[mk].confidence || 0;
    if (conf < 45 || !p[mk].rank || p[mk].rank < 4 || p[mk].rank > 12) continue;
    const bits = [];
    const f5 = p.form || {}, pg = p.perGame || {};
    if ((f5.n || 0) >= 3 && (f5.pts || 0) >= Math.max(0.6, (pg.pts || 0) * 1.25))
      bits.push("forme forte (" + f2fr(f5.pts) + " pts/match sur ses " + f5.n + " derniers, saison " + f2fr(pg.pts) + ")");
    const h = p.h2h || {};
    if ((h.n || 0) >= 3 && (h.pts || 0) >= Math.max(0.5, (pg.pts || 0) * 1.2))
      bits.push("réussit contre " + p.opp + " (" + f2fr(h.pts) + " pts/match sur " + h.n + " matchs)");
    if ((p.regressionRisk || 0) < -6 && p.raw && p.raw.expShPct)
      bits.push("% de tir froid (" + pcfr(p.raw.shPct) + ") sous son attendu (" + pcfr(p.raw.expShPct) + ") : la remontée joue pour lui");
    if ((p.flags || []).includes("en_hausse")) bits.push("en hausse nette sur 5 matchs");
    const ms = (p.milestones || {}).pts || {};
    if (ms.gap && ms.gap <= 3 && (ms.next || 0) >= 100)
      bits.push("à " + ms.gap + " points de " + ms.next + " en carrière : il va les chercher");
    if (!bits.length) continue;
    out.push({ id: p.id, name: p.name, abbr: p.abbr, mk, rank: p[mk].rank, prob: p[mk].prob,
      confidence: conf, palier: p[mk].palier, etoiles: p[mk].etoiles,
      why: bits.slice(0, 2).join(" ; ") + "." });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  const retenus = [];
  if (out.length) {
    retenus.push(out[0]);
    const reste = out.slice(1).filter((x) => x.abbr !== retenus[0].abbr);
    const autre = reste[0] || (out.length > 1 ? out[1] : null);
    if (autre && autre.confidence >= retenus[0].confidence - 10) retenus.push(autre);
  }
  return retenus;
}
// combos : port exact de _combo() d'engine.py
function comboDe(m, sideAbbr, n, mkKey, k, baremes) {
  const sel = m.players.filter((p) => p.abbr === sideAbbr && !(p.flags || []).includes("absent")
    && p.buteur && p.buteur.rank)
    .sort((a, b) => a.buteur.rank - b.buteur.rank).slice(0, n);
  if (sel.length < n) return null;
  let prob;
  if (k === 1) {
    let paucun = 1;
    sel.forEach((p) => { paucun *= 1 - (p.buteur.prob || 0); });
    prob = Math.round((1 - paucun) * 10000) / 10000;
  } else {
    const lam = sel.reduce((som, p) => som + (p.buteur.lam || 0), 0);
    prob = Math.round(poissonGeq(lam, k) * 10000) / 10000;
  }
  const pc100 = prob * 100;
  const pal = baremeDe(pc100, mkKey, baremes);
  const conf = jsRound(0.6 * sel.reduce((som, p) => som + (p.buteur.confidence || 0), 0) / n + 0.4 * pc100, 1);
  return { prob, palier: pal, etoiles: etoilesDe(pal), confidence: conf,
    members: sel.map((p) => ({ id: p.id, name: p.name, abbr: p.abbr, prob: p.buteur.prob,
      confidence: p.buteur.confidence, palier: p.buteur.palier })) };
}

// ---- annonce des gardiens + saisie (« gardien VAN Demko ») ----
const gkTxt = (g) => (g ? esc(g.name) + " — " + pcfr(g.sv) + (g.estimated ? " (probable)" : " (confirmé)") : "non annoncé");
function texteGardiens(date, jeux, ov) {
  if (!jeux.length) return "Aucun match le " + esc(date) + ".";
  const L = ["🥅 <b>Gardiens — " + esc(date) + "</b>"];
  jeux.forEach((g) => {
    const ga = g.ctx && g.ctx.home ? g.ctx.home.goalie : null;   // ctx porte le gardien ADVERSE
    const gh = g.ctx && g.ctx.away ? g.ctx.away.goalie : null;
    L.push("<b>" + esc(g.away) + " @ " + esc(g.home) + "</b> · " + heureFr(g.startUtc)
      + "\n  " + esc(g.away) + " : " + gkTxt(ga) + "\n  " + esc(g.home) + " : " + gkTxt(gh));
  });
  const conf = jeux.some((g) => [g.ctx && g.ctx.away && g.ctx.away.goalie,
    g.ctx && g.ctx.home && g.ctx.home.goalie].some((x) => x && x.estimated === false));
  if (conf)
    L.push("\n✅ « confirmé » = partant officiel vérifié (Daily Faceoff) — rien à faire, les analyses sont déjà à jour.");
  const corr = Object.keys(ov || {});
  if (corr.length) L.push("\n🧤 Corrigés : " + corr.map((t) => esc(t) + " → " + esc(ov[t].name)).join(", "));
  L.push("\nTu connais le partant ? Écris « gardien VAN Demko ».\n« gardien annule VAN » pour revenir à l'annonce.");
  return L.join("\n");
}
function resolveTeam(txt, d) {
  if (!txt) return null;
  const ab = na(txt).toUpperCase();
  if ((d.teams || {})[ab]) return ab;
  const cle = na(txt);
  if (cle.length < 3) return null;
  return Object.keys(d.teams || {}).find((a) =>
    String(((d.teams[a] || {}).nameFr) || "").toLowerCase().split(/[^a-z]+/).filter(Boolean)
      .some((w) => w.length > 3 && cle.includes(w))) || null;
}
async function fluxGardien(rest, d) {
  const date = jourDefaut(d);
  const jeux = await jourComplet(date);
  const ov = await overridesJour(date);
  if (!rest) return [texteGardiens(date, jeux, ov)];
  const ann = rest.match(/^(annule|annuler|reset|efface|effacer|supprime|supprimer|retire|retirer)\s*(.*)$/i);
  if (ann) {
    const team = resolveTeam(ann[2].trim(), d);
    if (!team) return ["Donne l'équipe : « gardien annule VAN »."];
    if (!ov[team]) return ["Aucun gardien corrigé pour " + esc(team) + "."];
    await retireGardien(date, team);
    return ["↩️ <b>" + esc(team) + "</b> : retour à l'annonce officielle."];
  }
  let team = null, nom = rest;
  const parts = rest.split(/\s+/);
  const t0 = resolveTeam(parts[0] || "", d);
  if (t0) { team = t0; nom = rest.slice(parts[0].length).trim(); }
  if (!nom) return ["Donne le nom du gardien : « gardien " + esc(team || "VAN") + " Demko »."];
  const liste = team ? (d.goalieList[team] || []).map((g) => Object.assign({ team }, g))
    : Object.keys(d.goalieList || {}).flatMap((t) => (d.goalieList[t] || []).map((g) => Object.assign({ team: t }, g)));
  const cle = na(nom);
  let cands = liste.filter((g) => na(g.name) === cle
    || na(String(g.name).split(" ").slice(-1)[0]) === cle);
  if (!cands.length) cands = liste.filter((g) => na(g.name).includes(cle));
  if (!cands.length)
    return ["Je ne trouve pas « " + esc(nom) + " »" + (team ? " parmi les gardiens suivis de " + esc(team) : "") + "."
      + (team ? "\nGardiens suivis : " + (d.goalieList[team] || []).map((g) => esc(g.name)).join(", ") + "." : "")];
  if (cands.length > 1)
    return ["Plusieurs gardiens possibles :\n"
      + cands.slice(0, 6).map((g) => " • " + esc(g.name) + " (" + esc(g.team) + ")").join("\n")
      + "\nPrécise : « gardien " + esc(cands[0].team) + " " + esc(cands[0].name) + " »."];
  const gk = cands[0];
  const tm = team || gk.team;
  const jeu = jeux.find((x) => x.away === tm || x.home === tm);
  if (!jeu)
    return ["✅ " + esc(gk.name) + " noté pour " + esc(tm) + " — mais " + esc(tm)
      + " ne joue pas le " + esc(date) + ". Rien à adapter."];
  await poseGardien(date, tm, gk);
  const ctxOpp = jeu.away === tm ? jeu.ctx.home : jeu.ctx.away;
  const fOld = ctxOpp.goalieF;
  adapteMatch(jeu, { [tm]: { name: gk.name, playerId: gk.playerId, sv: gk.sv } }, d);
  const ad = (jeu.adaptations || [])[0] || {};
  const head = "✅ <b>Gardien pris en compte : " + esc(gk.name) + " (" + esc(tm) + ")</b> — " + pcfr(gk.sv)
    + "\nFacteur gardien ×" + f1fr(fOld) + " → ×" + f1fr(ad.fNouv) + " · toutes tes analyses du "
    + esc(date) + " sont adaptées (3 jours).\n« gardien annule " + esc(tm) + " » pour revenir à l'annonce.\n";
  return [head + blocMatch(jeu, ["buteur", "pointeur"])];
}
async function jourAdapte(date, d) {
  const jeux = await jourComplet(date);
  const ov = await overridesJour(date);
  if (Object.keys(ov).length) jeux.forEach((g) => adapteMatch(g, ov, d));
  return jeux;
}

/* ---------- choix du jour ---------- */
function dates(d) { return [...new Set(d.games.map((g) => g.date))].sort(); }
function aujourdhui() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}
function jourDefaut(d) {
  const ds = dates(d), t = aujourdhui();
  return ds.find((x) => x >= t) || ds[ds.length - 1];
}

/* ---------- analyse de la demande ---------- */
function parseRequete(text, d) {
  let t = na(text);
  const q = { marches: [], equipes: [], nums: [], date: null, tout: false, podium: false, liste: false, aide: false };
  const mot0 = (t.match(/^\/?([a-z]+)/) || [])[1];
  if (mot0 === "start" || mot0 === "aide" || mot0 === "help") { q.aide = true; return q; }
  if (mot0 === "matchs" || (mot0 === "match" && !/\d/.test(t))) { q.liste = true; return q; }
  if (mot0 === "dates") { q.date = "*"; return q; }

  // date explicite
  const md = t.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (md) q.date = md[0];
  // marchés (on retire les alias trouvés pour ne pas confondre avec les équipes)
  let reste = t;
  // alias triés du plus long au plus court : « outsider buteur » doit être
  // reconnu avant « buteur » tout seul.
  const aliasPlat = [];
  MARCHES.forEach(([k, , alias]) => alias.forEach((a) => aliasPlat.push([a, k])));
  aliasPlat.sort((x, y) => y[0].length - x[0].length);
  for (const [a, k] of aliasPlat) {
    const re = new RegExp("(^|[^a-z])" + a.replace(/[+.]/g, "\\$&").replace(/,/g, "[,.]") + "([^a-z]|$)");
    if (re.test(reste)) { reste = reste.replace(re, " "); if (!q.marches.includes(k)) q.marches.push(k); }
  }
  if (/\bpodium\b/.test(reste)) { q.podium = true; }
  if (/\b(marches|marche|filtres?)\b/.test(reste)) { q.aide = true; } // liste des filtres dispo
  if (/\b(tous?|all|tout|journee)\b/.test(reste)) { q.tout = true; reste = reste.replace(/\b(tous?|all|tout|journee)\b/g, " "); }
  // équipes (abréviations NHL) et numéros de match
  const abbrs = new Set(); d.games.forEach((g) => { abbrs.add(g.away); abbrs.add(g.home); });
  for (const tok of reste.match(/[a-z0-9]{2,4}/g) || []) {
    if (abbrs.has(tok.toUpperCase()) && !q.equipes.includes(tok.toUpperCase())) q.equipes.push(tok.toUpperCase());
  }
  reste = reste.replace(new RegExp("(" + [...abbrs].join("|").toLowerCase() + ")", "g"), " ");
  const mn = reste.match(/(?:match|numero|n°|n o|#)\s*(\d{1,2})/g) || [];
  mn.forEach((x) => { const n = parseInt(x.replace(/\D/g, ""), 10); if (n >= 1 && n <= 99) q.nums.push(n); });
  if (!mn.length) {
    const seul = reste.match(/(?:^|\s)#?(\d{1,2})(?:\s|$)/);
    if (seul) q.nums.push(parseInt(seul[1], 10));
  }
  // « demain » / « après-demain »
  const ds = dates(d);
  let base = q.date || jourDefaut(d);
  if (/\bapres[- ]?demain\b/.test(t)) { const i = ds.indexOf(base); base = ds[Math.min(i + 2, ds.length - 1)]; q.date = base; }
  else if (/\bdemain\b/.test(t)) { const i = ds.indexOf(base); base = ds[Math.min(i + 1, ds.length - 1)]; q.date = base; }
  return q;
}

function jeuxDuJour(d, date) {
  return d.games.filter((g) => g.date === date)
    .sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
}

/* ---------- sélection des matchs demandés (dans le jour fusionné) ---------- */
function selection(jeux, q) {
  if (q.nums.length) jeux = jeux.filter((g, i) => q.nums.includes(i + 1));
  if (q.equipes.length) jeux = jeux.filter((g) => q.equipes.includes(g.away) || q.equipes.includes(g.home));
  return jeux;
}

/* ---------- mise en forme ---------- */
function ligneJoueur(p, mk, i) {
  return " " + (i + 1) + ". " + esc(p.name) + " " + (p[mk].etoiles || "") + " " + pct(p[mk].prob);
}
function blocMatch(g, marches) {
  const L = [];
  L.push("🏒 <b>" + esc(g.awayNameFr || g.away) + " @ " + esc(g.homeNameFr || g.home) + "</b> · " + heureFr(g.startUtc)
    + (g.preseason ? " · ⚠️ présaison (probabilités fragiles)" : ""));
  const gkA = g.ctx && g.ctx.home ? g.ctx.home.goalie : null;   // ctx porte le gardien ADVERSE
  const gkH = g.ctx && g.ctx.away ? g.ctx.away.goalie : null;
  if (gkA || gkH)
    L.push("🥅 " + esc(g.away) + " : " + gkTxt(gkA) + "  ·  " + esc(g.home) + " : " + gkTxt(gkH));
  if ((g.adaptations || []).length)
    L.push("🧤 <i>Analyses adaptées :</i> " + g.adaptations.map((x) => esc(x.equipe) + " → " + esc(x.nom)).join(" · "));
  for (const mk of marches) {
    if (mk === "outsider") {
      if ((g.outsiders || []).length) {
        L.push("<b>OUTSIDERS</b> 🎯");
        g.outsiders.forEach((o) => L.push(" • " + esc(o.name) + " (" + esc(o.abbr) + ") — " + esc(o.mk)
          + " n°" + o.rank + " · " + pct(o.prob) + " " + (o.etoiles || "")
          + "\n   " + esc(o.why)));
      }
      continue;
    }
    if (mk === "duo15" || mk === "trio15") {
      const lab = MARCHES.find((m) => m[0] === mk)[1].toUpperCase();
      const lignes = [];
      [["away", "🔵"], ["home", "🔴"]].forEach(([side, ic]) => {
        const cb = g.combos && g.combos[side] && g.combos[side][mk];
        if (!cb) return;
        lignes.push(" " + ic + " " + esc(cb.members.map((x) => x.name).join(" + "))
          + "\n   → " + pct(cb.prob) + " " + (cb.etoiles || "") + " (indice " + f1(cb.confidence) + ")");
      });
      if (lignes.length) { L.push("<b>" + lab + "</b> ⚔️"); L.push(...lignes); }
      continue;
    }
    if (mk === "outsiderButeur" || mk === "outsiderPointeur") {
      const liste = g[mk === "outsiderButeur" ? "outsidersButeur" : "outsidersPointeur"] || [];
      if (!liste.length) continue;                // personne d'éligible → pas de bloc
      L.push("<b>" + MARCHES.find((m) => m[0] === mk)[1].toUpperCase() + "</b> 🎯");
      liste.forEach((o) => L.push(" • " + esc(o.name) + " (" + esc(o.abbr) + ") — " + esc(o.mk)
        + " n°" + o.rank + " · " + pct(o.prob) + " " + (o.etoiles || "")
        + "\n   " + esc(o.why)));
      continue;
    }
    if (mk === "doubleChance" || mk === "tripleChance") {
      const nk = mk === "doubleChance" ? "double" : "triple";
      const lab = MARCHES.find((m) => m[0] === mk)[1].toUpperCase();
      const lignes = [];
      [["away", "🔵"], ["home", "🔴"]].forEach(([side, ic]) => {
        const cb = g.combos && g.combos[side] && g.combos[side][nk];
        if (!cb) return;
        lignes.push(" " + ic + " " + esc(cb.members.map((x) => x.name).join(" ou "))
          + "\n   → " + pct(cb.prob) + " " + (cb.etoiles || "") + " (indice " + f1(cb.confidence) + ")");
      });
      if (lignes.length) { L.push("<b>" + lab + "</b> 🎲"); L.push(...lignes); }
      continue;
    }
    // marché simple : top 3 par équipe
    const lab = MARCHES.find((m) => m[0] === mk)[1].toUpperCase();
    const blocs = [];
    [["away", g.away, "🔵"], ["home", g.home, "🔴"]].forEach(([, ab, ic]) => {
      const top = (g.players || []).filter((p) => p.abbr === ab && p[mk] && p[mk].rank)
        .sort((a, b) => a[mk].rank - b[mk].rank).slice(0, 3);
      if (top.length) blocs.push(" " + ic + " " + esc(ab) + "\n" + top.map((p, i) => ligneJoueur(p, mk, i)).join("\n"));
    });
    if (blocs.length) { L.push("<b>" + lab + "</b> 🎯"); L.push(...blocs); }
  }
  return L.join("\n");
}
function blocPodium(date, jeux) {
  const L = ["🏆 <b>PODIUM du " + esc(date) + "</b>"];
  ["buteur", "passeur", "pointeur"].forEach((mk) => {
    const rows = [];
    jeux.forEach((g) => (g.players || []).forEach((p) => { if (p[mk] && p[mk].score > 0) rows.push({ p, g }); }));
    rows.sort((a, b) => b.p[mk].confidence - a.p[mk].confidence || b.p[mk].score - a.p[mk].score
      || a.p.name.localeCompare(b.p.name, "fr"));
    const vus = new Set(), top = [];
    rows.forEach((r) => { if (vus.has(r.p.id)) return; vus.add(r.p.id); top.push(r); });
    L.push("<b>" + mk.toUpperCase() + "</b> 🎯");
    const med = ["🥇", "🥈", "🥉"];
    top.slice(0, 3).forEach((r, i) => L.push(" " + med[i] + " " + esc(r.p.name) + " (" + esc(r.p.abbr) + " vs "
      + esc(r.p.opp) + ") " + pct(r.p[mk].prob) + " " + (r.p[mk].etoiles || "")));
  });
  return L.join("\n");
}
function blocListe(date, jeux) {
  if (!jeux.length) return "Aucun match le " + esc(date) + ". /dates pour voir les jours disponibles.";
  return "🗓 <b>Matchs du " + esc(date) + "</b>\n" + jeux.map((g, i) => (i + 1) + ". "
    + esc(g.away) + " @ " + esc(g.home) + " · " + heureFr(g.startUtc)
    + (g.preseason ? " (préseason)" : "")).join("\n")
    + "\n\nEx : « buteur match 1 », « outsider FLA », « tout pointeur »";
}

/* ---------- réponse complète ---------- */
async function traite(text) {
  const d = await index();
  const gm = String(text || "").trim().match(/^\/?gardiens?\s*(.*)$/i);
  if (gm) return fluxGardien(gm[1].trim(), d);
  const q = parseRequete(text, d);
  const ds = dates(d);
  if (q.aide) return [AIDE];
  if (q.date === "*") return ["🗓 <b>Jours analysés</b>\n" + ds.join("\n") + "\n(mise à jour : " + esc(d.generatedUtc) + ")"];
  const date = q.date || jourDefaut(d);
  if (!ds.includes(date)) return ["Pas d'analyse pour le " + esc(date) + ". Prochains jours : " + ds.slice(0, 8).join(", ")];
  const jeuxJour = await jourAdapte(date, d); // index + joueurs + gardiens corrigés
  const jeux = selection(jeuxJour, q);
  if (q.liste && !q.marches.length) return [blocListe(date, jeuxJour)];
  if (q.podium) return [blocPodium(date, jeuxJour)];
  if (!jeux.length) return ["Aucun match ne correspond le " + esc(date) + ". /matchs pour la liste."];
  let marches = q.marches.filter((m) => m !== "*");
  if (!marches.length) marches = ["buteur", "pointeur"]; // défaut = celui du site
  return morceauxResultats(date, jeux, ordonneMk(marches));
}
const ORDRE_MK = [...MK_SIMPLE, "doubleChance", "tripleChance", "duo15", "trio15",
                  "outsiderButeur", "outsiderPointeur", "outsider"];
const ordonneMk = (m) => m.slice().sort((a, b) => ORDRE_MK.indexOf(a) - ORDRE_MK.indexOf(b));
function morceauxResultats(date, jeux, marches) {
  const entete = "📅 <b>" + esc(date) + "</b> · " + jeux.length + " match" + (jeux.length > 1 ? "s" : "");
  const morceaux = [];
  let buf = entete;
  for (const g of jeux) {
    const bloc = blocMatch(g, marches);
    if ((buf + "\n\n" + bloc).length > LIMITE && buf !== entete) { morceaux.push(buf); buf = bloc; }
    else buf += "\n\n" + bloc;
  }
  morceaux.push(buf);
  return morceaux;
}

/* ---------- navigation par boutons ---------- */
async function traiteCallback(data, d) {
  const ds = dates(d);
  const [cmd, etat, extra] = String(data).split(":");
  const { codes, jourIdx } = decodeEtat(etat);
  const date = ds[Math.min(jourIdx, ds.length - 1)] || ds[ds.length - 1];
  const titreF = "⚙️ <b>Filtres</b> — 📅 " + esc(date) + "\nCoche tes marchés puis lance :";
  if (cmd === "A") return { envoie: [AIDE], clavier: kbMenu(etat, d) };
  if (cmd === "M") return { edit: { texte: accueilTexte(d, etat), clavier: kbMenu(etat, d) } };
  if (cmd === "F") return { edit: { texte: titreF, clavier: kbFiltres(etat) } };
  if (cmd === "T") {
    let c2 = codes.includes(extra) ? codes.filter((x) => x !== extra) : [...codes, extra];
    if (!c2.length) c2 = codes;                       // on garde toujours au moins un filtre
    c2.sort((a, b) => CODES.indexOf(a) - CODES.indexOf(b));
    const e2 = c2.join("") + "@" + jourIdx;
    return { edit: { texte: titreF, clavier: kbFiltres(e2) } };
  }
  if (cmd === "L" || cmd === "S") {
    const jeuxJour = await jourAdapte(date, d);
    let jeux = jeuxJour;
    if (cmd === "S") {
      const n = parseInt(extra, 10);
      jeux = n >= 1 ? jeuxJour.filter((g, i) => i + 1 === n) : jeuxJour;
    }
    if (!jeux.length) return { envoie: ["Aucun match ne correspond."], clavier: kbMenu(etat, d) };
    const marches = ordonneMk(codes.map((c) => MK_CODE[c]));
    return { envoie: morceauxResultats(date, jeux, marches), clavier: kbMenu(etat, d) };
  }
  if (cmd === "G") {
    const jeux = await jourComplet(date);
    return { edit: { texte: "🗓 <b>Matchs du " + esc(date) + "</b> — choisis :", clavier: kbMatchs(etat, jeux) } };
  }
  if (cmd === "Y") {
    const jeux = await jourAdapte(date, d);
    return { envoie: [texteGardiens(date, jeux, await overridesJour(date))], clavier: kbMenu(etat, d) };
  }
  if (cmd === "P") return { envoie: [blocPodium(date, await jourAdapte(date, d))], clavier: kbMenu(etat, d) };
  if (cmd === "K") return { edit: { texte: "📅 <b>Choisis un jour</b> :", clavier: kbJours(etat, d) } };
  if (cmd === "D") return { edit: { texte: accueilTexte(d, etat), clavier: kbMenu(etat, d) } };
  return {};
}

/* ---------- API Telegram ---------- */
async function tg(methode, obj) {
  const r = await fetch("https://api.telegram.org/bot" + TOKEN() + "/" + methode, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj),
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || res.ok === false) {
    const msg = String(res.description || "HTTP " + r.status);
    if (/message is not modified/i.test(msg)) return res; // navigation à l'identique : pas une erreur
    throw new Error(methode + " : " + msg.slice(0, 200));
  }
  return res;
}
function decoupe(texte) { // filet : Telegram coupe à 4096
  if (texte.length <= 4090) return [texte];
  const bouts = [];
  let b = "";
  texte.split("\n").forEach((l) => {
    if ((b + "\n" + l).length > 4000 && b) { bouts.push(b); b = l; } else b += (b ? "\n" : "") + l;
  });
  if (b) bouts.push(b);
  return bouts;
}
async function envoie(chatId, morceaux, clavier) {
  const parties = [];
  morceaux.forEach((t) => parties.push(...decoupe(t)));
  for (let i = 0; i < parties.length; i++) {
    const payload = { chat_id: chatId, text: parties[i], parse_mode: "HTML", disable_web_page_preview: true };
    if (clavier && i === parties.length - 1) payload.reply_markup = clavier;
    await tg("sendMessage", payload);
  }
}

/* ---------- handler Cloudflare Worker ---------- */
export default {
  async fetch(request, env) {
    ENV = env || {};
    if (request.method === "GET") return j(200, { ok: true, bot: !!TOKEN(), donnees: DATA });
    if (request.method !== "POST") return j(405, { ok: false });
    if (!TOKEN()) return j(200, { ok: false, erreur: "TELEGRAM_BOT_TOKEN non configuré" });
    const sec = request.headers.get("x-telegram-bot-api-secret-token");
    if (SECRET() && sec !== SECRET()) return j(401, { ok: false });
    let up;
    try { up = JSON.parse((await request.text()) || "{}"); } catch (e) { return j(200, { ok: false }); }

    // ---- clic sur un bouton (mini-app) ----
    const cbq = up.callback_query;
    if (cbq && cbq.message) {
      if (!autorise((cbq.from || {}).id)) {
        try { await tg("answerCallbackQuery", { callback_query_id: cbq.id, text: "🔒 Accès privé", show_alert: true }); } catch (e) { /* tant pis */ }
        return j(200, { ok: true, ignore: true });
      }
      try {
        await tg("answerCallbackQuery", { callback_query_id: cbq.id });
        const d = await index();
        const res = await traiteCallback(cbq.data, d);
        if (res.edit) {
          await tg("editMessageText", {
            chat_id: cbq.message.chat.id, message_id: cbq.message.message_id,
            text: res.edit.texte, parse_mode: "HTML", disable_web_page_preview: true,
            reply_markup: res.edit.clavier,
          });
        }
        if (res.envoie) await envoie(cbq.message.chat.id, res.envoie, res.clavier);
        return j(200, { ok: true, action: cbq.data });
      } catch (e) {
        try { await envoie(cbq.message.chat.id, ["❌ Erreur : " + esc(String((e && e.message) || e))]); } catch (e2) { /* tant pis */ }
        return j(200, { ok: false, erreur: String((e && e.message) || e) });
      }
    }

    const msg = up.message || up.edited_message;
    if (!msg || !msg.text) return j(200, { ok: true });           // stickers, photos, canaux…
    if (!autorise(msg.chat.id)) {                                 // accès restreint : on lui donne son ID
      try {
        await envoie(msg.chat.id, ["🔒 <b>Accès privé.</b>\nTon identifiant Telegram : <code>"
          + esc(msg.chat.id) + "</code>\nEnvoie-le à Amine pour qu'il autorise ton accès."]);
      } catch (e) { /* tant pis */ }
      return j(200, { ok: true, ignore: true });
    }
    const mot0 = (na(String(msg.text)).match(/^\/?([a-z]+)/) || [])[1];
    try {
      if (mot0 === "start") {                                    // /start → la mini-app
        const d = await index();
        const ds = dates(d);
        const etat = ETAT_DEF + "@" + Math.max(0, ds.indexOf(jourDefaut(d)));
        await envoie(msg.chat.id, [accueilTexte(d, etat)], kbMenu(etat, d));
        return j(200, { ok: true, menu: true });
      }
      const morceaux = await traite(msg.text);
      await envoie(msg.chat.id, morceaux);
      return j(200, { ok: true, reponses: morceaux.length });
    } catch (e) {
      try { await envoie(msg.chat.id, ["❌ Erreur : " + esc(String((e && e.message) || e))]); } catch (e2) { /* tant pis */ }
      return j(200, { ok: false, erreur: String((e && e.message) || e) });
    }
  },
};

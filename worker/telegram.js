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
  ["outsiderDoubleButeur", "Outsider 2+ buts", ["outsider 2 buts", "outsider 2+ buts", "outsider2buts", "outsider double buteur"]],
  ["outsiderTripleButeur", "Outsider 3+ buts", ["outsider 3 buts", "outsider 3+ buts", "outsider3buts", "outsider triple buteur"]],
  ["outsiderDoublePointeur", "Outsider 2+ points", ["outsider 2 points", "outsider 2+ points", "outsider2points", "outsider double pointeur"]],
  ["outsiderTriplePointeur", "Outsider 3+ points", ["outsider 3 points", "outsider 3+ points", "outsider3points", "outsider triple pointeur"]],
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
  "/outsider2buts — outsider 2+ buts\n" +
  "/outsider3buts — outsider 3+ buts\n" +
  "/outsider2points — outsider 2+ points\n" +
  "/outsider3points — outsider 3+ points\n" +
  "/top — 🌟 le meilleur du jour, filtre par filtre\n" +
  "/demain — analyse de demain\n" +
  "/gardien — gardiens probables + corriger un partant\n" +
  "/bilan — 📊 bilan de la veille : mes bets ✅🔥 par confiance et probabilité, fun séparé, navigation jour par jour ◀ ▶\n" +
  "/pick — 🎯 MES CHOIX : un nom par marché, direct\n" +
  "/combi — 🎰 combinés (SÛR · BUTS · JACKPOT) + MyMatch même match\n" +
  "/ticket — 🎫 construis ton combiné : match par match, joueur par joueur\n" +
  "/classement — 📊 % décroissant, marché au choix par boutons\n" +
  "/refresh — 🔄 gardiens revérifiés + analyses réadaptées\n" +
  "/news — 📰 actus NHL en direct (blessures, compos)\n" +
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
                  c: "duo15", d: "trio15", a: "outsiderButeur", b: "outsiderPointeur",
                  e: "outsiderDoubleButeur", f: "outsiderTripleButeur",
                  g: "outsiderDoublePointeur", h: "outsiderTriplePointeur", 0: "outsider" };
const MK_LIB = { 1: "Buteur 1+", 2: "Passeur 1+", 3: "Pointeur 1+", 4: "2+ buts", 5: "3+ buts",
                 6: "2+ points", 7: "3+ points", 8: "Double chance", 9: "Triple chance",
                 c: "Duo 1,5 buts", d: "Trio 1,5 buts", a: "Outsider buteur", b: "Outsider pointeur",
                 e: "Outsider 2+ buts", f: "Outsider 3+ buts", g: "Outsider 2+ points", h: "Outsider 3+ points",
                 0: "Outsiders (mixte)" };
const CODES = "1234567890cdabefgh";
const OUTS_CHAMP = { outsider: "outsiders", outsiderButeur: "outsidersButeur",
  outsiderPointeur: "outsidersPointeur", outsiderDoubleButeur: "outsidersDoubleButeur",
  outsiderTripleButeur: "outsidersTripleButeur", outsiderDoublePointeur: "outsidersDoublePointeur",
  outsiderTriplePointeur: "outsidersTriplePointeur" };
// ✅ sûr = tête du marché + indice solide · 🔥 valeur = 3 derniers matchs très au-dessus
const vTxt = (v) => (v === "VALUE" ? " 🔥" : v === "SUR" ? " ✅" : "");

/* ---- équipes : abréviation seule, lisible ---- */
const eq = (ab) => esc(ab || "?");
const MOIS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août",
  "sept.", "oct.", "nov.", "déc."];
const JOURS_FR = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const dateFr = (iso) => {
  const dt = new Date(String(iso) + "T12:00:00Z");
  return JOURS_FR[dt.getUTCDay()] + " " + (+String(iso).slice(8, 10)) + " "
    + MOIS_FR[+String(iso).slice(5, 7) - 1];
};
const SEP = "──────────────";
const MED = ["🥇", "🥈", "🥉"];
const rang = (i) => (i < 3 ? MED[i] : " " + (i + 1) + ".");
const ETAT_DEF = "13"; // buteur + pointeur, comme le site

const encodeEtat = (codes, jourIdx) => (codes.length ? codes.join("") : "13") + "@" + Math.max(0, jourIdx);
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
    + "Clique sur ⚙️ pour cocher tes marchés, 🌟 pour le top du jour.\n"
    + "Tu peux aussi m'écrire : « buteur outsider FLA »\n"
    + "ou « gardien VAN Demko » pour adapter les analyses à un gardien.\n📊 /bilan : ma réussite, marché par marché.";
}
function kbMenu(etat, d) {
  const ds = dates(d), st = decodeEtat(etat);
  const date = ds[Math.min(st.jourIdx, ds.length - 1)] || "";
  return { inline_keyboard: [
    [btn("⚙️ Filtres", "F:" + etat), btn("🗓 Matchs", "G:" + etat)],
    [btn("🏆 Podium", "P:" + etat), btn("🌟 Top du jour", "O:" + etat)],
    [btn("🥅 Gardiens", "Y:" + etat), btn("📅 " + date.slice(5).replace("-", "/"), "K:" + etat)],
    [btn("📊 Bilan", "B:" + etat), btn("❓ Aide", "A")],
    [btn("🎯 Mes picks", "X:" + etat), btn("🎰 Combinés", "V:" + etat)],
    [btn("📊 Classement %", "C:" + etat), btn("🔄 Refresh", "W:" + etat)],
    [btn("🎫 Mon ticket", "N:" + etat)],
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
// même étiquette que le moteur : ✅ SÛR (top 2 + indice ≥ 70), 🔥 VALUE (3 derniers
// matchs très au-dessus de la saison), sinon PROBABLE.
function valeurLab(p, conf, rank) {
  if (conf && conf >= 70 && rank && rank <= 2) return "SUR";
  const f3 = p.form3 || {};
  if ((f3.n || 0) >= 3 && (p.gp || 0) >= 10 && (f3.pts || 0) >= 3) {
    const saison = (p.perGame || {}).pts || 0;
    if (saison <= 0 || f3.pts / 3 >= 1.5 * saison) return "VALUE";
  }
  return "PROBABLE";
}
function palierDe(c, paliers) { for (const [seuil, n] of paliers) if (c >= seuil) return n; return 1; }
function baremeDeRel(score, mk, baremes) { for (const [seuil, n] of (baremes[mk] || [])) if (score >= seuil) return n; return 1; }
// étoiles honnêtes : un événement à 12 % ne vaut jamais 5 étoiles — plafond absolu
const PAL_ABS_DEF = [[70, 5], [52, 4], [36, 3], [20, 2], [0, 1]];
function palierAbs(pc100) { for (const [seuil, n] of PAL_ABS_DEF) if (pc100 >= seuil) return n; return 1; }
function baremeDe(score, mk, baremes) { return Math.min(baremeDeRel(score, mk, baremes), palierAbs(score)); }
const BASE_SEUIL = { doubleButeur: 0.030, tripleButeur: 0.005, doublePointeur: 0.120, triplePointeur: 0.025 };
// même indice que engine.py : 80 % la probabilité du marché, 20 % la fiabilité des données.
function confidenceFr(prob, gp, flags, preseason) {
  const cRank = 100 * Math.pow(Math.max(0, Math.min(1, prob)), 0.55);
  let cData = 100;
  if (gp < 20) cData = 42 + 58 * (gp / 20);
  else if (gp < 45) cData = 82 + 18 * ((gp - 20) / 25);
  if (flags.includes("absent")) cData *= 0.30;
  else if (flags.includes("hors_echantillon")) cData *= 0.90;
  if (flags.includes("news_doute")) cData *= 0.85;
  if (flags.includes("echantillon")) cData *= 0.88;
  if (flags.includes("b2b")) cData *= 0.93;
  if (preseason) cData *= 0.80;
  return 0.80 * cRank + 0.20 * cData;
}
const f1fr = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(1).replace(".", ","));
const f2fr = (x) => (x === null || x === undefined ? "—" : Number(x).toFixed(2).replace(".", ","));
const pcfr = (x, dd) => (x === null || x === undefined ? "—"
  : (x * 100).toFixed(dd === undefined ? 1 : dd).replace(".", ",") + " %");

// ---- gardiens CONFIRMÉS (Daily Faceoff) : lus en direct, cache KV 20 min ----
// Le bot ne dépend plus du pipeline : à chaque demande, si le cache a plus de
// 20 minutes, on relit la source. Seuls les statuts « Confirmed » sont retenus.
const DFO_URL = "https://www.dailyfaceoff.com/starting-goalies";
const DFO_TTL = 20 * 60 * 1000;
async function dfoConfirms(date, d, force) {
  const cle = "dfo:" + date;
  let cache = null;
  if (ENV.GARDIENS) { try { cache = await ENV.GARDIENS.get(cle, "json"); } catch (e) { /* tant pis */ } }
  if (!force && cache && Date.now() - (cache.ts || 0) < DFO_TTL) return cache.ov || {};
  let ov = (cache && cache.ov) || {};           // source injoignable → dernier état connu
  try {
    const r = await fetch(DFO_URL, { headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html" } });
    if (!r.ok) return ov;
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return ov;
    const rows = (((JSON.parse(m[1]).props || {}).pageProps) || {}).data || [];
    const parNom = {};
    Object.keys(d.teams || {}).forEach((ab) => { parNom[na((d.teams[ab] || {}).nameEn)] = ab; });
    const out = {};
    rows.forEach((row) => {
      if (row.date !== date) return;
      [["awayTeamName", "awayGoalieName", "awayNewsStrengthName", "awayGoalieSavePercentage"],
       ["homeTeamName", "homeGoalieName", "homeNewsStrengthName", "homeGoalieSavePercentage"]]
        .forEach(([tEq, tGk, tSt, tSv]) => {
          if ((row[tSt] || "") !== "Confirmed") return;
          const ab = parNom[na(row[tEq])];
          if (!ab) return;
          const nom = String(row[tGk] || "");
          const cleN = na(nom), nomFamille = na(nom.split(" ").slice(-1)[0]);
          const gk = (d.goalieList[ab] || []).find((g) => na(g.name) === cleN
            || na(String(g.name).split(" ").slice(-1)[0]) === nomFamille);
          if (!gk) return;
          let sv = gk.sv;
          if (!sv && row[tSv]) {                // pas de stats de référence → % de la source
            let x = parseFloat(row[tSv]);
            if (x > 1) x = x / 100;
            if (x > 0.5 && x < 1) sv = x;
          }
          if (!sv) return;
          out[ab] = { name: gk.name, playerId: gk.playerId, sv };
        });
    });
    ov = out;
    if (ENV.GARDIENS) {
      try { await ENV.GARDIENS.put(cle, JSON.stringify({ ts: Date.now(), ov }), { expirationTtl: 172800 }); }
      catch (e) { /* tant pis */ }
    }
  } catch (e) { /* source injoignable : on garde le cache */ }
  return ov;
}

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
  const calib = d.calib || {};   // facteurs empiriques publiés par le moteur
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
        rec.prob = Math.round((1 - Math.exp(-lam)) * (calib[mk] || 1) * 10000) / 10000;
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
        rec.prob = Math.round((0.5 * poissonGeq(lam, k) + 0.5 * BASE_SEUIL[mk]) * (calib[mk] || 1) * 10000) / 10000;
        rec.lam = jsRound(lam, 3);
        rec.score = jsRound(100 * rec.prob, 1);
        if (rec.score > 0) rec.confidence = jsRound(confidenceFr(rec.prob, p.gp, p.flags || [], preseason), 1);
        rec.palierRel = baremeDeRel(rec.score, mk, baremes);
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
  ["buteur", "passeur", "pointeur", "doubleButeur", "tripleButeur", "doublePointeur",
   "triplePointeur"].forEach((mk) => {
    m.players.forEach((p) => { if (p[mk]) p[mk].valeur = valeurLab(p, p[mk].confidence, p[mk].rank); });
  });
  const octx = { calib, baremes, paliers };
  m.outsiders = outsidersDe(m, null, octx);
  m.outsidersButeur = outsidersDe(m, "buteur", octx);
  m.outsidersPointeur = outsidersDe(m, "pointeur", octx);
  m.outsidersDoubleButeur = outsidersDe(m, "doubleButeur", octx);
  m.outsidersTripleButeur = outsidersDe(m, "tripleButeur", octx);
  m.outsidersDoublePointeur = outsidersDe(m, "doublePointeur", octx);
  m.outsidersTriplePointeur = outsidersDe(m, "triplePointeur", octx);
  m.combos = {};
  [["away", m.away], ["home", m.home]].forEach(([side, ab]) => {
    m.combos[side] = {
      double: comboDe(m, ab, 2, "doubleChance", 1, baremes, calib),
      triple: comboDe(m, ab, 3, "tripleChance", 1, baremes, calib),
      duo15: comboDe(m, ab, 2, "duo15", 2, baremes, calib),
      trio15: comboDe(m, ab, 3, "trio15", 2, baremes, calib),
    };
  });
  m.combos.mixte = {
    double: comboDe(m, null, 2, "doubleChance", 1, baremes, calib),
    triple: comboDe(m, null, 3, "tripleChance", 1, baremes, calib),
    duo15: comboDe(m, null, 2, "duo15", 2, baremes, calib),
    trio15: comboDe(m, null, 3, "trio15", 2, baremes, calib),
  };
  return m;
}
// outsiders : port exact de _outsiders() d'engine.py (marchés à seuils inclus)
const SEUILS_OUTS = ["doubleButeur", "tripleButeur", "doublePointeur", "triplePointeur"];
const MK_FR_OUTS = { doubleButeur: "2+ buts", tripleButeur: "3+ buts", doublePointeur: "2+ points", triplePointeur: "3+ points" };
function outsidersDe(m, mkt, octx) {
  const { calib, baremes, paliers } = octx || {};
  const estSeuil = SEUILS_OUTS.includes(mkt);
  let minConf = 40, needPal = 1;
  if (estSeuil) { minConf = mkt === "tripleButeur" ? 20 : 28; needPal = 2; }
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
    if (conf < minConf || !p[mk].rank || p[mk].rank < 4 || p[mk].rank > 15) continue;
    if (estSeuil && (p[mk].palierRel || p[mk].palier || 1) < needPal) continue;
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
    if (estSeuil) {
      const lh = p[mk].logHit || {};
      const k = { doubleButeur: 2, tripleButeur: 3, doublePointeur: 2, triplePointeur: 3 }[mkt];
      const unite = (mkt === "doubleButeur" || mkt === "tripleButeur") ? "buts" : "points";
      if ((lh.deja || 0) >= 2 && lh.n)
        bits.push("a déjà signé " + k + "+ " + unite + " " + lh.deja + " fois sur ses " + lh.n + " derniers matchs");
    }
    if (!bits.length) continue;
    const c = (octx || {}).calib || {};
    const gOut = Math.max(0.6, Math.min(1.3, (c["outsider" + mk[0].toUpperCase() + mk.slice(1)] || 1)
      / Math.max(c[mk] || 1, 1e-9)));
    const probO = Math.round((p[mk].prob || 0) * gOut * 10000) / 10000;
    const confO = jsRound(conf * Math.pow(gOut, 0.55), 1);
    const palO = estSeuil ? baremeDe(probO * 100, mk, (octx || {}).baremes || BAREMES_DEF)
                          : palierDe(confO, (octx || {}).paliers || PALIERS_DEF);
    out.push({ id: p.id, name: p.name, abbr: p.abbr, mk: MK_FR_OUTS[mk] || mk, rank: p[mk].rank,
      prob: probO, confidence: confO, palier: palO, etoiles: etoilesDe(palO),
      valeur: p[mk].valeur || "PROBABLE", why: bits.slice(0, 2).join(" ; ") + "." });
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
function comboDe(m, sideAbbr, n, mkKey, k, baremes, calib) {
  // sideAbbr null → MIXTE : les n meilleurs buteurs du match, toutes équipes
  const sel = m.players.filter((p) => (sideAbbr === null || p.abbr === sideAbbr)
    && !(p.flags || []).includes("absent") && p.buteur && p.buteur.rank)
    .sort((a, b) => a.buteur.rank - b.buteur.rank).slice(0, n);
  if (sel.length < n) return null;
  let prob;
  if (k === 1) {
    let paucun = 1;
    sel.forEach((p) => { paucun *= 1 - (p.buteur.prob || 0); });
    // buts de coéquipiers corrélés : l'indépendance surestime l'union
    prob = (1 - paucun) * (n === 2 ? 0.95 : 0.88);
  } else {
    // λ minoré + décote queue : les soirées sans but existent
    const lam = sel.reduce((som, p) => som + (p.buteur.lam || 0), 0) * 0.85;
    prob = poissonGeq(lam, k) * 0.75;
  }
  const cleCal = { doubleChance: "duo", tripleChance: "trio" }[mkKey] || mkKey;
  prob = Math.round(prob * (((calib || {})[cleCal]) || 1) * 10000) / 10000;
  const pc100 = prob * 100;
  const pal = baremeDe(pc100, mkKey, baremes);
  const conf = jsRound(0.6 * sel.reduce((som, p) => som + (p.buteur.confidence || 0), 0) / n + 0.4 * pc100, 1);
  const val = sel.some((p) => p.buteur.valeur === "VALUE") ? "VALUE" : (conf >= 65 ? "SUR" : "PROBABLE");
  return { prob, palier: pal, etoiles: etoilesDe(pal), confidence: conf, valeur: val,
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
  const ovManuel = await overridesJour(date);
  const ov = Object.assign({}, await dfoConfirms(date, d), ovManuel);
  if (Object.keys(ov).length) jeux.forEach((g) => adapteMatch(g, ov, d));
  if (!rest) return [texteGardiens(date, jeux, ovManuel)];
  const ann = rest.match(/^(annule|annuler|reset|efface|effacer|supprime|supprimer|retire|retirer)\s*(.*)$/i);
  if (ann) {
    const team = resolveTeam(ann[2].trim(), d);
    if (!team) return ["Donne l'équipe : « gardien annule VAN »."];
    if (!ovManuel[team]) return ["Aucun gardien corrigé pour " + esc(team) + "."];
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
  const ov2 = Object.assign({}, ov);
  ov2[tm] = { name: gk.name, playerId: gk.playerId, sv: gk.sv };
  adapteMatch(jeu, ov2, d);
  const ad = (jeu.adaptations || [])[0] || {};
  const head = "✅ <b>Gardien pris en compte : " + esc(gk.name) + " (" + esc(tm) + ")</b> — " + pcfr(gk.sv)
    + "\nFacteur gardien ×" + f1fr(fOld) + " → ×" + f1fr(ad.fNouv) + " · toutes tes analyses du "
    + esc(date) + " sont adaptées (3 jours).\n« gardien annule " + esc(tm) + " » pour revenir à l'annonce.\n";
  return [head + blocMatch(jeu, ["buteur", "pointeur"])];
}
async function jourAdapte(date, d, force) {
  const jeux = await jourComplet(date);
  // confirmations Daily Faceoff + corrections manuelles (le manuel a priorité)
  const ov = Object.assign({}, await dfoConfirms(date, d, force), await overridesJour(date));
  if (Object.keys(ov).length) jeux.forEach((g) => adapteMatch(g, ov, d));
  return jeux;
}

/* ---------- choix du jour ---------- */
function dates(d) { return [...new Set(d.games.map((g) => g.date))].sort(); }
function aujourdhui() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
}
function jourDefaut(d) {
  const ds = dates(d);
  const u = new Date(), tU = u.toISOString().slice(0, 10);
  // Les matchs se jouent la NUIT américaine : entre minuit et 07h00 UTC, le
  // jour qui compte reste la veille (matchs tardifs encore en cours), pas la
  // date du calendrier parisien — sinon les confirmations DFO du soir sont ratées.
  if (u.getUTCHours() < 7) {
    const veille = ds.filter((x) => x < tU).pop();
    if (veille) return veille;
  }
  return ds.find((x) => x >= tU) || ds[ds.length - 1];
}

/* ---------- analyse de la demande ---------- */
function parseRequete(text, d) {
  let t = na(text);
  const q = { marches: [], equipes: [], nums: [], date: null, tout: false, podium: false, liste: false, aide: false, top: false };
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
  if (/\btop\b/.test(reste)) { q.top = true; reste = reste.replace(/\btop\b/g, " "); }
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
const pctNom = (prob, name, news) => pct(prob) + " " + esc(name) + (news ? " 📰" : "");
const mLabel = (g) => esc(g.away) + "@" + esc(g.home);
function ligneJoueur(p, mk, i) {
  return pctNom(p[mk].prob, p.name, p.news);
}
function blocMatch(g, marches) {
  const L = [];
  L.push("🏒 " + eq(g.away) + " <b>@</b> " + eq(g.home) + " · " + heureFr(g.startUtc)
    + (g.preseason ? " · ⚠️ présaison" : "")
    + (g.piege ? "\n⚠️ <b>PIÈGE</b> — " + esc(g.piege) : ""));
  const gkA = g.ctx && g.ctx.home ? g.ctx.home.goalie : null;   // ctx porte le gardien ADVERSE
  const gkH = g.ctx && g.ctx.away ? g.ctx.away.goalie : null;
  if (gkA || gkH)
    L.push("🥅 " + eq(g.away) + " " + gkTxt(gkA) + " · " + eq(g.home) + " " + gkTxt(gkH));
  if ((g.adaptations || []).length)
    L.push("🧤 " + g.adaptations.map((x) => eq(x.equipe) + " → " + esc(x.nom)).join(" · "));
  for (const mk of marches) {
    if (mk === "outsider") {
      if ((g.outsiders || []).length) {
        L.push("🎯 <b>OUTSIDERS</b>");
        g.outsiders.forEach((o) => L.push(" " + pct(o.prob) + " " + esc(o.name) + " (" + esc(o.mk)
          + ") — " + esc(court(o.why))));
      } else {
        L.push("🎯 pas d'outsider justifié (signaux trop faibles hors favoris)");
      }
      continue;
    }
    if (mk === "duo15" || mk === "trio15") {
      const lab = MARCHES.find((m) => m[0] === mk)[1].toUpperCase();
      const cb = g.combos && ((g.combos.mixte && g.combos.mixte[mk]) || (g.combos.away && g.combos.away[mk]));
      if (cb) L.push("⚔️ <b>" + lab + "</b> " + pct(cb.prob) + " — " + esc(cb.members.map((x) => x.name).join(" + ")));
      continue;
    }
    if (OUTS_CHAMP[mk] && mk !== "outsider") {
      const liste = g[OUTS_CHAMP[mk]] || [];
      if (!liste.length) continue;                // personne d'éligible → pas de bloc
      L.push("🎯 <b>" + MARCHES.find((m) => m[0] === mk)[1].toUpperCase() + "</b>");
      liste.forEach((o) => L.push(" " + pct(o.prob) + " " + esc(o.name) + " (" + esc(o.mk)
        + ") — " + esc(court(o.why))));
      continue;
    }
    if (mk === "doubleChance" || mk === "tripleChance") {
      const nk = mk === "doubleChance" ? "double" : "triple";
      const lab = MARCHES.find((m) => m[0] === mk)[1].toUpperCase();
      const cb = g.combos && ((g.combos.mixte && g.combos.mixte[nk]) || (g.combos.away && g.combos.away[nk]));
      if (cb) L.push("🎲 <b>" + lab + "</b> " + pct(cb.prob) + " — " + esc(cb.members.map((x) => x.name).join(" ou ")));
      continue;
    }
    // marché simple : top 3 par équipe, une ligne, % décroissant
    const lab = MARCHES.find((m) => m[0] === mk)[1].toUpperCase();
    if (marches.indexOf(mk) === marches.findIndex((x) => MK_SIMPLE.includes(x)))
      L.push("🎯 <b>" + lab + "</b>");
    ["away", "home"].forEach((side) => {
      const top = (g.players || []).filter((p) => p.abbr === g[side] && p[mk] && p[mk].rank)
        .sort((a, b) => a[mk].rank - b[mk].rank).slice(0, 3)
        .sort((a, b) => b[mk].prob - a[mk].prob);
      if (top.length) L.push(" " + eq(g[side]) + " · " + top.map((p) => ligneJoueur(p, mk)).join(" · "));
    });
  }
  return L.join("\n");
}

// ---- collecte d'un marché sur tous les matchs, triée par % décroissant ----
function rowsMarche(jeux, mk) {
  const NK = { duo15: "duo15", trio15: "trio15", doubleChance: "double", tripleChance: "triple" };
  const rows = [];
  if (NK[mk]) {
    const sep = (mk === "duo15" || mk === "trio15") ? " + " : " ou ";
    jeux.forEach((g) => {
      const cb = g.combos && ((g.combos.mixte && g.combos.mixte[NK[mk]]) || (g.combos.away && g.combos.away[NK[mk]]));
      if (cb) rows.push({ prob: cb.prob, g, txt: esc(cb.members.map((x) => x.name).join(sep))
        + " — " + eq(g.away) + " @ " + eq(g.home) });
    });
  } else if (OUTS_CHAMP[mk]) {
    jeux.forEach((g) => (g[OUTS_CHAMP[mk]] || []).forEach((o) =>
      rows.push({ prob: o.prob, g, txt: esc(o.name) + " · " + esc(o.mk) + " — "
        + eq(g.away) + " @ " + eq(g.home) + "  <i>" + esc(court(o.why)) + "</i>" })));
  } else {
    jeux.forEach((g) => ["away", "home"].forEach((side) => {
      (g.players || []).filter((p) => p.abbr === g[side] && p[mk] && p[mk].rank && p[mk].rank <= 2)
        .forEach((p) => rows.push({ prob: p[mk].prob, news: p.news, g,
          txt: esc(p.name) + " — " + eq(p.abbr) + " @ " + eq(p.opp) }));
    }));
  }
  rows.sort((a, b) => b.prob - a.prob);
  return rows;
}

// ---- 📊 CLASSEMENT : le marché de ton choix, % décroissant, sur boutons ----
function blocClassement(date, jeux, mk) {
  const code = Object.keys(MK_CODE).find((c) => MK_CODE[c] === mk) || "1";
  const rows = rowsMarche(jeux, mk);
  const L = ["📊 <b>CLASSEMENT — " + esc(MK_LIB[code] || mk) + "</b>",
    "📅 " + esc(dateFr(date)) + " · " + jeux.length + " matchs · % décroissant"];
  const r1 = rows[0];
  if (r1) L.push("🎯 <b>MON PICK → " + r1.txt.replace(/\s*<i>[\s\S]*<\/i>/, "") + "  " + pct(r1.prob) + "</b>"
    + (r1.prob >= 0.7 ? " ✅" : "") + (r1.g && r1.g.piege ? " ⚠️ <i>piège</i>" : ""));
  L.push(SEP);
  if (!rows.length) {
    L.push("Aucun pick sur ce marché — signaux trop faibles hors favoris.");
  } else {
    rows.slice(0, 14).forEach((r, i) => L.push(rang(i) + " <b>" + pct(r.prob) + "</b>  "
      + r.txt + (r.news ? " 📰" : "")));
  }
  const pieges = jeux.filter((g) => g.piege);
  if (pieges.length) {
    L.push(SEP, "⚠️ <b>PIÈGES</b>");
    pieges.forEach((g) => L.push(" " + eq(g.away) + " @ " + eq(g.home) + " — " + esc(g.piege)));
  }
  L.push("", "<i>Marché : boutons ci-dessous · 🔄 refresh = gardiens revérifiés</i>");
  return L.join("\n");
}
const GROUPES_CLAS = [["1", "3", "2"], ["4", "6"], ["8", "9"], ["0"]];
function kbClassement(etat, actif) {
  const lignes = GROUPES_CLAS.map((gr) => gr.map((c) =>
    btn((c === actif ? "▸ " : "") + MK_LIB[c], "Z:" + etat + ":" + c)));
  lignes.push([btn("« Menu", "M:" + etat), btn("🔄 Refresh", "W:" + etat)]);
  return { inline_keyboard: lignes };
}

// ---- liste globale : tous les matchs d'un coup, triée par % décroissant ----
const court = (t) => {
  const x = (t || "").replace(/\.$/, "");
  if (x.length <= 80) return x;
  const c = x.slice(0, 80);
  return c.slice(0, c.lastIndexOf(" ")) + "…";
};
function blocGlobal(date, jeux, marches) {
  const L = ["📅 <b>" + esc(dateFr(date)) + "</b> · " + jeux.length + " matchs · % décroissant"];
  for (const mk of marches) {
    const lab = (MARCHES.find((x) => x[0] === mk) || [mk, mk])[1].toUpperCase();
    const rows = rowsMarche(jeux, mk);
    L.push("", "🎯 <b>" + lab + "</b>");
    if (rows.length) {
      rows.slice(0, 14).forEach((r, i) => L.push(rang(i) + " <b>" + pct(r.prob) + "</b>  "
        + r.txt + (r.news ? " 📰" : "")));
    } else {
      L.push(" Aucun pick justifié sur ce marché.");
    }
  }
  const pieges = jeux.filter((g) => g.piege);
  if (pieges.length) {
    L.push("", SEP, "⚠️ <b>MATCHS PIÈGES</b>");
    pieges.forEach((g) => L.push(" " + eq(g.away) + " @ " + eq(g.home) + " — " + esc(g.piege)));
  }
  L.push("", "✅ SÛR · 🔥 VALUE · 💎 OUTSIDER");
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
    top.slice(0, 3).forEach((r, i) => L.push(" " + med[i] + " " + pct(r.p[mk].prob) + " " + esc(r.p.name)
      + " (" + esc(r.p.abbr) + " vs " + esc(r.p.opp) + ")" + (r.p.news ? " 📰" : "")));
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

/* ---------- 🎯 MES PICKS : un seul nom par marché — le choix, pas la liste ---------- */
function fluxPick(date, jeux) {
  if (!jeux.length) return ["Aucun match analysé le " + esc(dateFr(date)) + "."];
  const L = ["🎯 <b>MES PICKS — " + esc(dateFr(date)) + "</b>",
    "<i>Un nom par marché. Pas d'hésitation.</i>", SEP];
  const defs = [["⚡", "buteur", "BUTEUR 1+"], ["📈", "pointeur", "POINTEUR 1+"],
    ["✨", "doublePointeur", "2+ POINTS"], ["🎲", "doubleChance", "DOUBLE CHANCE"],
    ["💎", "outsider", "OUTSIDER"]];
  let n = 0;
  defs.forEach(([ico, mk, lab]) => {
    const rows = rowsMarche(jeux, mk);
    if (!rows.length) return;
    const r = rows[0];
    const piege = r.g && r.g.piege;
    n++;
    L.push(ico + " <b>" + lab + "</b>");
    L.push("   → <b>" + r.txt.replace(/\s*<i>[\s\S]*<\/i>/, "") + "</b>  <b>" + pct(r.prob) + "</b>"
      + (r.prob >= 0.7 ? " ✅" : "") + (r.news ? " 📰" : "")
      + (piege ? "  ⚠️ <i>match piège</i>" : ""));
    if (rows.length > 1 && rows[1].prob >= r.prob - 0.06)
      L.push("   <i>sinon</i> " + rows[1].txt.replace(/\s*<i>[\s\S]*<\/i>/, "") + "  " + pct(rows[1].prob));
  });
  if (!n) L.push("Rien d'assez solide ce soir — passe ton tour, c'est aussi un choix.");
  else {
    L.push(SEP);
    L.push("✅ SÛR · 🔥 VALUE · 💎 OUTSIDER · 📰 blessure · ⚠️ piège");
    L.push("<i>Tout comparer : /classement · tout le détail : /buteur, /pointeur…</i>");
  }
  return [L.join("\n")];
}

/* ---------- 🎰 COMBINÉS : 3 profils, tailles ×2/×3/×5, MyMatch ----------
   Maths honnêtes : un combiné MULTIPLIE les probabilités (et les gains).
   - entre matchs différents → indépendance réelle, produit exact ;
   - même match (MyMatch) → corrélation, produit minoré de 5 %.
   Les matchs pièges sont exclus des profils. */
function fluxCombi(date, jeux) {
  const piege = new Set(jeux.filter((g) => g.piege).map((g) => String(g.id)));
  const pasPiege = (r) => r.g && !piege.has(String(r.g.id));
  const uniq = (rows) => { const vus = new Set(); return rows.filter((r) => {
    const k = String(r.g.id); if (vus.has(k)) return false; vus.add(k); return true; }); };
  const pts = uniq(rowsMarche(jeux, "pointeur").filter(pasPiege));
  const buts = uniq(rowsMarche(jeux, "buteur").filter(pasPiege));
  const p2 = uniq(rowsMarche(jeux, "doublePointeur").filter(pasPiege));
  const p3 = uniq(rowsMarche(jeux, "triplePointeur").filter(pasPiege));
  pts.forEach((r) => { r.lb = "1+ pt"; });
  buts.forEach((r) => { r.lb = "1+ but"; });
  p2.forEach((r) => { r.lb = "2+ pts"; });
  p3.forEach((r) => { r.lb = "3+ pts"; });
  const prod = (rows) => rows.reduce((x, r) => x * r.prob, 1);
  const t = (r) => r.txt.replace(/\s*<i>[\s\S]*<\/i>/, "");
  const autreMatch = (liste, r) => !liste.some((x) => String(x.g.id) === String(r.g.id));
  const L = ["🎰 <b>COMBINÉS — " + esc(dateFr(date)) + "</b>",
    "<i>Un combiné multiplie les probabilités : gros gain, plus petit %.</i>", SEP];
  const profil = (ico, titre, rows, note) => {
    if (rows.length < 2) return;
    const cinq = rows.slice(0, 5);
    L.push(ico + " <b>" + titre + "</b>" + (note ? " <i>" + note + "</i>" : ""));
    cinq.forEach((r, i) => L.push(" " + (i + 1) + ". " + t(r) + (r.lb ? " <i>" + r.lb + "</i>" : "")
      + " · <b>" + pct(r.prob) + "</b>" + (r.news ? " 📰" : "")));
    L.push(" → " + [[2, "×2"], [3, "×3"], [5, "×5"]].filter(([n]) => cinq.length >= n)
      .map(([n, lb]) => lb + " = <b>" + pct(prod(cinq.slice(0, n))) + "</b>").join(" · "), "");
  };
  profil("🔒", "PROFIL SÛR · 1+ point", pts);
  const eqm = pts.slice(0, 3);
  buts.forEach((r) => { if (eqm.length < 5 && autreMatch(eqm, r)) eqm.push(r); });
  profil("⚡", "PROFIL ÉQUILIBRÉ · points + buts", eqm);
  const jk = [];
  const prends = (src, max) => { let n = 0; src.forEach((r) => {
    if (jk.length < 5 && n < max && autreMatch(jk, r)) { jk.push(r); n++; } }); };
  prends(p2, 3); prends(p3, 1); prends(buts, 2);
  profil("💎", "PROFIL JACKPOT · 2+/3+ points & buts", jk);
  const mm = [];
  jeux.forEach((g) => {
    const pl = (g.players || []).find((p) => p.pointeur && p.pointeur.rank === 1);
    const bu = (g.players || []).find((p) => p.buteur && p.buteur.rank === 1 && (!pl || p.id !== pl.id));
    if (!pl || !bu) return;
    const disc = pl.abbr === bu.abbr ? 0.95 : 0.97;
    mm.push({ g, pl, bu, prob: pl.pointeur.prob * bu.buteur.prob * disc });
  });
  mm.sort((a, b) => b.prob - a.prob);
  if (mm.length) {
    L.push("🏟 <b>MYMATCH — 2 joueurs du même match</b>");
    mm.slice(0, 3).forEach((m) => {
      L.push(eq(m.g.away) + " @ " + eq(m.g.home) + " — <b>" + pct(m.prob) + "</b>"
        + (m.g.piege ? " ⚠️ <i>piège</i>" : ""));
      L.push("  " + esc(m.pl.name) + " " + eq(m.pl.abbr) + " 1+ point (" + pct(m.pl.pointeur.prob) + ")"
        + " + " + esc(m.bu.name) + " " + eq(m.bu.abbr) + " 1+ but (" + pct(m.bu.buteur.prob) + ")");
    });
  }
  const pj = jeux.filter((g) => g.piege);
  if (pj.length) {
    L.push("", "⚠️ <b>Écartés des profils</b> (pièges) : "
      + pj.map((g) => esc(g.away) + "@" + esc(g.home)).join(" · "));
  }
  L.push("", "<i>Vérifie les cotes Winamax : combiné rentable si cote × proba > 1.</i>");
  return [L.join("\n")];
}

/* ---------- 🔄 refresh : gardiens revérifiés MAINTENANT, analyses réadaptées ---------- */
async function fluxRefresh(d) {
  const date = jourDefaut(d);
  const jeux = await jourAdapte(date, d, true);
  const gks = [];
  jeux.forEach((g) => {
    const ga = g.ctx && g.ctx.home ? g.ctx.home.goalie : null;
    const gh = g.ctx && g.ctx.away ? g.ctx.away.goalie : null;
    [[g.away, ga], [g.home, gh]].forEach(([ab, gk]) => {
      if (gk && gk.estimated === false) gks.push(eq(ab) + " " + esc(gk.name));
    });
  });
  const nAd = jeux.filter((g) => (g.adaptations || []).length).length;
  return ["🔄 <b>ACTUALISÉ</b> — " + esc(dateFr(date)),
    "🥅 " + (gks.length ? "<b>" + gks.length + " gardiens confirmés</b> (source Daily Faceoff, relu à l'instant) :\n "
      + gks.slice(0, 10).join(" · ") + (gks.length > 10 ? " …" : "")
      : "aucun gardien confirmé pour l'instant — les probables restent en place"),
    "🧮 Analyses " + (nAd ? "réadaptées sur " + nAd + " match" + (nAd > 1 ? "s" : "")
      : "à jour") + " avec ces gardiens.",
    "", "<i>Le bot revérifie aussi tout seul toutes les 20 min dès que tu lui parles.</i>"];
}

/* ---------- réponse complète ---------- */
let CLAVIER_REP = null;   // clavier demandé par la réponse texte (ex. /classement)
async function traite(text, chatId) {
  const d = await index();
  const gm = String(text || "").trim().match(/^\/?gardiens?\s*(.*)$/i);
  if (gm) return fluxGardien(gm[1].trim(), d);
  const bm = String(text || "").trim().match(/^\/?(bilan|stats|efficacite|efficacité|reussite|réussite|resultats|résultats)(?:\s+(.*))?$/i);
  if (bm) return fluxBilan(d, bm[2] || "");
  if (/^\/?(news|actus|actualites|actualités|infos)$/i.test(String(text || "").trim()))
    return fluxNews();
  const tx = String(text || "").trim();
  if (/^\/?(refresh|maj|rafrai?chi?r?|rafraîchir?)$/i.test(tx)) return await fluxRefresh(d);
  if (/^\/?(ticket|tickets|monticket|bet slip|slip)$/i.test(tx)) {
    const dateT = jourDefaut(d);
    const jeuxT = await jourAdapte(dateT, d);
    const t = await ticketLoad(chatId);
    CLAVIER_REP = kbTicketHome(encodeEtat([], dates(d).indexOf(dateT)), jeuxT, t);
    return [texteTicketHome(dateT, t)];
  }
  if (/^\/?(combi|combis|combiné|combine|combinaison|jackpot|mymatch)$/i.test(tx)) {
    const dateC = jourDefaut(d);
    return fluxCombi(dateC, await jourAdapte(dateC, d));
  }
  if (/^\/?(pick|picks|monpick|mespicks?|choix)$/i.test(tx)) {
    const dateP = jourDefaut(d);
    return fluxPick(dateP, await jourAdapte(dateP, d));
  }
  const clm = tx.match(/^\/?(classement|ranking|classements)(?:\s+([\s\S]*))?$/i);
  if (clm) {
    const qc = parseRequete(clm[2] || "buteur", d);
    const mk = (qc.marches || [])[0] || "buteur";
    const date0 = qc.date && dates(d).includes(qc.date) ? qc.date : jourDefaut(d);
    CLAVIER_REP = kbClassement(encodeEtat([], dates(d).indexOf(date0)), mk);
    return [blocClassement(date0, await jourAdapte(date0, d), mk)];
  }
  const q = parseRequete(text, d);
  const ds = dates(d);
  if (q.aide) return [AIDE];
  if (q.date === "*") return ["🗓 <b>Jours analysés</b>\n" + ds.join("\n") + "\n(mise à jour : " + esc(d.generatedUtc) + ")"];
  const date = q.date || jourDefaut(d);
  if (!ds.includes(date)) return ["Pas d'analyse pour le " + esc(date) + ". Prochains jours : " + ds.slice(0, 8).join(", ")];
  const jeuxJour = await jourAdapte(date, d); // index + joueurs + gardiens corrigés
  const jeux = selection(jeuxJour, q);
  if (q.liste && !q.marches.length) return [blocListe(date, jeuxJour)];
  if (q.top) {
    let mks = q.marches.filter((m) => m !== "*" && m !== "top");
    if (!mks.length) mks = ["buteur", "pointeur"];   // défaut du /top
    return [blocTop(date, jeuxJour, ordonneMk(mks))];
  }
  if (q.podium) return [blocPodium(date, jeuxJour)];
  if (!jeux.length) return ["Aucun match ne correspond le " + esc(date) + ". /matchs pour la liste."];
  let marches = q.marches.filter((m) => m !== "*");
  if (!marches.length) marches = ["buteur", "pointeur"]; // défaut = celui du site
  marches = ordonneMk(marches);
  // plusieurs matchs + peu de marchés → une seule liste globale triée par %
  if (jeux.length > 1 && marches.length <= 3 && !q.tout) return [blocGlobal(date, jeux, marches)];
  return morceauxResultats(date, jeux, marches);
}
const ORDRE_MK = [...MK_SIMPLE, "doubleChance", "tripleChance", "duo15", "trio15",
                  "outsiderButeur", "outsiderPointeur", "outsiderDoubleButeur",
                  "outsiderTripleButeur", "outsiderDoublePointeur", "outsiderTriplePointeur",
                  "outsider"];
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

/* ---------- top du jour : le meilleur de chaque filtre actif ---------- */
function blocTop(date, jeux, marches) {
  if (!jeux.length) return "Aucun match le " + esc(date) + ".";
  const L = ["🌟 <b>TOP DU JOUR — " + esc(date) + "</b>"];
  const med = ["🥇", "🥈", "🥉"];
  marches.forEach((mk) => {
    const lab = (MARCHES.find((x) => x[0] === mk) || [mk, mk])[1].toUpperCase();
    const rows = [];
    if (mk === "duo15" || mk === "trio15" || mk === "doubleChance" || mk === "tripleChance") {
      const nk = { duo15: "duo15", trio15: "trio15", doubleChance: "double", tripleChance: "triple" }[mk];
      const sep = (mk === "duo15" || mk === "trio15") ? " + " : " ou ";
      jeux.forEach((g) => {
        const cb = g.combos && ((g.combos.mixte && g.combos.mixte[nk]) || (g.combos.away && g.combos.away[nk]));
        if (cb) rows.push({ txt: cb.members.map((x) => x.name).join(sep) + " (" + mLabel(g) + ")",
          prob: cb.prob, conf: cb.confidence, g });
      });
    } else if (OUTS_CHAMP[mk]) {
      jeux.forEach((g) => (g[OUTS_CHAMP[mk]] || []).forEach((o) => rows.push({
        txt: o.name + " (" + o.abbr + ") — " + o.mk,
        prob: o.prob, conf: o.confidence, g })));
    } else {
      jeux.forEach((g) => (g.players || []).forEach((p) => {
        if (p[mk] && p[mk].rank) rows.push({ txt: p.name + " (" + p.abbr + " vs " + p.opp + ")",
          prob: p[mk].prob, conf: p[mk].confidence, news: p.news, g });
      }));
    }
    rows.sort((a, b) => b.conf - a.conf || b.prob - a.prob);
    if (!rows.length) return;
    L.push("<b>" + lab + "</b>");
    rows.slice(0, 3).forEach((r, i) => L.push(" " + med[i] + " " + pct(r.prob) + " " + esc(r.txt)
      + (r.news ? " 📰" : "") + " · " + heureFr(r.g.startUtc)));
  });
  return L.join("\n");
}

/* ---------- 🎫 TICKETS : construis ton combiné dans Telegram ----------
   Sélections stockées en KV par chat (3 jours). On peut tout combiner sauf
   deux marchés contradictoires du MÊME joueur (2+ points couvre 1+ point). */
const TICKET_TTL = 3 * 86400;
const ticketLoad = async (chatId) => {
  const t = (ENV.GARDIENS
    && (await ENV.GARDIENS.get("ticket:" + chatId, "json").catch(() => null))) || { sel: [] };
  // Ignore old stored shot selections: this market is not offered on Winamax.
  t.sel = (t.sel || []).filter((x) => x.mk !== "tirs");
  return t;
};
async function ticketSave(chatId, t) {
  if (ENV.GARDIENS) await ENV.GARDIENS.put("ticket:" + chatId, JSON.stringify(t),
    { expirationTtl: TICKET_TTL }).catch(() => {});
}
const ICO_MK = { buteur: "⚡", pointeur: "📈", passeur: "🅰️", doubleButeur: "⚡⚡",
  doublePointeur: "✨", duo: "👥" };
const LAB_MK = { buteur: "1+ but", pointeur: "1+ point", passeur: "1+ passe",
  doubleButeur: "2+ buts", doublePointeur: "2+ points", duo: "duo 1+ but" };
const descape = (t) => String(t).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const FAMILLE_MK = { buteur: "G", doubleButeur: "G", tripleButeur: "G",
  pointeur: "P", passeur: "P", doublePointeur: "P", triplePointeur: "P" };
function choixDuMatch(jeux, gid) {
  const g = jeux.find((x) => String(x.id) === String(gid));
  if (!g) return null;
  const eqs = eq(g.away) + " @ " + eq(g.home);
  const out = [];
  const top = (mk, n) => (g.players || [])
    .filter((p) => p[mk] && p[mk].rank && p[mk].rank <= n && !(p.flags || []).includes("absent"))
    .sort((a, b) => a[mk].rank - b[mk].rank).slice(0, n)
    .forEach((p) => out.push({ gid: String(gid), eq: eqs, mk, id: p.id,
      name: p.name, prob: p[mk].prob }));
  top("pointeur", 2); top("buteur", 2); top("doublePointeur", 1);
  const cb = (g.combos || {}).mixte && g.combos.mixte.double;
  if (cb && cb.members) out.push({ gid: String(gid), eq: eqs, mk: "duo", id: 0,
    name: cb.members.map((x) => x.name).join(" + "), prob: cb.prob });
  return { g, eqs, choix: out };
}
const probaTicket = (sel) => {
  const jeuxVus = new Set(sel.map((x) => x.gid));
  const corr = Math.pow(0.95, Math.max(0, sel.length - jeuxVus.size));
  return sel.reduce((a, x) => a * (x.prob || 0), 1) * (sel.length ? corr : 1);
};
function noteTicket(p) {
  if (p >= 0.5) return "🧭 Solide — confiance justifiée";
  if (p >= 0.25) return "🧭 Équilibré — mise standard";
  if (p >= 0.1) return "🧭 Audacieux — petite mise";
  return "🧭 Très audacieux — ticket loterie";
}
function lignesTicket(sel) {
  return sel.map((x, i) => " " + (i + 1) + ". " + esc(x.name) + " — " + x.eq + " · "
    + (ICO_MK[x.mk] || "") + " " + (LAB_MK[x.mk] || x.mk) + " · <b>" + pct(x.prob) + "</b>");
}
function kbTicketHome(etat, jeux, t) {
  const lignes = [];
  ((t || {}).sel || []).forEach((x, i) => lignes.push([btn("✂️ " + (i + 1) + ". "
    + x.name.slice(0, 24) + " " + (ICO_MK[x.mk] || ""), "U:" + etat + ":" + i)]));
  for (let i = 0; i < jeux.length; i += 2)
    lignes.push(jeux.slice(i, i + 2).map((g) => btn(eq(g.away) + " @ " + eq(g.home),
      "Q:" + etat + ":" + g.id)));
  lignes.push([btn("🔒 Mon ticket SÛR", "J:" + etat + ":s"),
               btn("⚖️ Équilibré", "J:" + etat + ":e"),
               btn("💎 Jackpot", "J:" + etat + ":j")]);
  lignes.push([btn("✅ Récapitulatif", "I:" + etat), btn("🗑 Vider", "E:" + etat)]);
  return { inline_keyboard: lignes };
}
function texteTicketHome(date, t) {
  const L = ["🎫 <b>TICKET — " + esc(dateFr(date)) + "</b>"];
  if (t.sel.length) {
    L.push(SEP, "<b>MES SÉLECTIONS</b> — " + t.sel.length + " pari" + (t.sel.length > 1 ? "s" : ""));
    L.push(...lignesTicket(t.sel));
    L.push("", "📊 Proba combinée ≈ <b>" + pct(probaTicket(t.sel)) + "</b>"
      + "  ·  <i>✂️ pour retirer</i>");
  } else {
    L.push("", "<i>Ticket vide — choisis un match 👇 puis tes joueurs.</i>");
  }
  return L.join("\n");
}
function kbTicketMatch(etat, gid, choix, t) {
  const dans = (c) => ((t || {}).sel || []).some((x) => x.gid === c.gid && x.mk === c.mk
    && String(x.id) === String(c.id));
  const lignes = [];
  choix.choix.forEach((c) => lignes.push([btn((dans(c) ? "✓ " : "+ ") + c.name.slice(0, 26) + " "
    + (ICO_MK[c.mk] || "") + " " + Math.round(c.prob * 100) + " %",
    "R:" + etat + ":" + c.gid + "|" + c.mk + "|" + c.id + "|" + Math.round(c.prob * 10000))]));
  lignes.push([btn("⬅️ Matchs", "N:" + etat), btn("✅ Récap", "I:" + etat)]);
  return { inline_keyboard: lignes };
}
function texteTicketMatch(date, t, choix) {
  const L = ["🎫 <b>" + choix.eqs + "</b> — " + esc(dateFr(date)),
    "<i>1 clic = 1 sélection dans le ticket.</i>", SEP];
  const parMk = {};
  choix.choix.forEach((c) => { (parMk[c.mk] = parMk[c.mk] || []).push(c); });
  Object.keys(parMk).forEach((mk) => {
    L.push((ICO_MK[mk] || "") + " <b>" + (LAB_MK[mk] || mk) + "</b>");
    parMk[mk].forEach((c) => L.push("  • " + esc(c.name) + " · <b>" + pct(c.prob) + "</b>"));
  });
  L.push("", SEP, "🎫 Ticket : " + t.sel.length + " sélection" + (t.sel.length > 1 ? "s" : "")
    + (t.sel.length ? " · ≈ <b>" + pct(probaTicket(t.sel)) + "</b>" : ""));
  return L.join("\n");
}
function mesTickets(profil, jeux) {
  const piege = new Set(jeux.filter((g) => g.piege).map((g) => String(g.id)));
  const pasPiege = (r) => r.g && !piege.has(String(r.g.id));
  const uniq = (rows) => { const vus = new Set(); return rows.filter((r) => {
    const k = String(r.g.id); if (vus.has(k)) return false; vus.add(k); return true; }); };
  const pts = uniq(rowsMarche(jeux, "pointeur").filter(pasPiege));
  const buts = uniq(rowsMarche(jeux, "buteur").filter(pasPiege));
  const p2 = uniq(rowsMarche(jeux, "doublePointeur").filter(pasPiege));
  const enSel = (r, mk) => ({ gid: String(r.g.id), eq: eq(r.g.away) + " @ " + eq(r.g.home),
    mk, id: 0, name: descape(r.txt.replace(/ —.*$/, "")), prob: r.prob });
  if (profil === "s") return pts.slice(0, 3).map((r) => enSel(r, "pointeur"));
  if (profil === "e") return [...pts.slice(0, 2).map((r) => enSel(r, "pointeur")),
    ...buts.slice(0, 1).map((r) => enSel(r, "buteur"))];
  const jk = [];
  p2.slice(0, 2).forEach((r) => jk.push(enSel(r, "doublePointeur")));
  buts.forEach((r) => { if (jk.length < 3 && !jk.some((x) => x.gid === String(r.g.id))) jk.push(enSel(r, "buteur")); });
  return jk;
}
function texteTicketRecap(date, t) {
  if (!t.sel.length) return "🎫 Ticket vide — ajoute des sélections d'abord (bouton 🎫 Ticket du menu).";
  const p = probaTicket(t.sel);
  return ["🎫 <b>MON TICKET — " + esc(dateFr(date)) + "</b>", SEP,
    ...lignesTicket(t.sel), "", SEP,
    "📊 <b>PROBABILITÉ COMBINÉE ≈ " + pct(p) + "</b>",
    noteTicket(p), "",
    "<i>Recopie dans Winamax dans le même ordre.</i>"].join("\n");
}

/* ---------- navigation par boutons ---------- */
async function traiteCallback(data, d, chatId) {
  const ds = dates(d);
  const [cmd, etat, extra] = String(data).split(":");
  const { codes, jourIdx } = decodeEtat(etat);
  const date = ds[Math.min(jourIdx, ds.length - 1)] || ds[ds.length - 1];
  const titreF = "⚙️ <b>Filtres</b> — 📅 " + esc(date) + "\nCoche tes marchés puis lance :";
  if (cmd === "A") return { envoie: [AIDE], clavier: kbMenu(etat, d) };
  if (cmd === "B") return { envoie: await fluxBilan(d), clavier: kbMenu(etat, d) };
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
  if (cmd === "O") {
    const jeux = await jourAdapte(date, d);
    return { envoie: morceauxResultats ? [blocTop(date, jeux, ordonneMk(codes.map((c) => MK_CODE[c])))].filter(Boolean) : [], clavier: kbMenu(etat, d) };
  }
  if (cmd === "P") return { envoie: [blocPodium(date, await jourAdapte(date, d))], clavier: kbMenu(etat, d) };
  if (cmd === "K") return { edit: { texte: "📅 <b>Choisis un jour</b> :", clavier: kbJours(etat, d) } };
  if (cmd === "V") {
    const jeux = await jourAdapte(date, d);
    return { envoie: fluxCombi(date, jeux), clavier: kbMenu(etat, d) };
  }
  if (cmd === "X") {
    const jeux = await jourAdapte(date, d);
    return { envoie: fluxPick(date, jeux), clavier: kbMenu(etat, d) };
  }
  if (cmd === "C") {
    const jeux = await jourAdapte(date, d);
    return { envoie: [blocClassement(date, jeux, "buteur")], clavier: kbClassement(etat, "buteur") };
  }
  if (cmd === "Z") {
    const jeux = await jourAdapte(date, d);
    const mk = MK_CODE[extra] || "buteur";
    return { edit: { texte: blocClassement(date, jeux, mk), clavier: kbClassement(etat, extra) } };
  }
  if (cmd === "W") {
    return { envoie: await fluxRefresh(d), clavier: kbMenu(etat, d) };
  }
  if (cmd === "N" || cmd === "Q" || cmd === "R" || cmd === "U" || cmd === "J"
      || cmd === "I" || cmd === "E") {
    const jeux = await jourAdapte(date, d);
    const t = await ticketLoad(chatId);
    if (cmd === "E") {
      await ticketSave(chatId, { date, sel: [] });
      return { edit: { texte: texteTicketHome(date, { sel: [] }), clavier: kbTicketHome(etat, jeux, { sel: [] }) } };
    }
    if (cmd === "J") {
      t.date = date; t.sel = mesTickets(extra, jeux);
      await ticketSave(chatId, t);
      return { edit: { texte: texteTicketRecap(date, t) + "\n\n<i>Ticket chargé — « ⬅️ Modifier » pour changer une jambe.</i>",
        clavier: { inline_keyboard: [[btn("⬅️ Modifier", "N:" + etat), btn("🗑 Vider", "E:" + etat)]] } } };
    }
    if (cmd === "I")
      return { edit: { texte: texteTicketRecap(date, t),
        clavier: { inline_keyboard: [[btn("⬅️ Modifier", "N:" + etat), btn("🗑 Vider", "E:" + etat)]] } } };
    if (cmd === "R") {
      const [gid, mk, id, prob10k] = String(extra).split("|");
      const src = choixDuMatch(jeux, gid);
      const c = src && src.choix.find((x) => x.mk === mk && String(x.id) === String(id));
      if (c) {
        const conflit = mk !== "duo" && t.sel.some((x) => String(x.id) === String(id)
          && x.id !== 0 && FAMILLE_MK[x.mk] === FAMILLE_MK[mk]);
        const deja = t.sel.some((x) => x.gid === gid && x.mk === mk && String(x.id) === String(id));
        if (deja) return { alert: "Déjà dans le ticket.", edit: { texte: texteTicketMatch(date, t, src), clavier: kbTicketMatch(etat, gid, src, t) } };
        if (conflit) return { alert: "❌ Marchés contradictoires : un même joueur ne peut pas avoir deux marchés de buts (ou de points) dans le ticket.", edit: { texte: texteTicketMatch(date, t, src), clavier: kbTicketMatch(etat, gid, src, t) } };
        t.date = date; t.sel.push(c);
        await ticketSave(chatId, t);
      }
      return { edit: { texte: texteTicketMatch(date, t, src), clavier: kbTicketMatch(etat, gid, src, t) } };
    }
    if (cmd === "U") {
      t.sel.splice(parseInt(extra, 10), 1);
      await ticketSave(chatId, t);
      return { edit: { texte: texteTicketHome(date, t), clavier: kbTicketHome(etat, jeux, t) } };
    }
    if (cmd === "Q") {
      const src = choixDuMatch(jeux, extra);
      if (!src) return { edit: { texte: texteTicketHome(date, t), clavier: kbTicketHome(etat, jeux, t) } };
      return { edit: { texte: texteTicketMatch(date, t, src), clavier: kbTicketMatch(etat, src.gid, src, t) } };
    }
    return { edit: { texte: texteTicketHome(date, t), clavier: kbTicketHome(etat, jeux, t) } };
  }
  if (cmd === "H") {
    const arg = String(etat || "");
    if (arg === "sem") return { envoie: await bilanSemaine(), clavier: kbMenu("".padStart(0), d) };
    return { envoie: await bilanJour(arg), clavier: kbBilan(arg) };
  }
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
// Le site est rafraîchi au plus tard 15 min après ton premier message, sans
// dépendre d'un cron extérieur (les crons GitHub/CF sautent des passages).
async function majSiPerime(ENV) {
  try {
    const marqueur = await ENV.GARDIENS.get("maj:site");
    if (marqueur && Date.now() - Number(marqueur) < 15 * 60000) return;
    await ENV.GARDIENS.put("maj:site", String(Date.now()));
    if (!ENV.GITHUB_PAT) return;
    await fetch("https://api.github.com/repos/akrooo2002-prog/NHL-PRO-/actions/workflows/refresh.yml/dispatches", {
      method: "POST",
      headers: { "Authorization": "Bearer " + ENV.GITHUB_PAT,
                 "Accept": "application/vnd.github+json", "User-Agent": "nhl-bot-usage" },
      body: JSON.stringify({ ref: "main", inputs: { deploy_netlify: false } }),
    });
    await majBilan();                                   // photo des pronos + vérification des résultats
  } catch (e) { /* tant pis : le cron GitHub reste en secours */ }
}

/* ---------- bilan : le bot enregistre ses pronos, vérifie les matchs, mesure ---------- */
const NHL_API = "https://api-web.nhle.com/v1";
const MK_BILAN = { buteur: "Buteur 1+", passeur: "Passeur 1+", pointeur: "Pointeur 1+",
  doubleButeur: "2+ buts", tripleButeur: "3+ buts", doublePointeur: "2+ points",
  triplePointeur: "3+ points", outsiderButeur: "Out. buteur", outsiderPointeur: "Out. pointeur",
  outsiderDoubleButeur: "Out. 2+ buts", outsiderTripleButeur: "Out. 3+ buts",
  outsiderDoublePointeur: "Out. 2+ points", outsiderTriplePointeur: "Out. 3+ points",
  duo: "Duo (1 buteur)", trio: "Trio (1 buteur)", duo15: "Duo 2+ buts", trio15: "Trio 2+ buts" };
const TTL_AN = 31536000;

// la photo exacte de ce que le bot recommande pour un jour (top 1 de chaque marché)
function snapshotPicksDe(jeux) {
  const picks = [];
  jeux.forEach((g) => {
    MK_SIMPLE.forEach((mk) => {
      const rows = (g.players || []).filter((p) => p[mk] && p[mk].rank && p[mk].score > 0);
      if (!rows.length) return;
      rows.sort((a, b) => a[mk].rank - b[mk].rank);
      const p = rows[0];
      picks.push({ gid: g.id, mk, name: p.name, id: p.id, ab: p.abbr,
        prob: p[mk].prob || 0, conf: p[mk].confidence || 0, pal: p[mk].palier || 0,
        val: p[mk].valeur || "PROBABLE" });
    });
    Object.keys(OUTS_CHAMP).forEach((k) => {
      if (k === "outsider") return;
      const o = (g[OUTS_CHAMP[k]] || [])[0];
      if (!o) return;
      picks.push({ gid: g.id, mk: k, name: o.name, id: o.id, ab: o.abbr,
        prob: o.prob || 0, conf: o.confidence || 0, pal: o.palier || 0,
        val: o.valeur || "PROBABLE" });
    });
    [["duo", "double"], ["trio", "triple"], ["duo15", "duo15"], ["trio15", "trio15"]].forEach(([t, cle]) => {
      ["away", "home"].forEach((side) => {
        const cb = ((g.combos || {})[side] || {})[cle];
        if (!cb || !cb.members || !cb.members.length) return;
        picks.push({ gid: g.id, mk: t, name: cb.members.map((x) => x.name).join(" + "), id: 0,
          members: cb.members.map((x) => ({ id: x.id, name: x.name })),
          prob: cb.prob || 0, conf: cb.confidence || 0, pal: cb.palier || 0,
          val: cb.valeur || "PROBABLE" });
      });
    });
  });
  return picks;
}

async function enregistrePronos(date, d) {
  const cle = "prono:" + date;
  const vieux = await ENV.GARDIENS.get(cle, "json").catch(() => null);
  const jeux = await jourAdapte(date, d);
  if (!jeux.length) return;
  if (vieux && vieux.picks && vieux.picks.length) {
    const premier = jeux.map((g) => String(g.startUtc || "9999")).sort()[0];
    if (new Date(premier) <= new Date()) return;        // 1re mise au jeu → prono figée
  }
  const picks = snapshotPicksDe(jeux);
  if (picks.length)
    await ENV.GARDIENS.put(cle, JSON.stringify({ ts: Date.now(), date, picks }),
      { expirationTtl: TTL_AN }).catch(() => {});
}

const stJoueur = (stats, x) => stats[x.id] || stats[na(x.name || "")] || { g: 0, a: 0, p: 0 };
function hitPick(p, stats) {
  if (p.members && p.members.length) {
    const buts = p.members.reduce((som, m) => som + (stJoueur(stats, m).g || 0), 0);
    return (p.mk === "duo" || p.mk === "trio") ? buts >= 1 : buts >= 2;
  }
  const st = stJoueur(stats, p);
  switch (p.mk) {
    case "buteur": case "outsiderButeur": return st.g >= 1;
    case "passeur": return st.a >= 1;
    case "pointeur": case "outsiderPointeur": return st.p >= 1;
    case "doubleButeur": case "outsiderDoubleButeur": return st.g >= 2;
    case "tripleButeur": case "outsiderTripleButeur": return st.g >= 3;
    case "doublePointeur": case "outsiderDoublePointeur": return st.p >= 2;
    case "triplePointeur": case "outsiderTriplePointeur": return st.p >= 3;
    default: return false;
  }
}

/* Repli ESPN : l'API NHL (api-web) tombe parfois des jours entiers. ESPN ne
   connaît pas les playerId NHL → on appareille par nom normalisé. */
function statsDepuisESPN(js) {
  const stats = {};
  ((((js || {}).boxscore || {}).players) || []).forEach((t) =>
    (t.statistics || []).forEach((grp) => {
      const ks = grp.keys || [];
      const ig = ks.indexOf("goals"), ia = ks.indexOf("assists");
      if (ig < 0 || ia < 0) return;
      (grp.athletes || []).forEach((a) => {
        const g = parseInt((a.stats || [])[ig], 10) || 0;
        const as = parseInt((a.stats || [])[ia], 10) || 0;
        const ath = a.athlete || {};
        [ath.displayName, ath.shortName].forEach((nm) => {
          if (nm) stats[na(nm)] = { g, a: as, p: g + as };
        });
      });
    }));
  return stats;
}
async function boxESPN(date, abbrs) {
  const dem = new Date(new Date(date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  for (const d of [date, dem]) {                        // soirée US = date ET (+1 possible)
    try {
      const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates="
        + d.replace(/-/g, ""), { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) continue;
      const j = await r.json();
      const ev = (j.events || []).find((e) => {
        const c = (e.competitions || [])[0] || {};
        if (!(((c.status || {}).type || {}).completed)) return false;
        const eqs = (c.competitors || []).map((x) => ((x.team || {}).abbreviation) || "");
        return abbrs.some((a) => eqs.includes(a));
      });
      if (!ev) continue;
      const rs = await fetch("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=" + ev.id,
        { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!rs.ok) continue;
      const stats = statsDepuisESPN(await rs.json());
      if (Object.keys(stats).length) return stats;
    } catch (e) { /* on tente la date suivante */ }
  }
  return null;
}

async function verifieJour(date) {
  const snap = await ENV.GARDIENS.get("prono:" + date, "json").catch(() => null);
  if (!snap || !snap.picks || !snap.picks.length) return 0;
  if (await ENV.GARDIENS.get("result:" + date).catch(() => null)) return 0;
  const gids = [...new Set(snap.picks.map((p) => String(p.gid)))];
  const stats = {};
  for (const gid of gids) {
    let ok = false;
    try {
      const r = await fetch(NHL_API + "/gamecenter/" + gid + "/boxscore",
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" } });
      if (r.ok) {
        const b = await r.json();
        if (!b || b.gameState !== "OFF") return 0;      // pas fini → on retentera plus tard
        const pt = b.playerByGameStats || {};
        ["awayTeam", "homeTeam"].forEach((cote) => ["forwards", "defense"].forEach((ligne) => {
          (((pt[cote] || {})[ligne]) || []).forEach((j) => {
            stats[j.playerId] = { g: j.goals || 0, a: j.assists || 0, p: j.points || 0 };
          });
        }));
        ok = true;
      }
    } catch (e) { /* API NHL hors service → repli ESPN */ }
    if (!ok) {
      const abbrs = [...new Set(snap.picks.filter((x) => String(x.gid) === gid).map((x) => x.ab))];
      const es = await boxESPN(date, abbrs);
      if (!es) return 0;                                // ni NHL ni ESPN → plus tard
      Object.assign(stats, es);
    }
  }
  const picks = snap.picks.map((p) => Object.assign({}, p, { hit: hitPick(p, stats) }));
  const res = { ts: Date.now(), date, n: picks.length,
    h: picks.filter((x) => x.hit).length, picks };
  await ENV.GARDIENS.put("result:" + date, JSON.stringify(res),
    { expirationTtl: TTL_AN }).catch(() => {});
  await fusionneAgg(picks);
  return picks.length;
}

async function fusionneAgg(picks) {
  const agg = (await ENV.GARDIENS.get("bilan:agg", "json").catch(() => null))
    || { n: 0, h: 0, sp: 0, mk: {}, val: {}, pal: {} };
  const ajoute = (o, p) => {
    o.n = (o.n || 0) + 1; o.h = (o.h || 0) + (p.hit ? 1 : 0); o.sp = (o.sp || 0) + (p.prob || 0);
  };
  picks.forEach((p) => {
    ajoute(agg, p);
    [agg.mk, agg.val, agg.pal].forEach((zone, i) => {
      const cle = i === 0 ? p.mk : (i === 1 ? (p.val || "PROBABLE") : String(p.pal || 0));
      if (!zone[cle]) zone[cle] = { n: 0, h: 0, sp: 0 };
      ajoute(zone[cle], p);
    });
  });
  await ENV.GARDIENS.put("bilan:agg", JSON.stringify(agg),
    { expirationTtl: TTL_AN }).catch(() => {});
}

// appelé à chaque message (throttle 6 h) : photo des pronos du jour + vérification des 8 derniers jours
async function majBilan(d, force) {
  if (!force) {
    const scan = await ENV.GARDIENS.get("bilan:scan").catch(() => null);
    if (scan && Date.now() - Number(scan) < 6 * 3600000) return;
  }
  await ENV.GARDIENS.put("bilan:scan", String(Date.now())).catch(() => {});
  if (!d) d = await index();
  try { await enregistrePronos(jourDefaut(d), d); } catch (e) { /* tant pis */ }
  const auj = new Date();
  for (let i = 1; i <= 8; i++)
    try { await verifieJour(new Date(auj.getTime() - i * 86400000).toISOString().slice(0, 10)); } catch (e) { /* tant pis */ }
  try { await verifieJour(aujourdhui()); } catch (e) { /* tant pis */ }   // matchs précoces (fuseau)
  try { await verifieJour(jourDefaut(d)); } catch (e) { /* tant pis */ }  // la nuit parisienne : le jour analysé ≠ le jour civil
}

function ligneBilan(lab, o) {
  if (!o || !o.n) return null;
  const r = Math.round(100 * o.h / o.n), a = Math.round(100 * o.sp / o.n);
  let flag = "";
  if (o.n >= 15 && Math.abs(r - a) >= 10) flag = r < a ? " ⚠️ surévalué" : " 💎 sous-évalué";
  return lab + " : " + r + " % (annonce " + a + ") — " + o.n + " picks" + flag;
}
/* Marchés « fun » : très rares, jamais comptés dans le bilan principal. */
const FUN_MK = new Set(["tripleButeur", "outsiderTripleButeur", "outsiderTriplePointeur"]);
const decJour = (date, x) => new Date(new Date(date + "T12:00:00Z").getTime()
  + x * 86400000).toISOString().slice(0, 10);
function kbBilan(date) {
  return { inline_keyboard: [[
    btn("◀ " + dateFr(decJour(date, -1)), "H:" + decJour(date, -1)),
    btn("📅 7 jours", "H:sem"),
    btn(dateFr(decJour(date, 1)) + " ▶", "H:" + decJour(date, 1))]] };
}
const nHits = (rows) => rows.filter((x) => x.hit).length;
function ligneTaux(lab, rows) {
  if (!rows.length) return null;
  return lab + " — " + nHits(rows) + "/" + rows.length + " · "
    + Math.round(100 * nHits(rows) / rows.length) + " %";
}
async function bilanJour(date) {
  const res = await ENV.GARDIENS.get("result:" + date, "json").catch(() => null);
  if (!res) {
    const snap = await ENV.GARDIENS.get("prono:" + date, "json").catch(() => null);
    if (snap && snap.picks)
      return ["📊 <b>" + esc(dateFr(date)) + "</b> : " + snap.picks.length
        + " pronos enregistrées — matchs pas finis ou pas encore vérifiés.\nJe revérifie tout seul toutes les 30 min."];
    return ["📊 Rien pour le " + esc(dateFr(date))
      + " : pas de pronos enregistrées ce jour-là.\nNavigue avec les boutons ◀ ▶."];
  }
  const picks = res.picks || [];
  const fun = picks.filter((x) => FUN_MK.has(x.mk));
  const bets = picks.filter((x) => !FUN_MK.has(x.mk) && (x.val === "SUR" || x.val === "VALUE"));
  const autres = picks.filter((x) => !FUN_MK.has(x.mk) && x.val !== "SUR" && x.val !== "VALUE");
  const L = ["📊 <b>BILAN — " + esc(dateFr(date)) + "</b>", SEP];
  if (bets.length) {
    L.push("💰 <b>MES BETS (✅🔥)</b> — " + nHits(bets) + "/" + bets.length + " · "
      + Math.round(100 * nHits(bets) / bets.length) + " %");
    [ligneTaux("  ✅ SÛR", bets.filter((x) => x.val === "SUR")),
     ligneTaux("  🔥 VALUE", bets.filter((x) => x.val === "VALUE"))].forEach((x) => x && L.push(x));
    L.push("", "🎯 <b>PAR PROBABILITÉ</b>");
    [[0.7, 1.01, "  ≥ 70 %"], [0.5, 0.7, "  50–69 %"], [0.3, 0.5, "  30–49 %"], [0, 0.3, "  < 30 %"]]
      .forEach(([lo, hi, lab]) => {
        const x = ligneTaux(lab, bets.filter((q) => q.prob >= lo && q.prob < hi));
        if (x) L.push(x);
      });
    L.push("", "📈 <b>PAR MARCHÉ</b>");
    const par = {};
    bets.forEach((x) => { (par[x.mk] = par[x.mk] || []).push(x); });
    L.push("  " + Object.keys(par)
      .map((mk) => (MK_BILAN[mk] || mk) + " " + nHits(par[mk]) + "/" + par[mk].length).join(" · "));
    L.push("", SEP, "<b>DÉTAIL — MES BETS</b>");
    bets.forEach((x) => L.push(" " + (x.hit ? "✅" : "❌") + " " + esc(x.name) + " — "
      + esc(MK_BILAN[x.mk] || x.mk) + " · " + pct(x.prob) + (x.val === "SUR" ? " ✅" : " 🔥")));
  } else {
    L.push("💰 <b>MES BETS (✅🔥)</b> — aucun pick sûr/value ce jour-là.");
  }
  if (fun.length) {
    L.push("", "🎪 <b>FUN</b> <i>(hors bilan)</i> — " + nHits(fun) + "/" + fun.length);
    fun.forEach((x) => L.push(" " + (x.hit ? "✅" : "❌") + " " + esc(x.name) + " — "
      + esc(MK_BILAN[x.mk] || x.mk) + " · " + pct(x.prob)));
  }
  if (autres.length)
    L.push("", "📦 <b>TESTÉS</b> — " + nHits(autres) + "/" + autres.length
      + " picks d'exploration (calibrage du modèle, pas des conseils de mise).");
  return [L.join("\n")];
}
async function bilanSemaine() {
  const lignes = [];
  let n = 0, hh = 0, bn = 0, bh = 0;
  for (let i = 1; i <= 7; i++) {
    const dt = decJour(aujourdhui(), -i);
    const res = await ENV.GARDIENS.get("result:" + dt, "json").catch(() => null);
    if (!res) continue;
    const bets = (res.picks || []).filter((x) => !FUN_MK.has(x.mk)
      && (x.val === "SUR" || x.val === "VALUE"));
    n += res.n; hh += res.h; bn += bets.length; bh += nHits(bets);
    lignes.push("• " + dateFr(dt) + " — 💰 " + (bets.length
      ? nHits(bets) + "/" + bets.length : "—") + " · tout " + res.h + "/" + res.n);
  }
  if (!n) return ["📊 <b>7 derniers jours</b> : rien de vérifié pour l'instant."];
  return [["📊 <b>7 DERNIERS JOURS</b>", SEP,
    "💰 <b>MES BETS</b> — " + bh + "/" + bn + (bn ? " · " + Math.round(100 * bh / bn) + " %" : ""),
    "📦 Tout — " + hh + "/" + n, SEP, ...lignes].join("\n")];
}
async function fluxBilan(d, opt) {
  try { await majBilan(d, true); } catch (e) { /* tant pis */ }
  const arg = na(String(opt || "")).trim();
  const nav = async (dateC) => { const r = await bilanJour(dateC); CLAVIER_REP = kbBilan(dateC); return r; };
  if (arg) {
    const iso = String(opt).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return nav(iso[0]);
    if (/^(hier|veille|yesterday)$/.test(arg)) return nav(decJour(jourDefaut(d), -1));
    if (/^(semaine|7 jours|7jours|week)$/.test(arg)) return bilanSemaine();
    return ["Écris « bilan hier », « bilan semaine » ou « bilan 2026-10-05 »."];
  }
  return nav(decJour(aujourdhui(), -1));   // la veille par défaut, navigation ◀ ▶
}

// ---- 📰 actus NHL en direct (ESPN, sans clé) — cache KV 15 min ----
async function fluxNews() {
  let cache = null;
  if (ENV.GARDIENS) cache = await ENV.GARDIENS.get("espn:news", "json").catch(() => null);
  if (!cache || Date.now() - (cache.ts || 0) > 15 * 60000) {
    try {
      const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news",
        { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36" } });
      const arts = ((await r.json()).articles || []).slice(0, 8);
      cache = { ts: Date.now(), arts: arts.map((a) => ({
        h: String(a.headline || "").slice(0, 160),
        d: String(a.published || "").slice(5, 16).replace("T", " ") })) };
      if (ENV.GARDIENS && cache.arts.length)
        await ENV.GARDIENS.put("espn:news", JSON.stringify(cache), { expirationTtl: 86400 }).catch(() => {});
    } catch (e) { /* tant pis : on garde l'ancien cache */ }
  }
  if (!cache || !cache.arts || !cache.arts.length)
    return ["📰 Actus indisponibles pour le moment."];
  return [["📰 <b>ACTUS NHL</b> (ESPN)",
    ...cache.arts.map((a) => "• " + esc(a.h) + (a.d ? "  <i>(" + esc(a.d) + ")</i>" : ""))].join("\n")];
}

export default {
  async fetch(request, env, ctx) {
    ENV = env || {};
    if (request.method === "GET") {
      const u = new URL(request.url);
      if (u.pathname === "/verifs" && ENV.GARDIENS) {
        // le pipeline CI passe ici toutes les 2 h : on en profite pour vérifier
        // les résultats en arrière-plan (le cron CF peut sauter, pas la CI).
        if (ctx && ctx.waitUntil) { try { ctx.waitUntil(majBilan(null, true)); } catch (e) { /* tant pis */ } }
        const picks = [];
        let cursor;
        do {
          const l = await ENV.GARDIENS.list({ prefix: "result:", limit: 1000, cursor });
          for (const key of l.keys) {
            const v = await ENV.GARDIENS.get(key.name, "json").catch(() => null);
            for (const p of ((v && v.picks) || [])) picks.push(Object.assign({ jour: key.name.slice(7) }, p));
          }
          cursor = l.list_complete ? undefined : l.cursor;
        } while (cursor);
        return j(200, { picks });
      }
      return j(200, { ok: true, bot: !!TOKEN(), donnees: DATA });
    }
    if (request.method !== "POST") return j(405, { ok: false });
    if (!TOKEN()) return j(200, { ok: false, erreur: "TELEGRAM_BOT_TOKEN non configuré" });
    const sec = request.headers.get("x-telegram-bot-api-secret-token");
    if (SECRET() && sec !== SECRET()) return j(401, { ok: false });
    let up;
    try { up = JSON.parse((await request.text()) || "{}"); } catch (e) { return j(200, { ok: false }); }
    if (ctx && ctx.waitUntil) ctx.waitUntil(majSiPerime(ENV)); // rafraîchit le site en arrière-plan

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
        const res = await traiteCallback(cbq.data, d, cbq.message.chat.id);
        if (res.alert) {
          try { await tg("answerCallbackQuery", { callback_query_id: cbq.id, text: res.alert, show_alert: true }); } catch (e) { /* tant pis */ }
        }
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
      const morceaux = await traite(msg.text, msg.chat.id);
      const clav = CLAVIER_REP; CLAVIER_REP = null;
      await envoie(msg.chat.id, morceaux, clav || undefined);
      return j(200, { ok: true, reponses: morceaux.length });
    } catch (e) {
      try { await envoie(msg.chat.id, ["❌ Erreur : " + esc(String((e && e.message) || e))]); } catch (e2) { /* tant pis */ }
      return j(200, { ok: false, erreur: String((e && e.message) || e) });
    }
  },

  // Cron Cloudflare (fiable, lui) : régénère le site toutes les 30 min — le cron
  // de GitHub saute des passages aux heures de pointe, les confirmations de
  // gardiens arrivaient donc en retard sur le site.
  async scheduled(event, env) {
    ENV = env || {};
    try { await majBilan(null, true); } catch (e) { /* tant pis */ }
    if (!ENV.GITHUB_PAT) return;
    try {
      await fetch("https://api.github.com/repos/akrooo2002-prog/NHL-PRO-/actions/workflows/refresh.yml/dispatches", {
        method: "POST",
        headers: { "Authorization": "Bearer " + ENV.GITHUB_PAT,
                   "Accept": "application/vnd.github+json", "User-Agent": "nhl-bot-cron" },
        body: JSON.stringify({ ref: "main", inputs: { deploy_netlify: false } }),
      });
    } catch (e) { /* tant pis : le cron GitHub reste en secours */ }
  },
};

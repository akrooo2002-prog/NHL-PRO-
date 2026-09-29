// Bot Telegram : lit les mêmes données que le site (data/index.json) et répond
// à la demande, avec tous les filtres du site + outsider. 100 % gratuit :
// Telegram envoie chaque message ici (webhook), la fonction répond via l'API
// Telegram. Aucun serveur à laisser allumé.
//
// Configuration (variables d'environnement Netlify) :
//   TELEGRAM_BOT_TOKEN        — obligatoire, fourni par @BotFather
//   TELEGRAM_WEBHOOK_SECRET   — recommandé, secret du webhook (anti-abus)
//   TELEGRAM_OWNER_ID         — optionnel : si défini, seul ce chat est servi
const DATA = process.env.DATA_URL || "https://nhl-pronos-pro.netlify.app";
// En prod, GitHub Actions remplace les __TG_*__ par les secrets du dépôt au
// build (même principe que __GH_PAT__ dans refresh.js) ; en local/test, ce
// sont les variables d'environnement qui priment.
const cfg = (v) => (v && v.indexOf("__TG") !== 0 ? v : "");
const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN || cfg("__TG_TOKEN__");
const SECRET = () => process.env.TELEGRAM_WEBHOOK_SECRET || cfg("__TG_SECRET__");
const OWNER = () => process.env.TELEGRAM_OWNER_ID || cfg("__TG_OWNER__");

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" };
const j = (code, obj) => ({ statusCode: code, headers: CORS, body: JSON.stringify(obj) });
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
  ["outsider", "Outsiders justifiés", ["outsider", "outsiders"]],
];
const MK_SIMPLE = ["buteur", "passeur", "pointeur", "doubleButeur", "tripleButeur", "doublePointeur", "triplePointeur"];

const AIDE =
  "🏒 <b>Bot NHL Pronos</b> — mêmes données que le site, sans cote.\n" +
  "Écris-moi en langage naturel, je réponds avec les tops demandés.\n\n" +
  "<b>Filtres</b> : buteur, passeur, pointeur, 2buts, 3buts, 2points, 3points, " +
  "double chance, triple chance, <b>outsider</b>\n" +
  "<b>Matchs</b> : une équipe (ex. FLA, CAR), « match 3 », ou « tout »\n" +
  "<b>Jour</b> : « aujourd'hui », « demain », ou une date (2026-10-01)\n" +
  "<b>Commandes</b> : /matchs (liste du jour), /podium (top 3 du jour), /dates\n\n" +
  "Exemples :\n" +
  "• <code>buteur pointeur FLA</code>\n" +
  "• <code>double chance outsider tout</code>\n" +
  "• <code>2buts 3points CAR demain</code>";

/* ---------- chargement des données (index du site) ---------- */
let _cache = null;
async function index() {
  if (_cache) return _cache;
  const r = await fetch(DATA + "/data/index.json");
  if (!r.ok) throw new Error("index.json HTTP " + r.status);
  _cache = await r.json();
  return _cache;
}
// Les joueurs classés ne sont QUE dans les fichiers jour — l'index ne porte que
// les matchs (combos, outsiders, horaires). On charge le jour demandé à la volée.
const _jours = {};
async function jour(date) {
  if (_jours[date]) return _jours[date];
  const r = await fetch(DATA + "/data/jour-" + date + ".json");
  if (!r.ok) throw new Error("jour-" + date + ".json HTTP " + r.status);
  _jours[date] = await r.json();
  return _jours[date];
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
  for (const [k, , alias] of MARCHES) {
    for (const a of alias) {
      const re = new RegExp("(^|[^a-z])" + a.replace(/[+]/g, "\\+") + "([^a-z]|$)");
      if (re.test(reste)) { reste = reste.replace(re, " "); if (!q.marches.includes(k)) q.marches.push(k); break; }
    }
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
  const q = parseRequete(text, d);
  const ds = dates(d);
  if (q.aide) return [AIDE];
  if (q.date === "*") return ["🗓 <b>Jours analysés</b>\n" + ds.join("\n") + "\n(mise à jour : " + esc(d.generatedUtc) + ")"];
  const date = q.date || jourDefaut(d);
  if (!ds.includes(date)) return ["Pas d'analyse pour le " + esc(date) + ". Prochains jours : " + ds.slice(0, 8).join(", ")];
  const jeuxJour = await jourComplet(date); // index + joueurs classés fusionnés
  const jeux = selection(jeuxJour, q);
  if (q.liste && !q.marches.length) return [blocListe(date, jeuxJour)];
  if (q.podium) return [blocPodium(date, jeuxJour)];
  if (!jeux.length) return ["Aucun match ne correspond le " + esc(date) + ". /matchs pour la liste."];
  let marches = q.marches.filter((m) => m !== "*");
  if (!marches.length) marches = ["buteur", "pointeur"]; // défaut = celui du site
  // ordre stable : marchés simples, chances combinées, outsider en dernier
  const ordre = [...MK_SIMPLE, "doubleChance", "tripleChance", "outsider"];
  marches.sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b));
  const entete = "📅 <b>" + esc(date) + "</b> · " + jeux.length + " match" + (jeux.length > 1 ? "s" : "")
    + (q.tout || (!q.equipes.length && !q.nums.length) ? " (tous)" : " · " + esc(q.equipes.join(", ") || q.nums.map((n) => "match " + n).join(", ")));
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

/* ---------- envoi Telegram ---------- */
async function envoie(chatId, morceaux) {
  for (let texte of morceaux) {
    if (texte.length > 4090) { // filet de sécurité : découpe dure par lignes
      const bouts = [];
      let b = "";
      texte.split("\n").forEach((l) => {
        if ((b + "\n" + l).length > 4000 && b) { bouts.push(b); b = l; } else b += (b ? "\n" : "") + l;
      });
      if (b) bouts.push(b);
      for (const x of bouts) await envoie(chatId, [x]);
      continue;
    }
    const r = await fetch("https://api.telegram.org/bot" + TOKEN() + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texte, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const e = await r.text();
      throw new Error("sendMessage HTTP " + r.status + " : " + e.slice(0, 200));
    }
  }
}

/* ---------- handler Netlify ---------- */
async function handler(event) {
  if (event.httpMethod === "GET") return j(200, { ok: true, bot: !!TOKEN(), donnees: DATA });
  if (event.httpMethod !== "POST") return j(405, { ok: false });
  if (!TOKEN()) return j(200, { ok: false, erreur: "TELEGRAM_BOT_TOKEN non configuré" });
  const sec = (event.headers || {})["x-telegram-bot-api-secret-token"];
  if (SECRET() && sec !== SECRET()) return j(401, { ok: false });
  let up;
  try { up = JSON.parse(event.body || "{}"); } catch (e) { return j(200, { ok: false }); }
  const msg = up.message || up.edited_message;
  if (!msg || !msg.text) return j(200, { ok: true });           // stickers, photos, canaux…
  const owner = OWNER();
  if (owner && String(msg.chat.id) !== String(owner)) return j(200, { ok: true }); // accès restreint
  try {
    const morceaux = await traite(msg.text);
    await envoie(msg.chat.id, morceaux);
    return j(200, { ok: true, reponses: morceaux.length });
  } catch (e) {
    try { await envoie(msg.chat.id, ["❌ Erreur : " + esc(String((e && e.message) || e))]); } catch (e2) { /* tant pis */ }
    return j(200, { ok: false, erreur: String((e && e.message) || e) });
  }
}

exports.handler = handler;
exports._test = { traite, parseRequete, blocMatch, blocPodium, blocListe, AIDE };

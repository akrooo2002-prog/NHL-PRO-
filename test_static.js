/**
 * Test de la version STATIQUE (dossier à déposer sur Netlify Drop).
 *
 * Rien à voir avec test_app.js : ici on vérifie que l'app tient debout SANS
 * serveur Python, servie par un simple serveur de fichiers statiques.
 *
 *   1. build_static.py produit un dossier complet et cohérent
 *   2. un serveur statique sert tout ce dont l'app a besoin
 *   3. l'app démarre en mode statique et le dit à l'utilisateur
 *   4. les podiums calculés depuis l'INDEX sont identiques à ceux calculés
 *      depuis les données complètes (sinon la version allégée ment)
 *   5. l'onglet Analyse charge la fiche complète d'un match
 *   6. l'onglet Live explique pourquoi il est absent, au lieu de planter
 *   7. PWA : manifeste valide, service worker syntaxiquement correct
 *
 * Usage:  node test_static.js [dossier]      (défaut : dist)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const cp = require("child_process");

const ROOT = __dirname;
const DIST = path.resolve(process.argv[2] || path.join(ROOT, "dist"));
const PORT = 8124;
const BASE = `http://127.0.0.1:${PORT}`;
const fails = [];
const ok = (c, l, e = "") => {
  console.log((c ? "  OK    " : "  ECHEC ") + l + (e ? "  " + e : ""));
  if (!c) fails.push(l);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

function get(u, opts) {
  return new Promise(res => {
    const req = http.request(BASE + u, Object.assign({ method: "GET" }, opts || {}), r => {
      const chunks = [];
      r.on("data", d => chunks.push(d));
      r.on("end", () => {
        const b = Buffer.concat(chunks);
        res({ status: r.statusCode, headers: r.headers, n: b.length, text: b.toString("utf-8"),
              json() { try { return JSON.parse(this.text); } catch (e) { return null; } } });
      });
    });
    req.on("error", e => res({ status: 0, error: String(e.message || e) }));
    req.end();
  });
}

/* ---------------------------- DOM simulé ---------------------------- */
class FakeEl {
  constructor(t) {
    this.tagName = (t || "div").toUpperCase();
    this.children = []; this.className = ""; this.textContent = ""; this.value = "";
    this.style = { set cssText(v) {}, get cssText() { return ""; } };
    const s = this;
    this.classList = { add(c) { s.className += " " + c; }, remove(c) { s.className = s.className.replace(c, ""); },
                       contains(c) { return s.className.includes(c); } };
  }
  set innerHTML(v) {
    const tags = String(v).match(/<(table|thead|tbody|tr|td|th)\b/gi) || [];
    tags.forEach(t => (this._parsed = this._parsed || []).push(new FakeEl(t.slice(1).toLowerCase())));
    this._ih = (this._ih || "") + String(v);
  }
  get innerHTML() { return (this._ih || "") + this.children.map(c => c.innerHTML).join(""); }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; return o; }
  insertBefore(c, r) { const i = this.children.indexOf(r); i < 0 ? this.children.push(c) : this.children.splice(i, 0, c); return c; }
  querySelector() { return new FakeEl(); } querySelectorAll() { return []; }
  setAttribute() {} click() {}
  text() { let t = this.innerHTML + this.textContent; this.children.forEach(c => t += c.text()); return t; }
  count(tag) { let n = this.tagName === tag ? 1 : 0;
    (this._parsed || []).forEach(c => { if (c.tagName === tag) n++; });
    this.children.forEach(c => n += c.count(tag)); return n; }
}

(async () => {
  // ---------- 1. le dossier ----------
  console.log("\n--- 1. dossier " + path.relative(ROOT, DIST) + " ---");
  if (!fs.existsSync(DIST)) {
    console.log("  ECHEC dossier absent — lance : python3 build_static.py");
    process.exit(1);
  }
  for (const f of ["index.html", "app.html", "manifest.webmanifest", "sw.js", "_headers",
                   "data/index.json", "icons/icon-192.png", "icons/icon-512.png"]) {
    const p = path.join(DIST, f);
    ok(fs.existsSync(p) && fs.statSync(p).size > 0, "fichier " + f,
       fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) + " Ko" : "absent");
  }
  const fiches = fs.readdirSync(path.join(DIST, "data")).filter(f => /^match-\d+\.json$/.test(f));
  const jours = fs.readdirSync(path.join(DIST, "data")).filter(f => /^jour-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  const idx = JSON.parse(fs.readFileSync(path.join(DIST, "data", "index.json"), "utf-8"));
  ok(fiches.length === idx.games.length, "une fiche par match",
     fiches.length + " fiches / " + idx.games.length + " matchs");
  ok(jours.length === new Set(idx.games.map(g => g.date)).size, "un fichier par jour",
     jours.length + " jours");
  ok(idx.games.every(g => !g.players), "l'index ne transporte pas les joueurs",
     "démarrage = " + Math.round(fs.statSync(path.join(DIST, "data", "index.json")).size / 1024) + " Ko");
  const complet = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "analyse.json"), "utf-8"));
  if (idx.generatedUtc !== complet.generatedUtc) {
    console.log("  INFO  dist/ a été construit avant la dernière collecte : "
      + idx.generatedUtc + " contre " + complet.generatedUtc
      + "\n        → relance python3 build_static.py avant de déposer le dossier. "
      + "La comparaison ci-dessous porte donc sur deux générations différentes.");
  }
  const poidsIdx = fs.statSync(path.join(DIST, "data", "index.json")).size;
  const poidsTot = fs.statSync(path.join(ROOT, "data", "analyse.json")).size;
  ok(poidsIdx < poidsTot / 3, "index nettement plus léger que le fichier complet",
     Math.round(poidsIdx / 1024) + " Ko contre " + Math.round(poidsTot / 1024) + " Ko");
  ok(idx.statique === true, "l'index se déclare statique");

  // ---------- 2. serveur statique ----------
  console.log("\n--- 2. servi par un serveur de fichiers statiques ---");
  const srv = cp.spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1",
                                   "--directory", DIST], { stdio: "ignore" });
  await wait(1500);
  for (const u of ["/", "/app.html", "/manifest.webmanifest", "/sw.js", "/data/index.json",
                   "/data/jour-" + idx.games[0].date + ".json",
                   "/icons/icon-192.png", "/data/match-" + idx.games[0].id + ".json"]) {
    const r = await get(u);
    ok(r.status === 200 && r.n > 0, "GET " + u, r.status + " " + r.n + " o");
  }
  const absent = await get("/api/health");
  ok(absent.status === 404, "aucun /api sur un hébergement statique", absent.status + " (c'est attendu)");
  const manq = await get("/data/match-1.json");
  ok(manq.status === 404, "fiche inconnue -> 404", manq.status);

  // ---------- 3. l'app en mode statique ----------
  console.log("\n--- 3. application ---");
  const html = fs.readFileSync(path.join(DIST, "app.html"), "utf-8");
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const reg = {}, store = {};
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    document: { body: new FakeEl("body"), createElement: t => new FakeEl(t),
                querySelector(s) { return reg[s] = reg[s] || new FakeEl(); } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    location: { protocol: "https:", hostname: "nhl-pronos.netlify.app" },
    fetch(u, o) {
      const url = u.startsWith("http") ? u : BASE + "/" + u.replace(/^\//, "");
      return new Promise((res, rej) => {
        const rq = http.request(url, { method: (o && o.method) || "GET" }, r => {
          let b = ""; r.on("data", d => b += d);
          r.on("end", () => {
            if (r.status >= 400) return rej(new Error("HTTP " + r.status + " sur " + u));
            res({ status: r.status, json: () => Promise.resolve(JSON.parse(b)) });
          });
        });
        rq.on("error", rej);
        rq.end();
      });
    },
    URL, Blob: class {}, AbortController, setTimeout, clearTimeout, Math, Number, String,
    Object, Array, JSON, Date, Promise, isNaN,
  };
  sb.window = sb; sb.globalThis = sb; sb.scrollTo = () => {};
  vm.createContext(sb);
  vm.runInContext(js + "\nglobalThis.__x={S:S,effG:effG,podiumJour:podiumJour,rPodium:rPodium,"
    + "rMatchs:rMatchs,rDetail:rDetail,rLive:rLive,rMethode:rMethode,jeuComplet:jeuComplet,"
    + "dates:dates,palier:palier,jourDe:jourDe};", sb, { filename: "app-statique.js" });
  await wait(4000);
  const X = sb.__x, S = X.S;
  ok(!!S.d && S.d.games.length === idx.games.length, "index chargé",
     S.d ? S.d.games.length + " matchs" : "rien");
  ok(S.statique === true, "mode statique détecté");
  const ecran = reg["#main"] ? reg["#main"].innerHTML : "";
  ok(/Version statique/.test(ecran) || /statique/i.test(sb.document.querySelector("#main").innerHTML),
     "l'app prévient que les données sont figées");

  let m = new FakeEl("div"), err = null;
  try { await X.rPodium(m); } catch (e) { err = e.stack.split("\n")[0]; }
  ok(!err && m.text().length > 5000, "onglet Podium", err || m.text().length + " car.");
  m = new FakeEl("div"); err = null;
  try { await X.rMatchs(m); } catch (e) { err = e.stack.split("\n")[0]; }
  ok(!err && m.text().length > 5000, "onglet Matchs", err || m.text().length + " car.");
  m = new FakeEl("div"); err = null;
  try { await X.rLive(m); } catch (e) { err = e.message; }
  ok(!err && /statique|CORS|server\.py/i.test(m.text()),
     "onglet Live explique son absence", err || m.text().slice(0, 70));
  m = new FakeEl("div"); err = null;
  try { X.rMethode(m); } catch (e) { err = e.message; }
  ok(!err && m.count("TR") >= 6, "onglet Méthode", err || m.count("TR") + " lignes");

  // ---------- 4. fidélité index / données complètes ----------
  console.log("\n--- 4. podiums : index == données complètes ---");
  const MKS = ["buteur", "passeur", "pointeur"];
  const parId = {};
  complet.games.forEach(g => { parId[g.id] = g; });
  let diverg = 0, compares = 0, exemple = "";
  for (const jour of X.dates().slice(0, 6)) {
    const jj = JSON.parse(fs.readFileSync(path.join(DIST, "data", "jour-" + jour + ".json"), "utf-8"));
    const parJ = {}; jj.games.forEach(g => { parJ[g.id] = g; });
    const jeuxIdx = S.d.games.filter(g => g.date === jour)
      .map(g => Object.assign({}, g, parJ[g.id] ? { players: parJ[g.id].players } : {}));
    const jeuxFull = jeuxIdx.map(g => parId[g.id]).filter(Boolean);
    if (!jeuxFull.length) continue;
    const pIdx = X.podiumJour(jeuxIdx), pFull = X.podiumJour(jeuxFull);
    for (const mk of MKS) {
      compares++;
      const a = (pIdx[mk] || []).map(r => r.p.id + ":" + r.p[mk].confidence + ":" + r.p[mk].rank);
      const b = (pFull[mk] || []).map(r => r.p.id + ":" + r.p[mk].confidence + ":" + r.p[mk].rank);
      if (a.join("|") !== b.join("|")) {
        diverg++;
        if (!exemple) exemple = `${jour} ${mk}\n         index : ${a.join(" / ")}\n      complet : ${b.join(" / ")}`;
      }
    }
  }
  const memeGeneration = idx.generatedUtc === complet.generatedUtc;
  const testPodium = () => ok(diverg === 0,
    "podiums identiques entre l'index allégé et les données complètes",
    compares + " comparaisons, " + diverg + " divergence(s)" + (exemple ? "\n         " + exemple : ""));
  if (memeGeneration) testPodium();
  else {
    console.log("  INFO  comparaison ignorée : dist/ et data/ ne datent pas de la même collecte");
    console.log("        (relance python3 build_static.py pour la refaire à l'identique)");
  }

  // ---------- 5. fiche complète à la demande ----------
  console.log("\n--- 5. onglet Analyse ---");
  m = new FakeEl("div");
  S.game = S.d.games[0].id;
  await X.jourDe(S.d.games[0].date).catch(() => {});
  try { await X.rDetail(m); } catch (e) { err = e.message; }
  await wait(3000);
  const fiche = S.complets[S.game];
  ok(!!fiche, "fiche complète chargée à la demande",
     fiche ? fiche.players.length + " joueurs" : "rien");
  const indexJoueurs = S.d.games.find(g => g.id === S.game).players.length;
  ok(fiche && fiche.players.length >= indexJoueurs,
     "la fiche contient au moins autant de joueurs que l'index",
     (fiche ? fiche.players.length : 0) + " contre " + indexJoueurs);
  m = new FakeEl("div"); err = null;
  try { await X.rDetail(m); } catch (e) { err = e.message; }
  ok(!err && m.count("TR") >= fiche.players.length, "tableau complet rendu",
     err || m.count("TR") + " lignes pour " + fiche.players.length + " joueurs");
  // l'index allège les justifications hors top 3 : la fiche doit les rendre en entier
  const idxJ = S.d.games.find(g => g.id === S.game).players;
  const parId2 = {}; fiche.players.forEach(p => { parId2[p.id] = p; });
  let raccourcies = 0, comparées = 0, gain = 0;
  idxJ.forEach(p => {
    const q = parId2[p.id]; if (!q) return;
    for (const mk of ["buteur", "passeur", "pointeur"]) {
      comparées++;
      if (p[mk].why.length < q[mk].why.length) { raccourcies++; gain = Math.max(gain, q[mk].why.length - p[mk].why.length); }
      if (p[mk].why.length > q[mk].why.length) fails.push("justification plus longue dans l'index");
    }
  });
  ok(raccourcies > 0, "la fiche rend les justifications complètes, l'index les allège",
     raccourcies + "/" + comparées + " plus détaillées dans la fiche, gain max " + gain + " car.");

  // ---------- 6. PWA ----------
  console.log("\n--- 6. installable comme app web ---");
  const man = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf-8"));
  ok(man.name && man.start_url === "/" && man.display === "standalone"
     && man.theme_color && Array.isArray(man.icons) && man.icons.length >= 2,
     "manifeste web valide", man.short_name + ", " + man.icons.length + " icônes, display " + man.display);
  ok(man.icons.every(i => fs.existsSync(path.join(DIST, i.src.replace(/^\//, "")))),
     "toutes les icônes du manifeste existent");
  ok(/apple-mobile-web-app-capable/.test(html) && /apple-touch-icon/.test(html),
     "balises iOS présentes (Safari : ajouter à l'écran d'accueil)");
  const chk = cp.spawnSync("node", ["--check", path.join(DIST, "sw.js")]);
  ok(chk.status === 0, "service worker syntaxiquement valide", chk.status === 0 ? "" : chk.stderr.toString().split("\n")[0]);
  ok(/caches\.open/.test(fs.readFileSync(path.join(DIST, "sw.js"), "utf-8")),
     "le service worker met bien en cache");
  ok(fs.existsSync(path.join(DIST, "_headers")), "_headers présent (Netlify applique les en-têtes)");

  srv.kill();
  console.log("\nRESULTAT VERSION STATIQUE : " + (fails.length ? fails.length + " ECHEC(S) : " + fails.join(" | ")
    : "TOUT EST OK — le dossier peut être déposé sur Netlify Drop"));
  process.exit(fails.length ? 1 : 0);
})();

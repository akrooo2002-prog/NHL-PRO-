/**
 * Test du montage 100 % GRATUIT : site statique + proxy Cloudflare Worker +
 * GitHub Actions. Vérifie que le site retrouve le Live et le bouton Rafraîchir
 * alors qu'il n'y a AUCUN serveur Python derrière.
 *
 *   1. les pièces du montage existent et sont syntaxiquement valides
 *   2. le proxy (imité ici par test_proxy_stub.py, qui appelle la VRAIE API NHL)
 *      répond avec les en-têtes CORS que le navigateur exige
 *   3. l'app statique lit config.json, retrouve le Live et le bouton Rafraîchir
 *   4. le flux de rafraîchissement renvoie bien l'état attendu
 *   5. sans config.json, ou avec un proxy en panne, l'app explique au lieu
 *      de mentir : bouton « Recharger », message d'erreur explicite
 *
 * Usage:  node test_gratuit.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const cp = require("child_process");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist-free");
const PORT_SITE = 8126;
const PORT_PROXY = 8787;
const fails = [];
const ok = (c, l, e = "") => {
  console.log((c ? "  OK    " : "  ECHEC ") + l + (e ? "  " + e : ""));
  if (!c) fails.push(l);
};
const wait = ms => new Promise(r => setTimeout(r, ms));

function get(url, opts) {
  return new Promise(res => {
    const req = http.request(url, Object.assign({ method: "GET" }, opts || {}), r => {
      const ch = [];
      r.on("data", d => ch.push(d));
      r.on("end", () => {
        const b = Buffer.concat(ch);
        res({ status: r.statusCode, headers: r.headers, n: b.length, text: b.toString("utf-8"),
              json() { try { return JSON.parse(this.text); } catch (e) { return null; } } });
      });
    });
    req.on("error", e => res({ status: 0, error: String(e.message || e) }));
    req.end();
  });
}

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
}

(async () => {
  // ---------- 1. les pièces du montage ----------
  console.log("\n--- 1. pièces du montage gratuit ---");
  for (const f of ["worker/worker.js", "worker/wrangler.toml", ".github/workflows/refresh.yml",
                   "build_static.py", "test_proxy_stub.py"]) {
    ok(fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size > 100,
       "fichier " + f);
  }
  const wchk = cp.spawnSync("node", ["--check", path.join(ROOT, "worker", "worker.js")]);
  ok(wchk.status === 0, "worker/worker.js syntaxiquement valide",
     wchk.status === 0 ? "" : wchk.stderr.toString().split("\n")[0]);
  let yamlOk = true, yamlErr = "";
  try {
    const py = cp.spawnSync("python3", ["-c",
      "import yaml,sys;yaml.safe_load(open('.github/workflows/refresh.yml',encoding='utf-8'));print('ok')"],
      { cwd: ROOT, encoding: "utf-8" });
    yamlOk = py.status === 0; yamlErr = (py.stderr || py.stdout || "").split("\n")[0];
  } catch (e) { yamlOk = false; yamlErr = String(e); }
  ok(yamlOk, "workflow GitHub Actions : YAML valide", yamlErr);
  for (const s of ["fetch_pronos.py", "engine.py", "build_static.py", "test_proxy_stub.py"]) {
    const c = cp.spawnSync("python3", ["-m", "py_compile", path.join(ROOT, s)]);
    ok(c.status === 0, s + " compile");
  }

  // ---------- 2. construction du dossier + config.json ----------
  console.log("\n--- 2. dossier statique avec proxy ---");
  fs.rmSync(DIST, { recursive: true, force: true });
  const build = cp.spawnSync("python3", ["build_static.py", DIST], { cwd: ROOT, encoding: "utf-8" });
  ok(build.status === 0, "build_static.py construit le dossier", (build.stdout || build.stderr).split("\n")[0]);
  fs.writeFileSync(path.join(DIST, "config.json"),
                   JSON.stringify({ api: `http://127.0.0.1:${PORT_PROXY}/` }) + "\n");
  ok(fs.existsSync(path.join(DIST, "config.json")), "config.json pointe vers le proxy",
     fs.readFileSync(path.join(DIST, "config.json"), "utf-8").trim());

  // ---------- 3. proxy : le vrai test CORS ----------
  console.log("\n--- 3. proxy (stub local qui appelle la VRAIE API NHL) ---");
  const site = cp.spawn("python3", ["-m", "http.server", String(PORT_SITE), "--bind", "127.0.0.1",
                                    "--directory", DIST], { stdio: "ignore" });
  const proxy = cp.spawn("python3", [path.join(ROOT, "test_proxy_stub.py"), String(PORT_PROXY)],
                         { stdio: "ignore" });
  await wait(1800);
  /* si un serveur étranger occupe déjà le port, on testerait autre chose que notre
     dossier : on le vérifie explicitement */
  const sonde = await get(`http://127.0.0.1:${PORT_SITE}/manifest.webmanifest`);
  ok(sonde.status === 200 && sonde.json() && sonde.json().name,
     "le serveur de fichiers sert bien notre dossier", sonde.status + "");
  for (const [nom, pr] of [["site", site], ["proxy", proxy]]) {
    ok(!pr.killed && pr.exitCode === null, "le processus " + nom + " est vivant",
       pr.exitCode === null ? "" : "code " + pr.exitCode);
  }
  const P = `http://127.0.0.1:${PORT_PROXY}`;
  const pre = await get(P + "/live?date=2026-09-19", { method: "OPTIONS" });
  ok(pre.status === 204 && pre.headers["access-control-allow-origin"],
     "preflight OPTIONS accepté avec en-têtes CORS",
     pre.status + " allow-origin=" + pre.headers["access-control-allow-origin"]);
  const hz = await get(P + "/healthz");
  ok(hz.status === 200 && hz.json().ok === true, "GET /healthz", hz.status);
  const live = await get(P + "/live?date=2026-09-19");
  const lj = live.json();
  ok(live.status === 200 && lj && Array.isArray(lj.games) && live.headers["access-control-allow-origin"] === "*",
     "GET /live renvoie les vrais matchs NHL + CORS",
     live.status + " " + (lj && lj.games ? lj.games.length + " matchs" : "")
     + " allow-origin=" + live.headers["access-control-allow-origin"]);
  const mauvais = await get(P + "/live?date=2026-13-99");
  ok(mauvais.status === 400, "date absurde refusée par le proxy", mauvais.status);
  const ref = await get(P + "/refresh");
  ok(ref.status === 202 && ref.json().etat === "lance", "GET /refresh déclenche la régénération",
     ref.status + " " + ref.text.slice(0, 60));
  const inconnu = await get(P + "/nimporte");
  ok(inconnu.status === 404, "route inconnue -> 404", inconnu.status);

  // ---------- 4. l'app statique avec proxy ----------
  console.log("\n--- 4. application statique + proxy ---");
  const html = fs.readFileSync(path.join(DIST, "app.html"), "utf-8");
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

  /* fabrique de navigateur factice : fetch se comporte comme un vrai navigateur */
  function nouveauNavigateur() {
  const reg = {}, store = {}, toasts = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    document: { body: new FakeEl("body"), createElement: t => new FakeEl(t),
                querySelector(s) { return reg[s] = reg[s] || new FakeEl(); } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    location: { protocol: "https:", hostname: "nhl-pronos.netlify.app" },
    fetch(u, o) {
      const url = u.startsWith("http") ? u : `http://127.0.0.1:${PORT_SITE}/` + u.replace(/^\//, "");
      /* comme un vrai navigateur : un 404/500 n'est PAS une exception de réseau,
         c'est une réponse avec un status — c'est apiFetch qui doit le remarquer */
      return new Promise((res, rej) => {
        const rq = http.request(url, { method: (o && o.method) || "GET" }, r => {
          let b = ""; r.on("data", d => b += d);
          /* r.statusCode, pas r.status : un objet http.IncomingMessage n'a pas de .status */
          r.on("end", () => res({ ok: r.statusCode >= 200 && r.statusCode < 300,
                                  status: r.statusCode,
                                  text: () => Promise.resolve(b),
                                  json: () => Promise.resolve(JSON.parse(b)) }));
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
  vm.runInContext(js + "\nglobalThis.__x={S:S,rPodium:rPodium,rLive:rLive,refreshStatique:refreshStatique,"
    + "lireConfig:lireConfig,rDetail:rDetail,jeuComplet:jeuComplet,header:header};", sb,
    { filename: "app-gratuit.js" });
  return { sb, reg, X: sb.__x,
           /* toast() passe par el(), qui écrit innerHTML — pas textContent */
           toasts: () => sb.document.body.children.filter(e => /toast/.test(e.className))
                             .map(e => e.innerHTML).join(" | ") };
  }

  const nav4 = nouveauNavigateur();
  await wait(5000);
  const X = nav4.X, S = X.S;
  ok(!!S.d, "données chargées depuis le dépôt statique", S.d ? S.d.games.length + " matchs" : "rien");
  ok(S.statique === true, "mode statique détecté");
  ok(S.api === `http://127.0.0.1:${PORT_PROXY}/`, "config.json lu : le proxy est connu de l'app",
     String(S.api));

  let m = new FakeEl("div"), err = null;
  try { await X.rLive(m); } catch (e) { err = e.message; }
  await wait(2500);
  const t = m.text();
  ok(!err && /Suivi en direct/.test(t) && !/indisponible/i.test(t),
     "onglet Live FONCTIONNE sur un hébergement statique", err || t.slice(0, 80).replace(/\s+/g, " "));
  ok(/\d/.test(t) && /(À VENIR|EN DIRECT|TERMINÉ)/.test(t), "le Live affiche l'état des matchs",
     (t.match(/(À VENIR|EN DIRECT|TERMINÉ)/g) || []).slice(0, 3).join(", "));

  m = new FakeEl("div");
  try { await X.rPodium(m); } catch (e) { err = e.message; }
  ok(/Proxy actif/.test(m.text()), "le bandeau dit que le proxy est actif");

  // rafraîchissement : on ne lance qu'une requête, puis on coupe la boucle d'attente
  const avant = S.d.generatedUtc;
  X.refreshStatique().catch(() => {});
  await wait(3000);
  const t4 = nav4.toasts();
  ok(/compte 2 à 3 minutes/.test(t4),
     "bouton Rafraîchir appelle le proxy et annonce le vrai délai",
     t4.slice(0, 80) + "  (données du " + avant + ")");

  // ---------- 5. dégradation : sans config.json, puis avec un proxy en panne ----------
  console.log("\n--- 5. dégradation quand le proxy est absent ou en panne ---");
  proxy.kill();
  fs.unlinkSync(path.join(DIST, "config.json"));
  const nav5 = nouveauNavigateur();
  await wait(4000);
  const Y = nav5.X;
  ok(!!Y.S.d && Y.S.statique === true, "l'app démarre quand même sans config.json",
     Y.S.d ? Y.S.d.games.length + " matchs" : "rien");
  ok(!Y.S.api, "aucun proxy inventé : S.api reste vide", String(Y.S.api));
  Y.header();
  const b5 = nav5.reg["#bRefreshTx"];
  ok(b5 && b5.textContent === "Recharger",
     "le bouton devient « Recharger » au lieu de promettre un rafraîchissement",
     b5 ? b5.textContent : "absent");
  let m5 = new FakeEl("div"), e5 = null;
  try { await Y.rLive(m5); } catch (e) { e5 = e.message; }
  await wait(1200);
  const t5 = m5.text().replace(/\s+/g, " ");
  ok(!e5 && /Indisponible sur un hébergement statique/.test(t5) && /server\.py 8000/.test(t5),
     "l'onglet Live explique la marche à suivre au lieu de rester vide", e5 || t5.slice(0, 130));

  /* proxy qui répond 503 : l'app doit le dire, pas se taire */
  const casse = http.createServer((q, r) => { r.writeHead(503, { "content-type": "text/plain" });
                                              r.end("worker éteint"); });
  await new Promise(r => casse.listen(8788, "127.0.0.1", r));
  fs.writeFileSync(path.join(DIST, "config.json"),
                   JSON.stringify({ api: "http://127.0.0.1:8788/" }) + "\n");
  const nav6 = nouveauNavigateur();
  await wait(4000);
  const Z = nav6.X;
  ok(Z.S.api === "http://127.0.0.1:8788/", "config.json lu même si le proxy est en panne",
     String(Z.S.api));
  Z.header();
  const b6 = nav6.reg["#bRefreshTx"];
  ok(b6 && b6.textContent === "Rafraîchir", "le bouton garde le bon libellé", b6 ? b6.textContent : "absent");
  let m6 = new FakeEl("div"), e6 = null;
  try { await Z.rLive(m6); } catch (e) { e6 = e.message; }
  await wait(1200);
  const t6 = m6.text().replace(/\s+/g, " ");
  ok(!e6 && /Live indisponible/.test(t6) && /réponse HTTP 503/.test(t6),
     "proxy en panne : le message cite le code reçu", e6 || t6.slice(0, 110));
  Z.refreshStatique();
  await wait(2500);
  const t6b = nav6.toasts();
  ok(/Proxy injoignable/.test(t6b) || /Refusé/.test(t6b),
     "Rafraîchir signale l'échec au lieu de faire semblant", t6b.slice(0, 90));
  casse.close();

  site.kill();
  fs.rmSync(DIST, { recursive: true, force: true });
  console.log("\nRESULTAT MONTAGE GRATUIT : " + (fails.length ? fails.length + " ECHEC(S) : " + fails.join(" | ")
    : "TOUT EST OK — Live et Rafraîchir fonctionnent sans serveur payant"));
  process.exit(fails.length ? 1 : 0);
})();

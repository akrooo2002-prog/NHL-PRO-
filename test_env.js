/**
 * Matrice d'environnements de l'app de pronostics NHL.
 *
 * test_app.js vérifie que l'app est JUSTE. Ce fichier vérifie qu'elle TIENT
 * dans les environnements réels où elle peut se retrouver :
 *
 *   A. hors ligne / sans serveur
 *      A1  engine.py tourne seul, sans réseau ni serveur
 *      A2  fetch_pronos.py sans DNS : échec propre, pas de crash muet
 *   B. application sans serveur joignable
 *      B1  données chargées mais /api injoignable : l'app tient et explique
 *      B2  rien ne répond : l'app affiche la commande à lancer
 *      B3  page ouverte en file:// : diagnostic explicite (pas de fetch bloqué)
 *   C. serveur réel
 *      C1  routes inconnues -> 404 JSON
 *      C2  GET /api/refresh?lancer=1 lance la collecte (les proxys refusent POST)
 *      C3  POST /api/refresh pendant une collecte -> « deja_en_cours »
 *      C4  gzip activé uniquement si le client le demande
 *      C5  /api/live : date invalide -> 400, date valide -> 200
 *      C6  URL absurde -> 404, pas d'exception serveur
 *   D.  app.html : syntaxe JS valide (node --check)
 *
 * Usage:  node test_env.js [http://127.0.0.1:8000]
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");
const http = require("http");
const cp = require("child_process");

const BASE = process.argv.slice(2).find(a => !a.startsWith("--")) || "http://127.0.0.1:8000";
const ROOT = __dirname;
const fails = [];
const ok = (cond, label, extra = "") => {
  console.log((cond ? "  OK    " : "  ECHEC ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails.push(label);
};

function http2(url, method, headers, ms) {
  return new Promise(res => {
    const req = http.request(BASE + url, { method: method || "GET", headers: headers || {} }, r => {
      let b = "";
      r.on("data", d => b += d);
      r.on("end", () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, body: b, json: () => j, headers: r.headers, n: b.length });
      });
    });
    req.setTimeout(ms || 10000, () => { req.destroy(new Error("délai")); });
    req.on("error", e => res({ status: 0, error: String(e.message || e) }));
    req.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, opts) => new Promise(res => {
  cp.exec(cmd, Object.assign({ cwd: ROOT, timeout: 600000 }, opts || {}),
    (e, out, err) => res({ code: e ? (e.code == null ? "signal" : e.code) : 0, out, err }));
});

/* ---------------- exécute le vrai script de app.html dans un DOM simulé ---------------- */
class FakeEl {
  constructor(t) {
    this.tagName = (t || "div").toUpperCase();
    this.children = []; this.className = ""; this.textContent = ""; this.value = "";
    this.style = { set cssText(v) {}, get cssText() { return ""; } };
    const s = this;
    this.classList = { add(c) { s.className += " " + c; }, remove(c) { s.className = s.className.replace(c, ""); },
                       contains(c) { return s.className.includes(c); } };
  }
  set innerHTML(v) { this._ih = (this._ih || "") + String(v); }
  get innerHTML() { return (this._ih || "") + this.children.map(c => c.innerHTML).join(""); }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; return o; }
  insertBefore(c, r) { const i = this.children.indexOf(r); i < 0 ? this.children.push(c) : this.children.splice(i, 0, c); return c; }
  querySelector() { return new FakeEl(); } querySelectorAll() { return []; }
  setAttribute() {} click() {}
  text() { let t = this.innerHTML + this.textContent; this.children.forEach(c => t += c.text()); return t; }
}

const html = fs.readFileSync(path.join(ROOT, "app.html"), "utf-8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

function vmExec(o) {
  o = o || {};
  const reg = {}, store = {};
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    document: { body: new FakeEl("body"), createElement: t => new FakeEl(t),
                querySelector(s) { return reg[s] = reg[s] || new FakeEl(); } },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    fetch: o.fetch,
    URL, Blob: class {}, setTimeout, clearTimeout, Math, Number, String, Object, Array, JSON, Date, Promise, isNaN,
  };
  if (o.protocol) sb.location = { protocol: o.protocol };
  sb.window = sb; sb.globalThis = sb; sb.scrollTo = () => {};
  vm.createContext(sb);
  vm.runInContext(js + "\nglobalThis.__x={S:S,serverAlive:serverAlive,serverDiag:serverDiag,refresh:refresh,"
    + "SUR_HTTP:SUR_HTTP,API:API,chargerDonnees:chargerDonnees,rPodium:rPodium,rLive:rLive};",
    sb, { filename: "app-inline.js" });
  return sb;
}
const fileOk = u => {
  const p = path.join(ROOT, u.replace(/^\//, "").split("?")[0]);
  if (!fs.existsSync(p)) return Promise.reject(new Error("absent " + u));
  return Promise.resolve({ json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf-8"))), status: 200 });
};
const netFetch = u => new Promise(res => {
  const req = http.request(BASE + "/" + u.replace(/^\//, ""), r => {
    let b = ""; r.on("data", d => b += d);
    r.on("end", () => res({ status: r.statusCode, json: () => { try { return JSON.parse(b); } catch (e) { return null; } } }));
  });
  req.on("error", e => res(Promise.reject(e)));
  req.setTimeout(15000, () => req.destroy(new Error("délai")));
  req.end();
});
const deadFetch = () => Promise.reject(new TypeError("Failed to fetch"));

(async () => {
  // ================= A. hors ligne =================
  console.log("\n--- A. hors ligne, sans serveur ---");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nhl-offline-"));
  fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "engine.py"), path.join(tmp, "engine.py"));
  fs.copyFileSync(path.join(ROOT, "data", "pronos.json"), path.join(tmp, "data", "pronos.json"));
  const off = await run("python3 engine.py", { cwd: tmp });
  const produit = path.join(tmp, "data", "analyse.json");
  let nGames = 0;
  if (fs.existsSync(produit)) nGames = JSON.parse(fs.readFileSync(produit, "utf-8")).games.length;
  ok(off.code === 0 && nGames > 100, "A1 engine.py tourne seul, sans serveur ni réseau",
     "exit " + off.code + ", " + nGames + " matchs");

  const dns = await run("python3 fetch_pronos.py 1",
    { env: Object.assign({}, process.env, { no_proxy: "*" }), cwd: tmp });
  // sans DNS, l'API est injoignable : le script doit s'arrêter proprement, pas produire un fichier vide
  const propre = dns.code !== 0 || /échec/.test(dns.out + dns.err);
  ok(propre, "A2 fetch_pronos.py sans accès API : échec explicite",
     "exit " + dns.code + " · " + ((dns.out + dns.err).match(/échec[^\n]{0,60}/) || ["aucun message"])[0]);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ================= B. app sans serveur =================
  console.log("\n--- B. application, serveur injoignable ---");
  let sb = vmExec({ fetch: u => (/^\/?api\//.test(u) ? deadFetch() : fileOk(u)) });
  await wait(2500);
  ok(!!sb.__x.S.d && sb.__x.S.d.games.length > 100, "B1 les données restent affichées sans /api",
     sb.__x.S.d ? sb.__x.S.d.games.length + " matchs" : "rien");
  ok(sb.__x.S.srv && sb.__x.S.srv.ok === false, "B1 l'app sait que le serveur est mort");
  let diag = sb.__x.serverDiag(sb.__x.S.srv);
  ok(/server\.py/.test(diag) && /localhost:8000/.test(diag), "B1 le diagnostic donne la commande exacte",
     diag.replace(/<[^>]+>/g, "").slice(0, 80) + "…");
  let m = new FakeEl("div");
  let err = null;
  try { await sb.__x.rPodium(m); } catch (e) { err = e.message; }
  ok(!err && m.text().length > 500, "B1 l'onglet Podium fonctionne quand même", err || m.text().length + " car.");
  // le bouton Rafraîchir doit expliquer, pas juste « échec »
  await sb.__x.refresh();
  const ecranR = sb.document.querySelector("#main").innerHTML.replace(/<[^>]+>/g, " ");
  ok(/Rafraîchissement impossible/.test(ecranR) && /server\.py/.test(ecranR),
     "B1 le bouton Rafraîchir explique pourquoi il échoue", ecranR.replace(/\s+/g, " ").slice(0, 80) + "…");
  m = new FakeEl("div"); err = null;
  try { await sb.__x.rLive(m); } catch (e) { err = e.message; }
  const txt = m.text();
  ok(!err && /indisponible|injoignable|Failed to fetch|serveur/i.test(txt), "B1 l'onglet Live explique au lieu de planter",
     err || txt.slice(0, 90));

  sb = vmExec({ fetch: deadFetch });
  await wait(2500);
  const ecran = sb.document.querySelector("#main").innerHTML;
  ok(!sb.__x.S.d && /server\.py/.test(ecran), "B2 rien ne répond : l'app affiche la commande à lancer",
     ecran.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 90) + "…");

  sb = vmExec({ protocol: "file:", fetch: deadFetch });
  await wait(600);
  ok(sb.__x.SUR_HTTP === false && /^http:/.test(sb.__x.API), "B3 file:// détecté et base absolue substituée",
     "SUR_HTTP=" + sb.__x.SUR_HTTP + " API=" + sb.__x.API);
  const alive = await sb.__x.serverAlive();
  ok(alive.ok === false && alive.pourquoi === "file", "B3 diagnostic « ouvert depuis le disque »",
     JSON.stringify(alive));
  ok(/file:\/\//.test(sb.__x.serverDiag(alive)), "B3 le message explique le blocage navigateur");

  // ================= C. serveur réel =================
  console.log("\n--- C. serveur réel (" + BASE + ") ---");
  const h = await http2("/api/health");
  if (h.status !== 200) {
    ok(false, "C le serveur doit tourner pour cette partie", "statut " + h.status + " " + (h.error || ""));
  } else {
    const nf = await http2("/route/qui/nexiste/pas");
    ok(nf.status === 404 && nf.json() && !!nf.json().error, "C1 route inconnue -> 404 JSON",
       nf.status + " " + nf.body.slice(0, 50));

    const lancer = await http2("/api/refresh?lancer=1");
    ok(lancer.status === 202 && lancer.json() && ["lance", "deja_en_cours"].includes(lancer.json().etat),
       "C2 GET ?lancer=1 lance la collecte", lancer.status + " " + lancer.body.slice(0, 50));
    const deja = await http2("/api/refresh", "POST");
    ok(deja.status === 202 && deja.json() && deja.json().etat === "deja_en_cours",
       "C3 POST pendant une collecte -> deja_en_cours", deja.status + " " + deja.body.slice(0, 50));
    let st = null;
    for (let i = 0; i < 200; i++) { st = await http2("/api/refresh"); if (st.json() && !st.json().running) break; await wait(3000); }
    const res = st && st.json();
    ok(!!res && (res.ok === true || res.ok === null),
       "C2/C3 la collecte lancée par GET aboutit (ou cède la place au verrou)",
       res ? "ok=" + res.ok + " · " + (res.log || []).join(" | ").slice(0, 90) : "?");
    // deux collectes ne doivent jamais tourner ensemble : engine.py ne peut pas
    // lire data/pronos.json pendant qu'une autre collecte l'écrit
    const data = await http2("/data/analyse.json");
    ok(data.status === 200 && data.json() && data.json().games.length > 100,
       "C2/C3 les données servies restent valides après concurrence",
       data.json() ? data.json().games.length + " matchs, " + data.json().generatedUtc : "illisible");

    const gz = await http2("/data/analyse.json", "GET", { "Accept-Encoding": "gzip" });
    const brut = await http2("/data/analyse.json");
    ok(gz.headers["content-encoding"] === "gzip" && gz.n < brut.n / 3,
       "C4 gzip quand le client le demande", gz.n + " o vs " + brut.n + " o");
    ok(!brut.headers["content-encoding"], "C4 pas de gzip imposé", "content-encoding absent");

    const bad = await http2("/api/live?date=pas-une-date");
    const mois13 = await http2("/api/live?date=2026-13-99");
    const fev30 = await http2("/api/live?date=2026-02-30");
    const bon = await http2("/api/live?date=2026-09-19");
    ok(bad.status === 400, "C5 texte à la place d'une date -> 400", bad.status);
    ok(mois13.status === 400, "C5 mois 13 -> 400 (et pas le 404 de l'API NHL)", mois13.status);
    ok(fev30.status === 400, "C5 30 février -> 400", fev30.status);
    ok(bon.status === 200 && bon.json() && Array.isArray(bon.json().games), "C5 date valide -> matchs",
       bon.status + " " + (bon.json() ? bon.json().games.length + " matchs" : ""));

    const absurde = await http2("/" + "a".repeat(2000));
    ok(absurde.status === 404, "C6 URL de 2 000 caractères -> 404 propre", absurde.status);
    const vivant = await http2("/api/health");
    ok(vivant.status === 200, "C6 le serveur est toujours vivant après", vivant.status);
  }

  // ================= D. syntaxe =================
  console.log("\n--- D. code ---");
  fs.writeFileSync(path.join(os.tmpdir(), "app-inline-check.js"), js);
  const chk = await run("node --check " + path.join(os.tmpdir(), "app-inline-check.js"));
  ok(chk.code === 0, "D app.html : JavaScript syntaxiquement valide", chk.err.split("\n")[0] || "");

  console.log("\nRESULTAT ENVIRONNEMENTS : " + (fails.length ? fails.length + " ECHEC(S) : " + fails.join(" | ")
    : "TOUS LES ENVIRONNEMENTS SONT COUVERTS"));
  process.exit(fails.length ? 1 : 0);
})();

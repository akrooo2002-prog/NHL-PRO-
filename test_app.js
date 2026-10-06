/**
 * Test de l'app de pronostics NHL : exécute le VRAI script de app.html dans un
 * DOM simulé, avec les VRAIES données de data/analyse.json, et attaque le VRAI
 * serveur HTTP.
 *
 * Vérifie :
 *   1. les données contiennent bien recrues et historiques adverses
 *   2. les 5 onglets rendent réellement du contenu
 *   3. effG() SANS override reproduit à l'identique le moteur Python
 *      (score, probabilité, indice, palier, rang) — sinon l'interface ment
 *   4. le recalcul avec un gardien confirmé modifie bien λ et les probabilités
 *   5. déclarer un absent fait bien chuter l'indice et le rang
 *   6. le podium du jour = exactement 3 joueurs par marché, dans le bon ordre,
 *      et identique au classement du moteur
 *   7. les recrues sont plafonnées au palier 2 côté client comme côté serveur
 *   8. le Live lit les buteurs quel que soit le nom de la clé NHL
 *   9. le serveur répond, /api/live sert des matchs, /api/refresh relance
 *      VRAIMENT fetch_pronos.py + engine.py et l'app recharge des données plus
 *      récentes
 *
 * Usage:  node test_app.js [http://127.0.0.1:8000] [--skip-refresh]
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");

const BASE = process.argv.slice(2).find(a => !a.startsWith("--")) || "http://127.0.0.1:8000";
const SKIP_REFRESH = process.argv.includes("--skip-refresh");
const html = fs.readFileSync(path.join(__dirname, "app.html"), "utf-8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---------------------------- DOM simulé ---------------------------- */
class FakeEl {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this.children = []; this.className = ""; this._html = ""; this.value = "";
    this.textContent = ""; this.title = ""; this.selected = false; this.href = "";
    this.style = { set cssText(v) {}, get cssText() { return ""; } };
    this.onclick = this.oninput = this.onchange = this.onerror = null;
    this.parentNode = null;
    const self = this;
    this.classList = { add(c) { self.className += " " + c; }, remove(c) { self.className = self.className.replace(c, "").trim(); },
                       contains(c) { return self.className.includes(c); } };
  }
  set innerHTML(v) {
    const h = String(v);
    const tags = h.match(/<(table|thead|tbody|tr|td|th)\b/gi) || [];
    tags.forEach(t => { (this._parsed = this._parsed || []).push(new FakeEl(t.slice(1).toLowerCase())); });
    this._ih = (this._ih || "") + h;
  }
  get innerHTML() { return (this._ih || "") + this.children.map(c => c.innerHTML).join(""); }
  appendChild(c) { if (c) c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; return o; }
  insertBefore(c, r) { const i = this.children.indexOf(r); i < 0 ? this.children.push(c) : this.children.splice(i, 0, c); return c; }
  get lastChild() { return this.children[this.length - 1] || null; }
  querySelectorAll() { return []; }
  querySelector() { this._qs = this._qs || new FakeEl("div"); return this._qs; }
  setAttribute() {} click() {}
  text() { let t = this.innerHTML + this.textContent + (this.value || ""); this.children.forEach(c => t += c.text()); return t; }
  count(tag) {
    let n = this.tagName === tag ? 1 : 0;
    (this._parsed || []).forEach(c => { if (c.tagName === tag) n++; });
    this.children.forEach(c => n += c.count(tag));
    return n;
  }
}

const store = {};
const registry = {};
const body = new FakeEl("body");

function httpJson(url, method) {
  return new Promise(res => {
    const req = http.request(BASE + url, { method: method || "GET" }, r => {
      let b = "";
      r.on("data", d => b += d);
      r.on("end", () => {
        let j = null; try { j = JSON.parse(b); } catch (e) {}
        res({ status: r.statusCode, body: b, json: () => j });
      });
    });
    req.on("error", e => res({ status: 0, error: String(e) }));
    req.end();
  });
}

const sandbox = {
  console,
  document: {
    body,
    createElement: t => new FakeEl(t),
    querySelector(s) { registry[s] = registry[s] || new FakeEl("div"); return registry[s]; },
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  fetch(url, opt) {
    // api/* -> le vrai serveur ; le reste -> les fichiers du disque
    if (/^\/?api\//.test(url)) return httpJson("/" + url.replace(/^\/?api\//, "api/"), opt && opt.method);
    const p = path.join(__dirname, url.replace(/^\//, "").split("?")[0]);
    if (!fs.existsSync(p)) return Promise.reject(new Error("absent: " + url));
    return Promise.resolve({ json: () => Promise.resolve(JSON.parse(fs.readFileSync(p, "utf-8"))) });
  },
  URL, Blob: class { }, setTimeout, clearTimeout, Math, Number, String, Object, Array, JSON, Date, Promise, isNaN,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.scrollTo = () => { };
vm.createContext(sandbox);
vm.runInContext(js + "\nglobalThis.__x={S:S,effG:effG,palier:palier,confiance:confiance,court:court,"
  + "SEUIL:SEUIL,goalieOptions:goalieOptions,podiumJour:podiumJour,scorersOf:scorersOf,refresh:refresh,"
  + "rPodium:rPodium,rMatchs:rMatchs,rDetail:rDetail,rLive:rLive,rMethode:rMethode,dates:dates};\n",
  sandbox, { filename: "app-inline.js" });

const wait = ms => new Promise(r => setTimeout(r, ms));
const fails = [], warns = [];
const ok = (cond, label, extra = "") => {
  console.log((cond ? "  OK    " : "  ECHEC ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails.push(label);
};
const note = (cond, label, extra = "") => {
  console.log((cond ? "  OK    " : "  INFO  ") + label + (extra ? "  " + extra : ""));
  if (!cond) warns.push(label);
};

(async () => {
  await wait(2500);
  const X = sandbox.__x, S = X.S;
  console.log("\n--- données ---");
  ok(!!S.d, "analyse.json chargée", S.d ? S.d.games.length + " matchs" : "");
  const all = [].concat(...S.d.games.map(g => g.players));
  const total = all.length;
  ok(total > 3000, "volume d'analyses", total.toLocaleString("fr-FR") + " joueurs");
  const recrues = all.filter(p => p.recrue);
  ok(recrues.length > 100, "recrues présentes", recrues.length + " fiches");
  const ligues = [...new Set(recrues.map(r => r.recrue.ligue))];
  ok(ligues.length >= 3, "recrues issues de plusieurs ligues", ligues.join(", "));
  const h2h = all.filter(p => p.h2h && p.h2h.n >= 2);
  ok(h2h.length > 50, "historique contre l'adversaire", h2h.length + " joueurs");
  const hausse = all.filter(p => p.flags.includes("en_hausse"));
  ok(hausse.length > 50, "joueurs détectés en hausse", hausse.length);

  // ---------- 1. rendu des onglets ----------
  console.log("\n--- rendu ---");
  const nJoueurs = S.d.games[0].players.length;
  // les onglets « matchs » et « select » dépendent du jour rendu (S.date) :
  // seuils proportionnels au nombre de matchs (un jour d'ouverture à 3 matchs est normal)
  const nMatchsJour = Math.max(1, S.d.games.filter((g) => g.date === S.date).length);
  for (const [name, fn, tag, min] of [["podium", sandbox.rPodium, "DIV", 200],
                                      ["matchs", sandbox.rMatchs, "DIV", Math.max(80, 30 * nMatchsJour)],
                                      ["select", sandbox.rSelect, "DIV", Math.max(20, 6 * nMatchsJour)],
                                      ["methode", sandbox.rMethode, "TR", 6]]) {
    const m = new FakeEl("div");
    let err = null;
    try { await fn(m); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" | "); }
    console.log(`    ${name}: ${m.count("TR")} <tr>, ${m.count("DIV")} <div>, ${m.count("TABLE")} <table>, ${m.text().length} car.`);
    ok(!err && m.count(tag) >= min && m.text().length > 800, `onglet « ${name} »`,
       err || `${m.count(tag)} <${tag.toLowerCase()}> (min ${min}), ${m.text().length} car.`);
  }
  // Analyse : la fiche complète est chargée à la demande (data/match-<id>.json).
  // Ici les données viennent du fichier complet, donc on la fournit directement.
  {
    const g0 = S.d.games[0];
    S.game = g0.id;
    let m = new FakeEl("div");
    await sandbox.rDetail(m);
    const attente = m.text();
    ok(/Chargement|indisponible/i.test(attente), "onglet « analyse » sans fiche : état explicite",
       attente.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 70));
    S.complets[g0.id] = g0;
    m = new FakeEl("div");
    let err = null;
    try { await sandbox.rDetail(m); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" | "); }
    console.log(`    detail: ${m.count("TR")} <tr>, ${m.count("TABLE")} <table>, ${m.text().length} car.`);
    ok(!err && m.count("TR") >= nJoueurs + 1 && m.text().length > 800, "onglet « analyse »",
       err || `${m.count("TR")} <tr> (min ${nJoueurs + 1}), ${m.text().length} car.`);
    delete S.complets[g0.id];
  }
  // le Live a besoin du proxy : on le teste réellement plus bas
  try { const m = new FakeEl("div"); await sandbox.rLive(m); await wait(1500);
    ok(m.text().length > 200, "onglet « live »", m.text().length + " car."); }
  catch (e) { ok(false, "onglet « live »", e.message); }

  // ---------- 2. effG() sans override == moteur Python ----------
  console.log("\n--- fidélité client / moteur ---");
  let n = 0, dProb = 0, dScore = 0, dConf = 0, dPal = 0, dRank = 0;
  S.d.games.forEach(g => {
    const e = X.effG(g);
    g.players.forEach((p, i) => {
      const q = e.players[i];
      for (const mk of ["buteur", "passeur", "pointeur"]) {
        n++;
        dProb = Math.max(dProb, Math.abs(p[mk].prob - q[mk].prob));
        dScore = Math.max(dScore, Math.abs(p[mk].score - q[mk].score));
        dConf = Math.max(dConf, Math.abs(p[mk].confidence - q[mk].confidence));
        if (p[mk].palier !== q[mk].palier) dPal++;
        if (p[mk].rank !== q[mk].rank) dRank++;
      }
    });
  });
  console.log(`    ${n} couples joueur × marché comparés`);
  ok(dProb < 1e-9, "probabilités identiques", "écart max " + dProb);
  ok(dScore < 1e-9, "scores identiques", "écart max " + dScore);
  ok(dConf < 1e-9, "indices identiques", "écart max " + dConf.toFixed(3));
  ok(dPal === 0, "paliers identiques", dPal + " divergence(s)");
  ok(dRank === 0, "rangs identiques", dRank + " divergence(s)");

  // ---------- 3. override gardien ----------
  console.log("\n--- override gardien ---");
  const g0 = S.d.games.find(g => {
    const o = X.goalieOptions(g, g.home).filter(x => x.sv);
    return o.length >= 2 && o[0].sv !== o[o.length - 1].sv;
  }) || S.d.games.find(g => !g.preseason) || S.d.games[0];
  const base = X.effG(g0);
  const cible = base.players.filter(p => p.abbr === g0.away && p.pointeur.score > 0
    && !(p.flags || []).includes("absent") && !(p.flags || []).includes("news_blesse"))
    .sort((a, b) => a.pointeur.rank - b.pointeur.rank)[0];
  const opp = "home";
  const opts = X.goalieOptions(g0, g0.home);
  // sv le plus faible => probabilité la plus haute (comparaison faible vs fort,
  // indépendante du gardien déjà annoncé qui peut être l'un des deux)
  const tri = opts.filter(x => x.sv).sort((a, b) => a.sv - b.sv);
  const faible = tri[0], fort = tri[tri.length - 1];
  S.ov[g0.id] = { goalies: { [opp]: faible.playerId }, absents: [] };
  const q = X.effG(g0).players.find(p => p.id === cible.id);
  S.ov[g0.id] = { goalies: { [opp]: fort.playerId }, absents: [] };
  const q2 = X.effG(g0).players.find(p => p.id === cible.id);
  ok(fort.sv > faible.sv && q.pointeur.prob > q2.pointeur.prob,
     "gardien adverse plus faible => probabilité plus haute",
     `${(100 * q2.pointeur.prob).toFixed(1)} % (fort) -> ${(100 * q.pointeur.prob).toFixed(1)} % (faible)`);
  ok(Math.abs(q.pointeur.lam - q2.pointeur.lam) > 1e-6, "λ recalculé",
     q2.pointeur.lam + " -> " + q.pointeur.lam);
  S.ov[g0.id] = { goalies: { [opp]: 99999999 }, absents: [] };
  const ign = X.effG(g0);
  ok(Math.abs(ign.players.find(p => p.id === cible.id).pointeur.prob - cible.pointeur.prob) < 1e-9,
     "gardien inconnu ignoré sans effet");
  S.ov[g0.id] = { goalies: {}, absents: [] };

  // ---------- 4. absent déclaré ----------
  console.log("\n--- absent déclaré ---");
  const g1 = S.d.games.find(g => !g.preseason) || S.d.games[0];
  const b1 = X.effG(g1);
  const top = b1.players.filter(p => p.pointeur.rank).sort((a, b) => a.pointeur.rank - b.pointeur.rank)[0];
  S.ov[g1.id] = { goalies: {}, absents: [top.id] };
  const a1 = X.effG(g1);
  const t1 = a1.players.find(p => p.id === top.id);
  ok(t1.flags.includes("manuel_absent"), "drapeau « absent (déclaré) » posé");
  ok(t1.pointeur.prob < top.pointeur.prob, "probabilité effondrée",
     `${Math.round(100 * top.pointeur.prob)} % -> ${Math.round(100 * t1.pointeur.prob)} %`);
  ok(t1.pointeur.confidence < top.pointeur.confidence, "indice en baisse",
     top.pointeur.confidence + " -> " + t1.pointeur.confidence);
  const nouveau = a1.players.filter(p => p.pointeur.rank).sort((a, b) => a.pointeur.rank - b.pointeur.rank)[0];
  ok(nouveau.id !== top.id, "le joueur absent perd la tête du classement", "nouveau n°1 : " + nouveau.name);
  S.ov[g1.id] = { goalies: {}, absents: [] };

  // ---------- 5. podium du jour ----------
  console.log("\n--- podium du jour ---");
  const jour = X.dates()[0];
  S.date = jour; S.hidePre = false;
  // exactement les matchs que l'onglet Podium affiche ce jour-là
  const games = S.d.games.filter(g => g.date === jour);
  const vus = [...new Set(games.map(g => g.id))];
  ok(vus.length === games.length, "un match analysé une seule fois par jour", vus.length + " matchs le " + jour);
  const pd = X.podiumJour(games);
  let podiumOk = true, ordreOk = true, fidOk = true;
  for (const mk of ["buteur", "passeur", "pointeur"]) {
    const rows = pd[mk] || [];
    if (rows.length !== 3) podiumOk = false;
    for (let i = 1; i < rows.length; i++)
      if (rows[i].p[mk].confidence > rows[i - 1].p[mk].confidence) ordreOk = false;
    // chaque joueur du podium doit avoir le rang que le moteur lui a donné
    rows.forEach(({ p, g }) => {
      const src = g.players.find(x => x.id === p.id);
      if (!src || src[mk].rank > 3) fidOk = false;
    });
  }
  ok(podiumOk, "3 joueurs par marché", MKS().map(mk => mk + "=" + (pd[mk] || []).length).join(" "));
  ok(ordreOk, "podium trié par indice décroissant");
  ok(fidOk, "podium identique au top 3 du moteur");
  console.log("    " + ["buteur", "passeur", "pointeur"].map(mk =>
    mk + " : " + (pd[mk] || []).map(r => r.p.name + " " + Math.round(100 * r.p[mk].prob) + " %").join(" / ")).join("\n    "));

  // ---------- 6. recrues côté client ----------
  console.log("\n--- recrues ---");
  const rc = all.filter(p => p.recrue);
  ok(rc.every(p => p.pointeur.palier <= 2), "recrues plafonnées au palier 2 côté serveur");
  const gR = S.d.games.find(g => g.players.some(p => p.recrue));
  const eR = X.effG(gR);
  ok(eR.players.filter(p => p.recrue).every(p => p.pointeur.palier <= 2),
     "recrues plafonnées au palier 2 côté client");
  ok(rc.every(p => p.pointeur.why && p.pointeur.why.includes("recrue")),
     "justification des recrues explicite");
  // une recrue ne doit jamais passer devant le meilleur joueur établi d'un match
  let doubl = 0, verif = 0;
  S.d.games.forEach(g => {
    ["buteur", "passeur", "pointeur"].forEach(mk => {
      const rec = g.players.filter(p => p.recrue && p[mk].rank);
      // invariant : une recrue (indice figé 51, palier plafonné) ne passe jamais
      // devant un établi SOLIDE (conf >= 55). Les établis faibles/blessés/petit
      // échantillon peuvent légitimement descendre sous une recrue.
      const eta = g.players.filter(p => !p.recrue && p[mk].rank
        && (p[mk].confidence || 0) >= 55);
      if (!rec.length || !eta.length) return;
      verif++;
      const mR = Math.min(...rec.map(p => p[mk].rank));
      const mE = Math.min(...eta.map(p => p[mk].rank));
      if (mR < mE) doubl++;
    });
  });
  ok(doubl === 0, "aucune recrue ne passe devant un établi solide (conf ≥ 55)", doubl + " cas sur " + verif);

  // ---------- 7. Live : lecture des buteurs ----------
  console.log("\n--- live ---");
  const fakeA = { abbrev: "CAR", score: 2, scorers: [{ playerId: 8471214, period: 1, timeInPeriod: "05:00" }],
                  goals: [{ playerId: 8475766, period: 2, timeInPeriod: "11:00" }] };
  const ids = X.scorersOf(fakeA).map(s => s.playerId);
  ok(ids.includes(8471214) && ids.includes(8475766), "buteurs lus quel que soit le nom de la clé",
     ids.join(","));

  // ---------- 8. cohérence ----------
  console.log("\n--- cohérence ---");
  let firstOk = 0, firstTot = 0, horsBareme = 0, vide = 0, long = 0, maxLen = 0;
  S.d.games.forEach(g => {
    const e = X.effG(g);
    ["buteur", "passeur", "pointeur"].forEach(mk => {
      const r = e.players.filter(p => p[mk].rank).sort((a, b) => a[mk].rank - b[mk].rank);
      if (r.length) { firstTot++; if (r[0][mk].confidence >= (r[1] ? r[1][mk].confidence : -1)) firstOk++; }
      e.players.forEach(p => {
        const c = p[mk].confidence, pal = p[mk].palier;
        const attendu = X.palier(c);
        if (pal !== attendu) horsBareme++;
        if (!p[mk].why || p[mk].why.trim().length < 20) vide++;
        const L = (p[mk].why || "").length;
        maxLen = Math.max(maxLen, L);
        if (L > 440) long++;
      });
    });
  });
  ok(firstOk === firstTot, "le n°1 a toujours la meilleure confiance", firstOk + "/" + firstTot);
  ok(horsBareme === 0, "paliers conformes au barème affiché", horsBareme + " hors barème");
  ok(vide === 0, "chaque analyse a une justification", vide + " vide(s)");
  ok(long === 0, "justifications concises", long + " trop longues (> 440 car.), max " + maxLen);

  // ---------- 9. serveur ----------
  console.log("\n--- serveur ---");
  const health = await httpJson("/api/health");
  ok(health.status === 200 && health.json() && health.json().ok === true, "GET /api/health",
     health.status + " " + (health.body || "").slice(0, 90));
  const app = await httpJson("/app");
  ok(app.status === 200 && app.body.includes("<!doctype html>"), "GET /app",
     app.status + " " + app.body.length + " octets");
  const data = await httpJson("/data/analyse.json");
  ok(data.status === 200 && data.json() && Array.isArray(data.json().games), "GET /data/analyse.json",
     data.status + " " + (data.json() ? data.json().games.length + " matchs" : ""));
  const av = data.json() ? data.json().generatedUtc : null;

  // 18 Mo de JSON : le gzip est indispensable sur mobile/APK
  const gz = await new Promise(res => {
    const req = http.request(BASE + "/data/analyse.json",
      { headers: { "Accept-Encoding": "gzip" } }, r => {
      let n = 0; r.on("data", d => n += d.length);
      r.on("end", () => res({ enc: r.headers["content-encoding"], n, status: r.statusCode }));
    });
    req.on("error", e => res({ err: String(e) }));
    req.end();
  });
  ok(gz.enc === "gzip" && gz.n < 4e6, "GET /data/analyse.json compressé en gzip",
     gz.enc + ", " + Math.round(gz.n / 1024) + " Ko transmis");

  const live = await httpJson("/api/live?date=" + jour);
  note(live.status === 200 && live.json() && Array.isArray(live.json().games), "GET /api/live",
     live.status + " " + (live.json() && live.json().games ? live.json().games.length + " matchs" : (live.body || "").slice(0, 80)));
  const bad = await httpJson("/api/live?date=pas-une-date");
  ok(bad.status === 400, "GET /api/live refuse une date invalide", bad.status);

  if (!SKIP_REFRESH) {
    console.log("\n--- rafraîchissement réel (collecte + moteur) ---");
    /* Une autre collecte peut être en cours (test_env.js, cron, clic dans l'app) :
       refresh.py la refuse par design. On attend sa fin au lieu de compter un échec. */
    for (let i = 0; i < 100; i++) {
      const enCours = await httpJson("/api/refresh");
      if (!enCours.json() || !enCours.json().running) break;
      if (i === 0) console.log("  INFO  une collecte est déjà en cours, on attend sa fin");
      await wait(3000);
    }
    const post = await httpJson("/api/refresh", "POST");
    ok(post.status === 202, "POST /api/refresh accepté", post.status + " " + (post.body || "").slice(0, 60));
    await wait(5000);                       // la collecte vient de démarrer
    let st = null;
    for (let i = 0; i < 200; i++) {
      st = await httpJson("/api/refresh");
      if (st.json() && !st.json().running) break;
      await wait(3000);
    }
    ok(!!st && st.json() && st.json().running === false, "le rafraîchissement se termine",
       st && st.json() ? "ok=" + st.json().ok : "?");
    ok(!!st && st.json() && st.json().ok === true, "fetch + engine sans erreur",
       st && st.json() ? (st.json().log || []).join(" | ") : "?");
    await wait(1200);
    const data2 = await httpJson("/data/analyse.json");
    const ap = data2.json() ? data2.json().generatedUtc : null;
    ok(!!ap && ap > av, "les données servies sont plus récentes", av + " -> " + ap);
    // l'app doit recharger les données (bouton « Rafraîchir » de l'interface).
    // NB : ce bouton relance lui-même la collecte, donc l'horodatage final est
    // postérieur à « ap » ; ce qu'on exige c'est qu'il soit plus récent que la marque.
    S.d = null;
    const marque = new Date().toISOString().slice(0, 19) + "Z";   // même format que generatedUtc
    const p = sandbox.refresh();
    let err = null; try { await p; } catch (e) { err = e.message; }
    ok(!err, "refresh() de l'app ne lève pas d'erreur", err || "");
    let vu = null;
    for (let i = 0; i < 200; i++) { await wait(1000); if (S.d) { vu = S.d.generatedUtc; break; } }
    ok(!!vu && vu >= marque, "l'app recharge les nouvelles données",
       (vu || "rien après 200 s") + " ≥ " + marque);
  } else {
    console.log("\n--- rafraîchissement réel : ignoré (--skip-refresh) ---");
  }

  console.log("\nRESULTAT : " + (fails.length ? fails.length + " ECHEC(S) : " + fails.join(" | ")
    : "TOUT EST OK") + (warns.length ? "  (" + warns.length + " info)" : ""));
  process.exit(fails.length ? 1 : 0);
})();

function MKS() { return ["buteur", "passeur", "pointeur"]; }

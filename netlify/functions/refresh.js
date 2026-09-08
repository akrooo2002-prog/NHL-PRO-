/* Déclenche le workflow GitHub qui régénère les analyses et redéploie le site. */
function h0() { return { "Content-Type": "application/json" }; }
exports.handler = async () => {
  /* __GH_REPO__ et __GH_PAT__ sont remplacés par le workflow GitHub au moment
     du déploiement (jamais en clair dans le dépôt). */
  const repo = "__GH_REPO__";
  const token = "__GH_PAT__";
  const workflow = "refresh.yml";
  if (token.startsWith("__")) {
    return { statusCode: 500, headers: h0(), body: JSON.stringify({ error: "fonction non injectée au déploiement" }) };
  }
  const h = h0();
  try {
    const r = await fetch(
      "https://api.github.com/repos/" + repo + "/actions/workflows/" + workflow + "/dispatches", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
                   "Content-Type": "application/json", "User-Agent": "netlify-pronos" },
        body: JSON.stringify({ ref: "main" }),
      });
    if (r.status === 204) {
      return { statusCode: 202, headers: h,
               body: JSON.stringify({ etat: "lance",
                 detail: "GitHub Actions régénère les données, compte 2 à 3 minutes puis recharge la page." }) };
    }
    const t = await r.text();
    return { statusCode: r.status, headers: h,
             body: JSON.stringify({ error: "GitHub a répondu " + r.status, detail: t.slice(0, 200) }) };
  } catch (e) {
    return { statusCode: 502, headers: h, body: JSON.stringify({ error: "GitHub injoignable : " + e.message }) };
  }
};

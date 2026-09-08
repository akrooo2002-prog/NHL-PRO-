/**
 * Proxy NHL — à déployer sur Cloudflare Workers (offre gratuite).
 *
 * Pourquoi il existe : api-web.nhle.com ne renvoie AUCUN en-tête
 * access-control-allow-origin (vérifié). Un navigateur bloque donc tout appel
 * direct depuis le site. Ce Worker sert d'intermédiaire et ajoute les en-têtes.
 *
 * Déploiement (gratuit, sans carte bancaire) :
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler deploy
 *
 * Ou sans outil : dashboard Cloudflare → Workers & Pages → Create → coller ce
 * fichier. L'URL obtenue (https://<nom>.<compte>.workers.dev) va dans
 * config.json du site.
 *
 * Trois routes :
 *   /live?date=AAAA-MM-JJ   scores en direct (cache Cloudflare 20 s)
 *   /healthz                sonde de vie
 *   /refresh                déclenche le workflow GitHub qui régénère les données
 *
 * Le Worker ne calcule rien : la collecte dure ~75 s, bien au-delà de la limite
 * CPU d'un Worker gratuit. C'est GitHub Actions qui la fait.
 */

const NHL = "https://api-web.nhle.com/v1/";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const ORIGINE_AUTORISEE = "*";        // à remplacer par ton URL Netlify/Pages pour verrouiller
const CACHE_SECONDES = 20;

function cors(origine) {
  return {
    "Access-Control-Allow-Origin": ORIGINE_AUTORISEE === "*" ? "*" : (origine || ORIGINE_AUTORISEE),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, statut, origine) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origine) },
  });
}

function jourValide(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + "T00:00:00Z"))
    && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origine = req.headers.get("Origin");
    const route = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origine) });
    }

    // --- sonde de vie -------------------------------------------------------
    if (route === "/healthz") {
      return json({ ok: true, service: "nhl-proxy", ts: new Date().toISOString() }, 200, origine);
    }

    // --- scores en direct ---------------------------------------------------
    if (route === "/live") {
      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      if (!jourValide(date)) {
        return json({ error: "paramètre date attendu au format AAAA-MM-JJ", recu: date }, 400, origine);
      }
      const cible = NHL + "score/" + date;
      // le cache de Cloudflare absorbe les rafraîchissements de tous les écrans
      const cleCache = new Request(cible, { method: "GET" });
      const deja = await caches.default.match(cleCache);
      if (deja) {
        const corps = await deja.text();
        return new Response(corps, {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8",
                     "X-Cache": "HIT", ...cors(origine) },
        });
      }
      let amont;
      try {
        amont = await fetch(cible, { headers: { "User-Agent": UA, Accept: "application/json" } });
      } catch (e) {
        return json({ error: "API NHL injoignable", detail: String(e && e.message || e) }, 502, origine);
      }
      const corps = await amont.text();
      if (!amont.ok) {
        return json({ error: "l'API NHL a refusé", code: amont.status }, amont.status, origine);
      }
      await caches.default.put(cleCache, new Response(corps, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + CACHE_SECONDES },
      }));
      return new Response(corps, {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8",
                   "X-Cache": "MISS", ...cors(origine) },
      });
    }

    // --- déclencher la régénération des données -----------------------------
    if (route === "/refresh") {
      const { GITHUB_REPO, GITHUB_TOKEN, GITHUB_WORKFLOW } = env;
      if (!GITHUB_REPO || !GITHUB_TOKEN) {
        return json({ error: "GITHUB_REPO et GITHUB_TOKEN non configurés sur ce Worker" }, 501, origine);
      }
      const jetonAppelant = url.searchParams.get("token") || "";
      if (env.REFRESH_TOKEN && jetonAppelant !== env.REFRESH_TOKEN) {
        return json({ error: "jeton absent ou incorrect" }, 403, origine);
      }
      const cible = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW || "refresh.yml"}/dispatches`;
      let reponse;
      try {
        reponse = await fetch(cible, {
          method: "POST",
          headers: { Authorization: `Bearer ${GITHUB_TOKEN}`,
                     Accept: "application/vnd.github+json",
                     "User-Agent": "nhl-pronos",
                     "X-GitHub-Api-Version": "2022-11-28" },
          body: JSON.stringify({ ref: "main" }),
        });
      } catch (e) {
        return json({ error: "GitHub injoignable", detail: String(e && e.message || e) }, 502, origine);
      }
      if (reponse.status === 204) {
        return json({ etat: "lance", detail: "GitHub Actions régénère les données, "
          + "compte 2 à 3 minutes puis recharge la page." }, 202, origine);
      }
      return json({ error: "GitHub a refusé", code: reponse.status,
                    detail: (await reponse.text()).slice(0, 300) }, reponse.status, origine);
    }

    return json({ error: "route inconnue", routes: ["/live?date=AAAA-MM-JJ", "/refresh", "/healthz"] },
                404, origine);
  },
};

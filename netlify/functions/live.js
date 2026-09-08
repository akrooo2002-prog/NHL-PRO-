/* Proxy Live même origine : l'API NHL refuse les appels directs du navigateur,
   mais accepte ceux d'une fonction serveur. Aucun CORS nécessaire ici. */
exports.handler = async (event) => {
  const date = ((event || {}).queryStringParameters || {}).date || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ error: "paramètre date attendu au format AAAA-MM-JJ" }) };
  }
  try {
    const r = await fetch("https://api-web.nhle.com/v1/score/" + date, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) pronos-nhl" },
    });
    const body = await r.text();
    return { statusCode: r.status, body,
             headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=20" } };
  } catch (e) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ error: "API NHL injoignable : " + e.message }) };
  }
};

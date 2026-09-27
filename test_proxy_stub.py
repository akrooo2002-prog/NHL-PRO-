#!/usr/bin/env python3
"""
Proxy de test : imite le Worker Cloudflare (worker/worker.js) sur un port local,
pour vérifier que le site STATIQUE retrouve le Live et le Rafraîchir.

  python3 test_proxy_stub.py [port]        (défaut 8787)

Il ne simule PAS les réponses de la NHL : il appelle réellement
api-web.nhle.com et renvoie la vraie réponse avec les en-têtes CORS que le
Worker ajouterait. /refresh renvoie une fausse réponse GitHub (202) pour ne pas
déclencher de vrai workflow pendant les tests.
"""
import datetime
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NHL = "https://api-web.nhle.com/v1/"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def jour_valide(d):
    if not d:
        return False
    try:
        return datetime.date.fromisoformat(d).isoformat() == d
    except ValueError:
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "NHLProxyStub/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def repond(self, statut, corps, ctype="application/json; charset=utf-8"):
        if isinstance(corps, str):
            corps = corps.encode()
        self.send_response(statut)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(corps)))
        self.cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corps)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(p.query)
        route = p.path.rstrip("/") or "/"
        if route == "/healthz":
            return self.repond(200, json.dumps({"ok": True, "service": "nhl-proxy-stub"}))
        if route == "/refresh":
            if q.get("token", [""])[0] != "":
                pass
            return self.repond(202, json.dumps(
                {"etat": "lance",
                 "detail": "GitHub Actions régénère les données, compte 2 à 3 minutes "
                           "puis recharge la page."}))
        if route == "/live":
            date = q.get("date", [""])[0]
            if not jour_valide(date):
                return self.repond(400, json.dumps(
                    {"error": "paramètre date attendu au format AAAA-MM-JJ", "recu": date}))
            try:
                req = urllib.request.Request(NHL + "score/" + date,
                                             headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    return self.repond(r.status, r.read())
            except urllib.error.HTTPError as exc:
                return self.repond(exc.code, json.dumps({"error": "API NHL", "code": exc.code}))
            except Exception as exc:                               # noqa: BLE001
                return self.repond(502, json.dumps({"error": str(exc)[:200]}))
        return self.repond(404, json.dumps({"error": "route inconnue", "path": route}))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print(f"[proxy stub] http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

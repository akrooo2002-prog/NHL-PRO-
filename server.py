"""
Serveur de l'app de pronostics NHL — bibliothèque standard uniquement.

  python3 server.py [port]     (défaut 8000, écoute sur 0.0.0.0)

Routes
  GET  /                      l'interface (app.html)
  GET  /app                   idem
  GET  /data/analyse.json     le résultat du moteur (mis en cache, rechargé
                              automatiquement après chaque rafraîchissement)
  GET  /api/health            état du serveur
  GET  /healthz               sonde de supervision (200 = vivant)
  GET  /api/live?date=AAAA-MM-JJ   scores en direct (proxy NHL, cache 20 s)
  GET  /api/refresh?lancer=1  relance la collecte (POST /api/refresh : pareil)
  GET  /api/refresh           état du rafraîchissement en cours

Hébergement : le serveur n'écoute qu'en HTTP. TLS et accès privé sont délégués
à Caddy (voir DEPLOY.md) ; NHL_BIND permet de n'écouter que sur une interface.
NHL_REFRESH_TOKEN ajoute un déclencheur à distance : GET /api/refresh?lancer=1&token=…

Le proxy /api/live existe parce que api-web.nhle.com n'autorise pas les
appels depuis un navigateur (CORS) : sans lui l'onglet Live serait vide.
"""
import datetime
import gzip
import hmac
import io
import secrets
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = {}
ZIP_CACHE = {}   # "dist.zip" -> (octets, horodatage des données) : archive du dossier Netlify
ZIP_LOCK = threading.Lock()
LIVE = {"at": 0.0, "date": None, "body": None}
LIVE_TTL = 20.0
REFRESH = {"running": False, "started": None, "ended": None, "ok": None, "log": []}
REFRESH_LOCK = threading.Lock()
NHL = "https://api-web.nhle.com/v1/score/"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


LOG_DIR = os.path.join(ROOT, "logs")
ACCESS = os.path.join(LOG_DIR, "access.log")
MAX_LOG = 5 * 1024 * 1024


def noter(msg):
    """Journal d'accès sur disque, avec rotation à 5 Mo (1 fichier .1)."""
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        if os.path.exists(ACCESS) and os.path.getsize(ACCESS) > MAX_LOG:
            if os.path.exists(ACCESS + ".1"):
                os.unlink(ACCESS + ".1")
            os.replace(ACCESS, ACCESS + ".1")
        with open(ACCESS, "a", encoding="utf-8") as fh:
            fh.write(msg + "\n")
    except OSError:
        pass


def load():
    p = os.path.join(ROOT, "data", "analyse.json")
    if os.path.exists(p):
        with open(p, "rb") as fh:
            CACHE["analyse.json"] = fh.read()
    return list(CACHE)


def jour_valide(date):
    """2026-13-99 respecte le motif mais n'est pas une date : on refuse ici
    plutôt que de renvoyer le 404 de l'API NHL."""
    try:
        datetime.date.fromisoformat(date)
        return True
    except ValueError:
        return False


def nhl_live(date):
    """Scores du jour. Renvoie (statut, octets JSON)."""
    req = urllib.request.Request(NHL + date, headers={"User-Agent": UA,
                                                      "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, r.read()


def run_refresh():
    """refresh.py, qui pose un verrou : deux collectes simultanées écraseraient
    data/pronos.json et feraient échouer engine.py en pleine lecture."""
    REFRESH["log"] = []
    try:
        p = subprocess.run([sys.executable, "refresh.py"], cwd=ROOT,
                           capture_output=True, text=True, timeout=1800)
        for ligne in (p.stdout or "").strip().splitlines():
            if ligne.strip():
                REFRESH["log"].append(ligne.strip())
        if p.returncode == 4:
            REFRESH["ok"] = None          # déjà en cours ailleurs : pas un échec
            REFRESH["log"].append("une collecte était déjà en cours (verrou)")
        elif p.returncode == 0:
            REFRESH["ok"] = True
        else:
            REFRESH["ok"] = False
            REFRESH["log"].append(f"refresh.py : code {p.returncode}")
            REFRESH["log"].append((p.stderr or "").strip()[-300:])
        # le cache n'est remplacé que si le fichier est réellement valide
        valide, nb = analyse_valide()
        if valide:
            load()
        else:
            REFRESH["log"].append(f"analyse.json refusée ({nb}) : ancien cache conservé")
    except Exception as exc:                                   # noqa: BLE001
        REFRESH["ok"] = False
        REFRESH["log"].append(f"erreur : {exc}")
    finally:
        REFRESH["running"] = False
        REFRESH["ended"] = time.strftime("%Y-%m-%dT%H:%M:%S")


def analyse_valide(min_matchs=20):
    p = os.path.join(ROOT, "data", "analyse.json")
    try:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        n = len(d.get("games", []))
        return n >= min_matchs, f"{n} matchs"
    except Exception as exc:                                   # noqa: BLE001
        return False, f"illisible : {exc}"


class Handler(BaseHTTPRequestHandler):
    server_version = "NHLPronos/2.0"

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            self.close_connection = True          # curl / onglet fermé en cours de lecture

    def log_message(self, fmt, *args):
        # l'onglet Live et le suivi de rafraîchissement sondent toutes les
        # quelques secondes : inutile de saturer le journal
        if "/api/refresh" in (fmt % args):
            return
        ligne = "%s %s" % (self.address_string(), fmt % args)
        sys.stderr.write(ligne + "\n")
        noter(ligne)

    def send(self, status, body, ctype="application/json; charset=utf-8", entetes=None):
        # 18 Mo de JSON : la compression divise par ~10 le poids sur mobile
        gz = ("gzip" in (self.headers.get("Accept-Encoding") or "")
              and len(body) > 1024 and ctype.startswith("application/json"))
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        if gz:
            body = gzip.compress(body, 6)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for nom, val in (entetes or []):
            if nom.lower() != "content-type":
                self.send_header(nom, val)
        if getattr(self, "cookie", None):
            self.send_header("Set-Cookie", self.cookie)
            self.cookie = None
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not self.acces_ok(parsed):
            return
        return self._post(parsed)

    def token_ok(self, query):
        """Si NHL_REFRESH_TOKEN est défini, le déclenchement à distance exige le
        jeton. Comparaison à temps constant : le jeton ne se devine pas."""
        attendu = os.environ.get("NHL_REFRESH_TOKEN", "")
        if not attendu:
            return True
        recu = urllib.parse.parse_qs(query).get("token", [""])[0]
        return hmac.compare_digest(recu, attendu)

    def lancer_refresh(self):
        """Démarre la collecte. GET ?lancer=1 et POST font exactement la même
        chose : certains proxys d'aperçu refusent POST."""
        with REFRESH_LOCK:
            if REFRESH["running"]:
                return self.send(202, json.dumps(
                    {"etat": "deja_en_cours", "started": REFRESH["started"]}).encode())
            REFRESH.update(running=True, ok=None, ended=None,
                           started=time.strftime("%Y-%m-%dT%H:%M:%S"))
        threading.Thread(target=run_refresh, daemon=True).start()
        return self.send(202, json.dumps({"etat": "lance", "started": REFRESH["started"]}).encode())

    def _post(self, parsed):
        route = parsed.path.rstrip("/") or "/"
        if route != "/api/refresh":
            return self.send(404, json.dumps({"error": "route inconnue"}).encode())
        return self.lancer_refresh()

    # ---- accès par URL privée : NHL_URL_TOKEN -------------------------------
    # Option « URL non publique sans Tailscale » : l'URL contient un jeton
    # (/app?k=…), qui pose un cookie. Toute autre requête non authentifiée
    # reçoit un 401 — données comprises. Laisse la variable vide si tu passes
    # par Tailscale ou Caddy : dans ce cas l'accès est déjà contrôlé ailleurs.
    def acces_ok(self, parsed):
        attendu = os.environ.get("NHL_URL_TOKEN", "")
        if not attendu:
            return True
        recu = urllib.parse.parse_qs(parsed.query).get("k", [""])[0]
        if hmac.compare_digest(recu, attendu):
            self.cookie = f"nhlpronos={secrets.token_urlsafe(24)}; Path=/; HttpOnly; SameSite=Lax"
            return True
        attendus = [f"nhlpronos={v}" for v in self.jetons_cookie()]
        if self.cookie and any(hmac.compare_digest(c, self.cookie) for c in attendus):
            return True
        self.send(401, b"", "text/plain; charset=utf-8",
                  entetes=[("WWW-Authenticate", "Bearer"),
                           ("Content-Type", "text/plain; charset=utf-8")])
        return False

    def jetons_cookie(self):
        brut = self.headers.get("Cookie") or ""
        for part in brut.split(";"):
            cle, _, val = part.strip().partition("=")
            if cle == "nhlpronos" and val:
                yield val

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        route = parsed.path.rstrip("/") or "/"
        if not self.acces_ok(parsed):
            return
        if route in ("/", "/index.html", "/app"):
            return self.file("app.html", "text/html; charset=utf-8")
        if route in ("/data/analyse.json", "/analyse.json"):
            blob = CACHE.get("analyse.json")
            if blob is None:
                return self.send(404, json.dumps(
                    {"error": "data/analyse.json absent — lancez engine.py"}).encode())
            return self.send(200, blob)
        if route in ("/api/health", "/healthz"):
            return self.send(200, json.dumps(
                {"ok": True, "loaded": list(CACHE),
                 "mo": round(len(CACHE.get("analyse.json", b"")) / 1048576, 2)}).encode())
        if route == "/api/refresh":
            if "lancer=1" in parsed.query:
                if not self.token_ok(parsed.query):
                    return self.send(403, json.dumps(
                        {"error": "jeton absent ou incorrect"}).encode())
                return self.lancer_refresh()
            return self.send(200, json.dumps(REFRESH).encode())
        if route == "/api/live":
            return self.live(urllib.parse.parse_qs(parsed.query).get("date", [""])[0])
        if route in ("/dist.zip", "/netlify.zip"):
            return self.zip_dist()
        return self.send(404, json.dumps({"error": "route inconnue", "path": route}).encode())

    def zip_dist(self):
        """Le dossier prêt pour Netlify Drop, en un seul fichier à télécharger.

        Utile depuis un téléphone : on récupère l'archive, on la dézippe, on la
        dépose sur app.netlify.com/drop. L'archive est régénérée dès que les
        données changent, jamais servie périmée.
        """
        try:
            marque = json.loads(CACHE["analyse.json"]).get("generatedUtc")
        except Exception:
            marque = None
        if marque is None:
            return self.send(409, json.dumps(
                {"error": "aucune analyse en mémoire — lancez d'abord une collecte"}).encode())
        with ZIP_LOCK:
            if ZIP_CACHE.get("marque") != marque or "octets" not in ZIP_CACHE:
                r = subprocess.run(
                    [sys.executable, os.path.join(ROOT, "build_static.py"),
                     os.path.join(ROOT, "dist")],
                    capture_output=True, text=True, timeout=600)
                if r.returncode != 0:
                    return self.send(500, json.dumps(
                        {"error": "build_static.py a échoué",
                         "detail": (r.stderr or r.stdout)[-400:]}).encode())
                src = os.path.join(ROOT, "dist")
                buf = io.BytesIO()
                n = 0
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                    for racine, _, fichiers in os.walk(src):
                        for nom in sorted(fichiers):
                            p = os.path.join(racine, nom)
                            z.write(p, "dist/" + os.path.relpath(p, src))
                            n += 1
                ZIP_CACHE["octets"] = buf.getvalue()
                ZIP_CACHE["marque"] = marque
                ZIP_CACHE["fichiers"] = n
            blob = ZIP_CACHE["octets"]
            return self.send(
                200, blob, "application/zip",
                [("Content-Disposition", 'attachment; filename="nhl-pronos-netlify.zip"'),
                 ("X-Fichiers", str(ZIP_CACHE.get("fichiers", 0)))])

    def live(self, date):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date or "") or not jour_valide(date):
            return self.send(400, json.dumps(
                {"error": "paramètre date attendu au format AAAA-MM-JJ",
                 "recu": date}).encode())
        if LIVE["date"] == date and time.time() - LIVE["at"] < LIVE_TTL and LIVE["body"]:
            return self.send(200, LIVE["body"])
        try:
            status, body = nhl_live(date)
        except urllib.error.HTTPError as exc:
            return self.send(exc.code, json.dumps(
                {"error": "l'API NHL a refusé", "code": exc.code}).encode())
        except Exception as exc:                                # noqa: BLE001
            return self.send(502, json.dumps({"error": str(exc)[:200]}).encode())
        if status == 200:
            LIVE.update(at=time.time(), date=date, body=body)
        return self.send(status, body)

    def file(self, name, ctype):
        p = os.path.join(ROOT, name)
        if not os.path.exists(p):
            return self.send(404, f"<!doctype html><p>404 — {name} absent</p>".encode())
        with open(p, "rb") as fh:
            return self.send(200, fh.read(), ctype)


def main(argv):
    if "--selftest" in argv:
        return selftest(argv)
    port = int(next((a for a in argv if a.isdigit()), 8000))
    bind = os.environ.get("NHL_BIND", "0.0.0.0")
    got = load()
    print(f"[NHL Pronos] chargé : {got or 'RIEN (lancez fetch_pronos.py puis engine.py)'}", flush=True)
    srv = ThreadingHTTPServer((bind, port), Handler)
    print(f"[NHL Pronos] http://{bind}:{srv.server_address[1]}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[NHL Pronos] arrêt")


def selftest(argv=()):
    """Démarre le serveur sur un port éphémère et l'attaque pour de vrai.
    Sert à valider un déploiement sans dépendre d'un reverse proxy.
    --skip-refresh évite la collecte complète (~90 s + accès Internet)."""
    saut = "--skip-refresh" in argv
    load()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    echecs = []

    def req(url, meth="GET", en_tete=None, gzip_attendu=False):
        r = urllib.request.Request(base + url, method=meth, headers=en_tete or {})
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.status, resp.read(), dict(resp.headers)
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read(), dict(exc.headers)
        except Exception as exc:                                # noqa: BLE001
            return 0, str(exc).encode(), {}

    def teste(label, cond, detail=""):
        print(("  OK    " if cond else "  ECHEC ") + label + (f"  {detail}" if detail else ""))
        if not cond:
            echecs.append(label)

    print(f"[NHL Pronos] autotest sur {base}")
    st, b, _ = req("/app")
    teste("GET /app", st == 200 and b.startswith(b"<!doctype html>"), f"{st}, {len(b)} o")
    st, b, _ = req("/healthz")
    teste("GET /healthz", st == 200 and json.loads(b)["ok"] is True, f"{st} {b[:60].decode()}")
    st, b, h = req("/data/analyse.json", en_tete={"Accept-Encoding": "gzip"})
    teste("GET /data/analyse.json (gzip)",
          st == 200 and h.get("Content-Encoding") == "gzip" and len(gzip.decompress(b)) > 1000,
          f"{st}, {len(b)} o transmis")
    st, b, _ = req("/data/analyse.json")
    teste("GET /data/analyse.json (brut)", st == 200 and json.loads(b)["games"], f"{st}")
    st, b, h = req("/dist.zip")
    try:
        noms = zipfile.ZipFile(io.BytesIO(b)).namelist()
    except Exception as exc:                                # noqa: BLE001
        noms = []
        print(f"  INFO  archive illisible : {exc}")
    teste("GET /dist.zip livre le dossier Netlify",
          st == 200 and "dist/app.html" in noms and "dist/data/analyse.json" in noms,
          f"{st}, {len(b) // 1024} Ko, {len(noms)} fichiers, "
          f"{h.get('Content-Disposition', '')}")
    st, b, _ = req("/api/live?date=2026-13-99")
    teste("GET /api/live date absurde -> 400", st == 400, f"{st}")
    st, b, _ = req("/api/live?date=" + time.strftime("%Y-%m-%d"))
    teste("GET /api/live date du jour", st in (200, 404, 502), f"{st}")
    st, b, _ = req("/api/refresh?lancer=1&token=faux")
    if os.environ.get("NHL_REFRESH_TOKEN"):
        teste("jeton exigé quand NHL_REFRESH_TOKEN est défini", st == 403, f"{st}")
    elif saut:
        teste("déclenchement libre sans jeton configuré", st == 202, f"{st}")
        print("  INFO  collecte non attendue (--skip-refresh)")
    else:
        teste("déclenchement libre sans jeton configuré", st == 202, f"{st}")
        for _ in range(400):
            time.sleep(3)
            st, b, _ = req("/api/refresh")
            if st == 200 and not json.loads(b)["running"]:
                break
        teste("collecte lancée par l'autotest aboutit",
              st == 200 and json.loads(b)["ok"] is True, f"{st}")
    if not saut:
        # on remet le serveur dans l'état attendu si l'autotest a lancé une collecte
        pass
    st, b, _ = req("/rien/du/tout")
    teste("route inconnue -> 404 JSON", st == 404 and b"error" in b, f"{st}")
    st, b, _ = req("/", meth="HEAD")
    teste("HEAD /", st == 200, f"{st}")
    srv.shutdown()
    print("[NHL Pronos] autotest : " + ("TOUT EST OK" if not echecs
                                         else f"{len(echecs)} ECHEC(S) : " + ", ".join(echecs)))
    return 1 if echecs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

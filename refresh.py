#!/usr/bin/env python3
"""
Rafraîchissement planifié : collecte des stats puis moteur d'analyse.

  python3 refresh.py            # collecte + analyse (verrouillé, journalisé)

Conçu pour cron ou systemd-timer. Deux protections :
  · un verrou fichier : si la collecte précédente tourne encore, on sort sans
    rien casser (deux collectes simultanées écraseraient data/pronos.json) ;
  · l'analyse précédente n'est remplacée que si la nouvelle est complète,
    sinon on garde l'ancienne et on le dit dans le journal.

Sortie : data/analyse.json + logs/refresh.log
Code retour : 0 succès, 2 collecte échouée, 3 moteur échoué, 4 déjà en cours,
              5 données refusées.
"""
import errno
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
LOCK = os.path.join(ROOT, ".refresh.lock")
LOG_DIR = os.path.join(ROOT, "logs")
LOG = os.path.join(LOG_DIR, "refresh.log")
MIN_MATCHS = 20            # en dessous, la collecte est jugée ratée
MIN_ANALYSES = 500


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def verrou():
    """Ouvre le verrou sans bloquer. Renvoie le descripteur, ou None."""
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        os.write(fd, f"{os.getpid()}\n".encode())
        return fd
    except OSError as exc:
        if exc.errno == errno.EEXIST:
            return None
        raise


def charger():
    import json
    p = os.path.join(ROOT, "data", "analyse.json")
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
    except ValueError:
        return None
    return {"matchs": len(d.get("games", [])),
            "analyses": sum(len(g.get("players", [])) for g in d.get("games", [])),
            "date": d.get("generatedUtc")}


def etape(script, code_echec):
    t0 = time.time()
    p = subprocess.run([sys.executable, script], cwd=ROOT,
                       capture_output=True, text=True, timeout=1800)
    duree = time.time() - t0
    queue = [x for x in (p.stdout or "").strip().splitlines() if x.strip()]
    log(f"{script} : exit {p.returncode} en {duree:.0f} s — {queue[-1] if queue else 'aucune sortie'}")
    if p.returncode != 0:
        log(f"  stderr : {(p.stderr or '').strip()[-400:]}")
        return code_echec
    return 0


def main():
    fd = verrou()
    if fd is None:
        # verrou abandonné par un processus tué ? on le reprend au bout de 40 min
        try:
            ancien = time.time() - os.path.getmtime(LOCK)
        except OSError:
            ancien = 0
        if ancien < 2400:
            log(f"déjà en cours (verrou posé il y a {ancien / 60:.0f} min) — sortie sans rien faire")
            return 4
        log(f"verrou périmé ({ancien / 60:.0f} min) — repris")
        try:
            os.unlink(LOCK)
        except OSError:
            pass
        fd = verrou()
        if fd is None:
            return 4
    avant = charger()
    try:
        log(f"début — analyse en place : {avant or 'aucune'}")
        rc = etape("fetch_pronos.py", 2) or etape("engine.py", 3)
        if rc:
            log(f"échec à l'étape {rc} : l'analyse précédente est conservée")
            return rc
        apres = charger()
        if not apres or apres["matchs"] < MIN_MATCHS or apres["analyses"] < MIN_ANALYSES:
            log(f"données refusées ({apres}) : trop peu de matchs ou d'analyses, "
                f"seuils {MIN_MATCHS}/{MIN_ANALYSES}")
            return 5
        log(f"terminé — {apres['matchs']} matchs, {apres['analyses']} analyses, {apres['date']}")
        return 0
    finally:
        os.close(fd)
        try:
            os.unlink(LOCK)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Construit le dossier statique à déposer sur Netlify Drop (ou n'importe quel
hébergement statique gratuit).

  python3 build_static.py [dossier-sortie]      (défaut : dist)

Trois niveaux de données, parce qu'un seul JSON de 18 Mo est inutilisable
sur mobile en 4G :

  data/index.json        calendrier, contexte, gardiens — SANS les joueurs
                         (~40 Ko compressé). Chargé au démarrage.
  data/jour-<date>.json  les 6 premiers de chaque marché pour chaque match du
                         jour (~30-80 Ko). Chargé quand on ouvre un jour.
  data/match-<id>.json   la fiche complète d'un match : tous les joueurs et les
                         justifications détaillées. Chargée à la demande par
                         l'onglet Analyse (~20-50 Ko par match).

Copie aussi app.html, le manifeste, le service worker, les icônes et les
en-têtes Netlify. Le dossier obtenu se dépose tel quel sur
https://app.netlify.com/drop

Code retour : 0 succès, 1 données manquantes ou incohérentes.
"""
import json
import os
import shutil
import sys

MKS = ("buteur", "passeur", "pointeur")
TOP_JOUR = 6                   # joueurs par marché dans les fichiers jour
TOP_FICHE = 10                 # justifications détaillées dans la fiche match
TOP = TOP_FICHE                # compat (tests)
RACINE = os.path.dirname(os.path.abspath(__file__))


def raccourcir(why, morceaux=2):
    parts = [p.strip() for p in str(why).split(" · ")]
    out = " · ".join(parts[:morceaux])
    return out + " · …" if len(parts) > morceaux else out


def version_index(joueur):
    """Le joueur tel qu'il apparaît dans l'index : tout ce qu'il faut pour
    classer et afficher, sans le détail lourd."""
    p = {k: v for k, v in joueur.items() if k not in MKS and k != "recrue"}
    for mk in MKS:
        m = joueur[mk]
        p[mk] = {"score": m["score"], "prob": m["prob"], "confidence": m["confidence"],
                 "palier": m["palier"], "etoiles": m["etoiles"], "rank": m["rank"],
                 "lam": m["lam"],
                 "why": m["why"] if m["rank"] and m["rank"] <= 3 else raccourcir(m["why"])}
    if "recrue" in joueur:
        rc = joueur["recrue"]
        p["recrue"] = {k: rc[k] for k in ("ligue", "ligueFr", "confidence") if k in rc}
    return p


def main(argv):
    out = argv[0] if argv else os.path.join(RACINE, "dist")
    src = os.path.join(RACINE, "data", "analyse.json")
    if not os.path.exists(src):
        print("data/analyse.json absent : lance d'abord fetch_pronos.py puis engine.py")
        return 1
    with open(src, encoding="utf-8") as fh:
        d = json.load(fh)

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "data"), exist_ok=True)

    index = {k: v for k, v in d.items() if k != "games"}
    index["statique"] = True
    index["top"] = TOP_JOUR
    index["analyses"] = sum(len(g["players"]) for g in d["games"])
    index["games"] = [{k: v for k, v in g.items() if k != "players"} for g in d["games"]]

    jours = {}
    for g in d["games"]:
        gardes = set()
        for mk in MKS:
            classes = [x for x in g["players"] if x[mk]["rank"]]
            classes.sort(key=lambda x: x[mk]["rank"])
            gardes.update(x["id"] for x in classes[:TOP_JOUR])

        # fiche complète, avec justifications détaillées pour le top 10
        fiche = dict(g)
        fiche["players"] = []
        for x in g["players"]:
            y = dict(x)
            for mk in MKS:
                m = dict(x[mk])
                if not (m["rank"] and m["rank"] <= TOP_FICHE):
                    m["why"] = raccourcir(m["why"])
                y[mk] = m
            fiche["players"].append(y)
        with open(os.path.join(out, "data", f"match-{g['id']}.json"), "w",
                  encoding="utf-8") as fh:
            json.dump(fiche, fh, separators=(",", ":"), ensure_ascii=False)

        jours.setdefault(g["date"], []).append(
            {"id": g["id"], "effectif": len(g["players"]),
             "players": [version_index(x) for x in g["players"] if x["id"] in gardes]})

    with open(os.path.join(out, "data", "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"), ensure_ascii=False)
    for date, jeux in jours.items():
        with open(os.path.join(out, "data", f"jour-{date}.json"), "w",
                  encoding="utf-8") as fh:
            json.dump({"date": date, "games": jeux}, fh, separators=(",", ":"),
                      ensure_ascii=False)

    for nom in ("app.html", "manifest.webmanifest", "sw.js", "_headers", "config.json"):
        srcf = os.path.join(RACINE, nom)
        if not os.path.exists(srcf):
            print(f"avertissement : {nom} absent du projet")
            continue
        shutil.copy2(srcf, os.path.join(out, nom))
    # le moteur est livré avec le site : l'analyse instantanée l'exécute dans
    # le navigateur (Pyodide) — exactement le même code que le serveur
    shutil.copy2(os.path.join(RACINE, "engine.py"),
                 os.path.join(out, "data", "engine.py"))
    # Netlify sert index.html à la racine : on renvoie vers l'app
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as fh:
        fh.write('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
                 '<title>NHL Pronos</title>'
                 '<meta http-equiv="refresh" content="0; url=app.html">'
                 '<link rel="manifest" href="manifest.webmanifest">'
                 '</head><body style="background:#0a0c10;color:#e8edf4;'
                 'font:15px system-ui,sans-serif;padding:24px">'
                 'Chargement… <a href="app.html" style="color:#4da3ff">'
                 'Ouvrir NHL Pronos</a></body></html>\n')
    ico = os.path.join(RACINE, "icons")
    if os.path.isdir(ico):
        shutil.copytree(ico, os.path.join(out, "icons"))
    # fonctions Netlify (Live + Rafraîchir sans compte Cloudflare)
    nf = os.path.join(RACINE, "netlify")
    if os.path.isdir(nf):
        shutil.copytree(nf, os.path.join(out, "netlify"))
    nft = os.path.join(RACINE, "netlify.toml")
    if os.path.exists(nft):
        shutil.copy2(nft, os.path.join(out, "netlify.toml"))

    brut = os.path.getsize(os.path.join(out, "data", "index.json"))
    nj = len([f for f in os.listdir(os.path.join(out, "data")) if f.startswith("jour-")])
    fiches = [f for f in os.listdir(os.path.join(out, "data")) if f.startswith("match-")]
    plus_grosse = max(os.path.getsize(os.path.join(out, "data", f)) for f in fiches)
    print(f"{out} : index {brut // 1024} Ko, {nj} fichiers jour, {len(fiches)} fiches "
          f"match (max {plus_grosse // 1024} Ko), {len(index['games'])} matchs")
    print("à déposer sur https://app.netlify.com/drop")
    return 0

    ico = os.path.join(RACINE, "icons")
    if os.path.isdir(ico):
        shutil.copytree(ico, os.path.join(out, "icons"))
    # fonctions Netlify (Live + Rafraîchir sans compte Cloudflare)
    nf = os.path.join(RACINE, "netlify")
    if os.path.isdir(nf):
        shutil.copytree(nf, os.path.join(out, "netlify"))
    nft = os.path.join(RACINE, "netlify.toml")
    if os.path.exists(nft):
        shutil.copy2(nft, os.path.join(out, "netlify.toml"))




if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

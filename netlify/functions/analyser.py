# Analyse instantanée d'UN match : collecte NHL ciblée (2 équipes) + moteur.
# GET /analyser?game=<id>&date=AAAA-MM-JJ  →  {ok, fiche} (même format que le site)
# Budget : 10 s (plan gratuit Netlify) — la collecte ciblée prend ~4-6 s.
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine          # noqa: E402  (copie synchronisée à chaque déploiement)
import fetch_pronos as fp  # noqa: E402

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
}


def _json(code, obj):
    return {"statusCode": code, "headers": CORS,
            "body": json.dumps(obj, ensure_ascii=False)}


def handler(event, context):
    qs = event.get("queryStringParameters") or {}
    try:
        gid = int(qs.get("game") or 0)
    except ValueError:
        gid = 0
    date = (qs.get("date") or "").strip()
    if not gid or len(date) != 10 or date[4] != "-":
        return _json(400, {"erreur": "usage : /analyser?game=<id>&date=AAAA-MM-JJ"})
    try:
        t0 = time.time()
        game = fp.fetch_game_par_id(date, gid)
        if not game:
            return _json(404, {"erreur": "match introuvable à cette date"})
        raw = fp.collecte_un_match(game)
        out = engine.run(raw)
        games = out.get("games") or []
        if not games:
            return _json(500, {"erreur": "aucune analyse produite"})
        fiche = games[0]
        fiche["instant"] = {"generatedUtc": raw["generatedUtc"],
                            "dureeS": round(time.time() - t0, 1)}
        return _json(200, {"ok": True, "fiche": fiche})
    except Exception as exc:  # filet : jamais de 500 brut
        return _json(500, {"erreur": f"analyse impossible : {exc}"})

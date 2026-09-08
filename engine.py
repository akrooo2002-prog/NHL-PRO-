"""
Moteur d'analyse NHL — transforme data/pronos.json en data/analyse.json.

Logique (dans l'ordre) :
  1. taux par match : buts, passes, tirs, séparés 5 contre 5 / avantage numérique
  2. efficacité de tir RÉGRESSÉE vers la moyenne des 5 dernières saisons + la ligue
     -> détecte un % de tir intenable (risque) ou une réussite froide (opportunité)
  3. ajustements adverses : gardien (ARR % vs ligue, en part des tirs qui passent),
      défense (BP/match, tirs concédés), désavantage numérique adverse
  4. forme des 5 derniers matchs + absence + back-to-back
  5. buts / passes / points ATTENDUS par match, puis probabilité par loi de Poisson
  6. score, indice de confiance à 5 paliers, justification chiffrée courte

Usage:  python3 engine.py
"""
import json
import math
import os
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
MIN_GP = 3
PALIERS = [(88, 5), (75, 4), (62, 3), (50, 2), (0, 1)]
UNITE = {"buteur": ("g", "buts"), "passeur": ("a", "passes"), "pointeur": ("pts", "points")}

# franchiseName (API stats) -> abréviation
FR2ABBR = {
    "Anaheim Ducks": "ANA", "Boston Bruins": "BOS", "Buffalo Sabres": "BUF",
    "Calgary Flames": "CGY", "Carolina Hurricanes": "CAR", "Chicago Blackhawks": "CHI",
    "Colorado Avalanche": "COL", "Columbus Blue Jackets": "CBJ", "Dallas Stars": "DAL",
    "Detroit Red Wings": "DET", "Edmonton Oilers": "EDM", "Florida Panthers": "FLA",
    "Los Angeles Kings": "LAK", "Minnesota Wild": "MIN", "Montréal Canadiens": "MTL",
    "Nashville Predators": "NSH", "New Jersey Devils": "NJD", "New York Islanders": "NYI",
    "New York Rangers": "NYR", "Ottawa Senators": "OTT", "Philadelphia Flyers": "PHI",
    "Pittsburgh Penguins": "PIT", "San Jose Sharks": "SJS", "Seattle Kraken": "SEA",
    "St. Louis Blues": "STL", "Tampa Bay Lightning": "TBL", "Toronto Maple Leafs": "TOR",
    "Utah Mammoth": "UTA", "Vancouver Canucks": "VAN", "Vegas Golden Knights": "VGK",
    "Washington Capitals": "WSH", "Winnipeg Jets": "WPG",
}


def toi_sec(s):
    """Accepte les secondes (float, format API stats) et les chaînes "MM:SS" (game-log)."""
    if s is None or s == "":
        return 0
    if isinstance(s, (int, float)):
        return float(s)
    p = str(s).split(":")
    try:
        if len(p) == 2:
            return int(p[0]) * 60 + int(p[1])
        if len(p) == 3:
            return int(p[0]) * 3600 + int(p[1]) * 60 + int(p[2])
    except ValueError:
        return 0
    return 0


def js_round(x, nd=1):
    """Arrondi demi-supérieur, identique à Math.round(x*10)/10 en JavaScript.
    Le round() de Python arrondit au pair et ferait diverger les égalités de score."""
    f = 10 ** nd
    return math.floor(x * f + 0.5) / f


def clamp(x, lo=0.5, hi=1.6):
    return max(lo, min(hi, x))


def palier(c):
    for seuil, n in PALIERS:
        if c >= seuil:
            return n
    return 1


def etoiles(n):
    return "★" * n + "☆" * (5 - n)


def f1(x):
    return "—" if x is None else f"{x:.1f}".replace(".", ",")


def f2(x):
    return "—" if x is None else f"{x:.2f}".replace(".", ",")


def dfr(x, nd=1):
    """Nombre décimal à la française, sans le point final d'une phrase."""
    return f"{x:.{nd}f}".replace(".", ",")


def pc(x, d=1):
    return "—" if x is None else f"{x*100:.{d}f}".replace(".", ",") + " %"


def milestone(cur, step, span):
    """Proximité d'un palier rond : 1.0 quand il manque 1 unité, 0 au-delà de span."""
    if not cur or cur <= 0:
        return 0.0, None, None
    nxt = (int(cur) // step + 1) * step
    gap = nxt - cur
    if 0 < gap <= span:
        return max(0.0, 1.0 - (gap - 1) / span), nxt, gap
    return 0.0, nxt, gap


def confidence(prob, gp, flags, preseason):
    """Indice 0-100 : 80 % la probabilité réelle du marché, 20 % la fiabilité des données.
    Barème 100 × P^0.55, seuils 88/75/62/50, ce qui donne des paliers lisibles :
      palier 5 = 75 % de chance et plus   |  palier 4 = 55 à 75 %
      palier 3 = 38 à 55 %                |  palier 2 = 22 à 38 %
      palier 1 = moins de 22 %
    Les malus de données (absence, échantillon, back-to-back, présaison) peuvent
    faire descendre d'un palier : c'est voulu."""
    c_rank = 100 * (max(0.0, min(1.0, prob)) ** 0.55)
    c_data = 100.0
    if gp < 20:
        c_data = 42 + 58 * (gp / 20)
    elif gp < 45:
        c_data = 82 + 18 * ((gp - 20) / 25)
    if "absent" in flags:
        c_data *= 0.30
    elif "hors_echantillon" in flags:
        c_data *= 0.90
    if "echantillon" in flags:
        c_data *= 0.88
    if "b2b" in flags:
        c_data *= 0.93
    if preseason:
        c_data *= 0.80
    return 0.80 * c_rank + 0.20 * c_data


def main():
    with open(os.path.join(DATA, "pronos.json"), encoding="utf-8") as fh:
        raw = json.load(fh)

    ref = raw["refSeason"]
    cur_season = raw["currentSeason"]
    seasons = sorted(raw["skaters"].keys())
    tindex = raw.get("teamIndex", {})

    # ---------- saison active : la courante dès qu'elle a démarré ----------
    cur_games = sum(r.get("gamesPlayed", 0) for r in raw["teamStats"].get(cur_season, [])) // 2
    cur_started = cur_games > 0
    active = cur_season if cur_started else ref

    # ---------- repères de ligue (saison de référence) ----------
    pool = [r for r in raw["skaters"].get(ref, []) if r.get("gamesPlayed", 0) >= 20]
    lg_sh_pct = (sum(r.get("goals", 0) for r in pool) /
                 max(1, sum(r.get("shots", 0) for r in pool)))
    ts = raw["teamStats"].get(ref, [])
    ga_avg = sum(r.get("goalsAgainstPerGame", 0) for r in ts) / max(1, len(ts))
    sa_avg = sum(r.get("shotsAgainstPerGame", 0) for r in ts) / max(1, len(ts))
    gf_avg = sum(r.get("goalsForPerGame", 0) for r in ts) / max(1, len(ts))
    pk_avg = sum(r.get("penaltyKillPct", 0) for r in ts) / max(1, len(ts))

    gsv = [r.get("savePct") for r in raw["goalies"].get(ref, [])
           if r.get("gamesPlayed", 0) >= 15 and r.get("savePct")]
    sv_avg = sum(gsv) / len(gsv) if gsv else 0.900

    # ---------- stats d'équipe par abréviation ----------
    team_by_abbr = {FR2ABBR[r["franchiseName"]]: r
                    for r in ts if r.get("franchiseName") in FR2ABBR}

    # ---------- carrière 5 saisons (base de la régression du % de tir) ----------
    career = {}
    for s in seasons:
        for r in raw["skaters"].get(s, []):
            c = career.setdefault(r["playerId"], {"g": 0, "sh": 0, "gp": 0})
            c["g"] += r.get("goals", 0)
            c["sh"] += r.get("shots", 0)
            c["gp"] += r.get("gamesPlayed", 0)
    for c in career.values():
        c["shPct"] = (c["g"] / c["sh"]) if c["sh"] else None

    # ---------- gardien partant probable ----------
    goalies_ref = {r["playerId"]: r for r in raw["goalies"].get(ref, [])}

    def goalie_of(abbr):
        rec = raw["recentStarters"].get(abbr) or []
        if rec:
            counts = {}
            for x in rec:
                counts[x["playerId"]] = counts.get(x["playerId"], 0) + 1
            pid = max(counts, key=lambda k: (counts[k], k))
            st = goalies_ref.get(pid, {})
            return {"name": next((x["name"] for x in rec if x["playerId"] == pid), None),
                    "playerId": pid, "sv": st.get("savePct"),
                    "gaa": st.get("goalsAgainstAverage"), "gp": st.get("gamesPlayed"),
                    "starts": counts[pid], "ofLast": len(rec),
                    "lastGame": rec[0].get("date"), "lastSv": rec[0].get("savePctg"),
                    "estimated": True}
        best = None
        for gg in raw["goalies"].get(ref, []):
            if abbr in str(gg.get("teamAbbrevs", "")):
                if best is None or gg.get("gamesPlayed", 0) > best.get("gamesPlayed", 0):
                    best = gg
        if best:
            return {"name": best.get("goalieFullName"), "playerId": best.get("playerId"),
                    "sv": best.get("savePct"), "gaa": best.get("goalsAgainstAverage"),
                    "gp": best.get("gamesPlayed"), "starts": None, "ofLast": None,
                    "lastGame": None, "lastSv": None, "estimated": True}
        return None

    goalies = {a: goalie_of(a) for a in raw["teams"]}

    # tous les gardiens de chaque effectif, avec leurs stats de la saison de référence
    goalie_list = {}
    for abbr, ros in raw["rosters"].items():
        lst = []
        for gg in ros.get("goalies", []):
            st = goalies_ref.get(gg["id"], {})
            lst.append({
                "playerId": gg["id"],
                "name": f"{(gg.get('firstName') or {}).get('default', '')} "
                        f"{(gg.get('lastName') or {}).get('default', '')}".strip(),
                "sv": st.get("savePct"), "gaa": st.get("goalsAgainstAverage"),
                "gp": st.get("gamesPlayed", 0),
            })
        lst.sort(key=lambda x: -(x["gp"] or 0))
        goalie_list[abbr] = lst

    # ---------- back-to-back : qui joue la veille ----------
    play_dates = {}
    for g in raw["games"]:
        for a in (g["away"], g["home"]):
            play_dates.setdefault(a, set()).add(g["date"])

    sk_by_season = {s: {r["playerId"]: r for r in raw["skaters"].get(s, [])} for s in seasons}
    logs = raw["gameLogs"]
    bios = raw.get("bios", {})
    rookies = raw.get("rookies", {})

    games_out = []
    for g in raw["games"]:
        preseason = g["gameType"] != 2
        yest = (date.fromisoformat(g["date"]) - timedelta(days=1)).isoformat()

        ctx = {}
        for side, abbr in (("away", g["away"]), ("home", g["home"])):
            opp = g["home"] if side == "away" else g["away"]
            st_opp = team_by_abbr.get(opp, {})
            gg = goalies.get(opp)
            sv = (gg or {}).get("sv")
            # part des tirs que le gardien adverse laisse passer, relative à la ligue
            goalie_f = clamp((1 - sv) / (1 - sv_avg), 0.5, 1.8) if sv else 1.0
            ctx[side] = {
                "abbr": abbr, "opp": opp,
                "nameFr": (tindex.get(abbr) or {}).get("nameFr") or abbr,
                "oppNameFr": (tindex.get(opp) or {}).get("nameFr") or opp,
                "oppGa": st_opp.get("goalsAgainstPerGame"),
                "oppSa": st_opp.get("shotsAgainstPerGame"),
                "defF": clamp(st_opp.get("goalsAgainstPerGame", ga_avg) / ga_avg, 0.7, 1.5),
                "shotsAggF": clamp(st_opp.get("shotsAgainstPerGame", sa_avg) / sa_avg, 0.7, 1.5),
                "offF": clamp(gf_avg / max(0.5, st_opp.get("goalsForPerGame", gf_avg)), 0.7, 1.4),
                "pkF": clamp(pk_avg / max(50.0, st_opp.get("penaltyKillPct") or pk_avg), 0.85, 1.25),
                "pkPct": st_opp.get("penaltyKillPct"), "ppPct": st_opp.get("powerPlayPct"),
                "goalieF": goalie_f, "goalie": gg,
                "b2b": yest in play_dates.get(abbr, set()),
            }

        players = []
        for side in ("away", "home"):
            ab = ctx[side]["abbr"]
            ros = raw["rosters"].get(ab, {})
            for grp in ("forwards", "defensemen"):
                for p in ros.get(grp, []):
                    rec = player_record(p, ctx[side], sk_by_season, logs.get(str(p["id"]), []),
                                        active, ref, career, lg_sh_pct, bios, rookies, preseason)
                    if rec:
                        players.append(rec)

        for mk in ("buteur", "passeur", "pointeur"):
            # 1er temps : indice de confiance. λ = 0 (aucun but ni passe de toute la
            # saison) -> non classé, comme côté client.
            for p in players:
                if p.get("recrue"):
                    pass                      # indice déjà fixé et plafonné par rookie_record
                elif p[mk]["score"] > 0:
                    p[mk]["confidence"] = js_round(
                        confidence(p[mk]["prob"], p["gp"], p["flags"], preseason), 1)
                    p[mk]["palier"] = palier(p[mk]["confidence"])
                else:
                    p[mk]["confidence"] = 0.0
                    p[mk]["palier"] = 1
                p[mk]["etoiles"] = etoiles(p[mk]["palier"])
            # 2e temps : le rang suit la confiance affichée, puis le score AFFICHÉ (arrondi),
            # puis le nom — exactement le même départage que le recalcul côté client.
            ranked = sorted((p for p in players if p[mk]["score"] > 0),
                            key=lambda p: (-p[mk]["confidence"], -p[mk]["score"], p["name"]))
            for i, p in enumerate(ranked):
                p[mk]["rank"] = i + 1

        games_out.append({
            "id": g["id"], "date": g["date"], "startUtc": g["startUtc"],
            "gameType": g["gameType"], "preseason": preseason,
            "away": g["away"], "home": g["home"],
            "awayNameFr": ctx["away"]["nameFr"], "homeNameFr": ctx["home"]["nameFr"],
            "venue": g.get("venue"), "ctx": ctx, "players": players,
        })

    out = {
        "generatedUtc": raw["generatedUtc"],
        "refSeason": ref, "activeSeason": active, "currentSeasonStarted": cur_started,
        "league": {"savePctAvg": round(sv_avg, 4), "shootingPctAvg": round(lg_sh_pct, 4),
                   "gaPerGame": round(ga_avg, 2), "shotsAgainst": round(sa_avg, 1),
                   "gfPerGame": round(gf_avg, 2), "pkPctAvg": round(pk_avg, 2)},
        "teams": tindex, "goalies": goalies, "goalieList": goalie_list,
        "games": games_out, "paliers": PALIERS,
    }
    path = os.path.join(DATA, "analyse.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    print(f"data/analyse.json ({round(os.path.getsize(path)/1024/1024, 2)} Mo) — "
          f"{len(games_out)} matchs, {sum(len(g['players']) for g in games_out)} analyses joueur")
    return out


RECENT_SEUIL = 20222023   # on ignore les saisons plus anciennes que 4 ans

LEAGUE_CONV = {
    "AHL": ("AHL", 0.40, 0.30, "American League"),
    "SHL": ("SHL", 0.42, 0.34, "1re div. suédoise"),
    "Liiga": ("Liiga", 0.42, 0.34, "1re div. finlandaise"),
    "KHL": ("KHL", 0.55, 0.46, "KHL"),
    "NL": ("NL", 0.55, 0.46, "1re div. suisse"),
    "CZE": ("CZE", 0.45, 0.35, "1re div. tchèque"),
    "NLB": ("NLB", 0.40, 0.30, "2e div. suisse"),
    "ALL": ("ALL", 0.40, 0.30, "1re div. allemande"),
    "ECHL": ("ECHL", 0.18, 0.13, "ECHL"),
    "OHL": ("OHL", 0.20, 0.15, "junior OHL"),
    "WHL": ("WHL", 0.20, 0.15, "junior WHL"),
    "QMJHL": ("QMJHL", 0.20, 0.15, "junior LHJMQ"),
    "USHL": ("USHL", 0.18, 0.13, "junior USHL"),
    "NCAA": ("NCAA", 0.35, 0.26, "université US"),
    "Slovakia": ("Slovakia", 0.35, 0.26, "1re div. slovaque"),
    "Slovakia2": ("Slovakia2", 0.22, 0.16, "2e div. slovaque"),
    "Austria": ("Austria", 0.35, 0.26, "1re div. autrichienne"),
    "Russia": ("Russia", 0.35, 0.26, "ligue russe"),
    "Russia2": ("Russia2", 0.22, 0.16, "2e div. russe"),
}


def rookie_record(p, ctx, land, bio, lg_sh_pct, preseason):
    """Joueur sans référence NHL (recrue / rappelé) : projection depuis sa
    dernière saison en ligue mineure, avec un facteur de conversion."""
    seuil = RECENT_SEUIL
    seasons = [x for x in (land or {}).get("seasons", [])
               if x.get("league") in LEAGUE_CONV and (x.get("season") or 0) >= seuil]
    seasons.sort(key=lambda x: (x.get("season") or 0), reverse=True)
    last = seasons[0] if seasons else None
    lg, conv_g, conv_a, lg_fr = LEAGUE_CONV.get((last or {}).get("league"),
                                                ("?", 0.25, 0.20, "ligue mineure"))
    pos = p.get("positionCode")
    name = f"{(p.get('firstName') or {}).get('default', '')} " \
           f"{(p.get('lastName') or {}).get('default', '')}".strip()

    # temps de glace attendu : rôle probable en NHL, pas la moyenne de ligue
    draft_year = bio.get("draftYear") or 2024
    if pos == "C" and draft_year <= 2024:
        toi = 16.0
    elif pos == "C":
        toi = 12.0
    elif pos == "LW":
        toi = 12.0
    elif pos == "RW":
        toi = 11.0
    else:
        toi = 15.0
    mult = 1.0 if (bio.get("gamesPlayed") or 0) == 0 else 0.9

    if last and (last.get("gp") or 0) >= 3:
        gp = last["gp"]
        ppg = last["pts"] / gp
        g_pg = last["g"] / gp
        a_pg = last["a"] / gp
        base = f"{last['pts']:.0f} points en {gp} matchs en {last['league']}"
    else:
        ppg = 0.55 if draft_year <= 2024 else 0.40
        g_pg = ppg * 0.42
        a_pg = ppg - g_pg
        base = (f"repêché au {bio.get('draftRound')}e tour en {draft_year}"
                if bio.get("draftYear") else "aucune statistique publique")

    conv = 0.55 * conv_g + 0.45 * conv_a
    ppg_nhl = ppg * conv * mult
    gpg_nhl = g_pg * conv_g * mult
    apg_nhl = a_pg * conv_a * mult
    shpg = 1.9 if draft_year <= 2024 else 1.4
    sh_pct = 0.085
    exp_sh = 0.5 * sh_pct + 0.5 * lg_sh_pct

    lam_g = gpg_nhl * shpg * ctx["defF"] * ctx["goalieF"] * ctx["shotsAggF"] ** 0.5
    lam_a = apg_nhl * 0.92 * ctx["goalieF"] * (0.55 + 0.45 * ctx["offF"]) + 2 * 0.30 * lam_g
    lam_p = lam_g + lam_a
    lam_g_nog = lam_g / ctx["goalieF"] if ctx["goalieF"] else lam_g
    lam_a_nog = (lam_a - 2 * 0.30 * lam_g) / ctx["goalieF"] + 2 * 0.30 * lam_g \
        if ctx["goalieF"] else lam_a

    # indice volontairement bas et plafonné au palier 2 : aucune référence NHL
    conf = 51.0 if not preseason else 49.0

    flags = ["recrue"]
    if ctx["b2b"]:
        flags.append("b2b")
    rec = {
        "id": p["id"], "name": name, "abbr": ctx["abbr"],
        "num": p.get("sweaterNumber"), "pos": pos,
        "shoots": p.get("shootsCatches"), "headshot": p.get("headshot"), "gp": 0,
        "raw": {"g": 0, "a": 0, "pts": 0, "sh": 0, "shPct": sh_pct, "expShPct": exp_sh,
                "toiMin": toi, "ppg": 0.0, "ppp": 0, "ppShare": 0.0, "evg": 0,
                "evp": 0, "fo": None, "pm": None},
        "perGame": {"g": round(gpg_nhl, 2), "a": round(apg_nhl, 2),
                    "pts": round(ppg_nhl, 2), "sh": round(shpg, 1)},
        "form": {"n": 0, "g": 0.0, "pts": 0.0, "sh": 0.0, "toiMin": None},
        "lambda": {"g": round(lam_g, 3), "a": round(lam_a, 3), "pts": round(lam_p, 3)},
        "lambdaSansGardien": {"g": round(lam_g_nog, 3), "a": round(lam_a_nog, 3)},
        "milestones": {"g": {"next": None, "gap": None, "f": 0.0},
                       "a": {"next": None, "gap": None, "f": 0.0},
                       "pts": {"next": None, "gap": None, "f": 0.0}},
        "flags": flags, "regressionRisk": 0.0, "opp": ctx["opp"],
        "h2h": {"n": 0, "pts": None, "g": None, "sh": None, "f": 1.0},
        "goalieF": ctx["goalieF"], "oppGoalie": (ctx["goalie"] or {}).get("name"),
        "recrue": {"ligue": lg, "ligueFr": lg_fr, "conv": conv,
                   "saison": (last or {}).get("season"), "equipe": (last or {}).get("team"),
                   "pts": (last or {}).get("pts"), "gp": (last or {}).get("gp"),
                   "rep": (f"{bio.get('draftRound')}e tour {draft_year}"
                           if bio.get("draftYear") else None),
                   "base": base, "confidence": conf},
    }
    for kind in ("buteur", "passeur", "pointeur"):  # marchés de la recrue
        lam = rec["lambda"][{"buteur": "g", "passeur": "a", "pointeur": "pts"}[kind]]
        prob = round(1 - math.exp(-lam), 4)
        rec[kind] = {"score": js_round(100 * prob, 1), "prob": prob,
                     "lam": round(lam, 3), "confidence": conf,
                     "palier": palier(conf), "etoiles": etoiles(palier(conf)),
                     "rank": None, "why": justify(kind, rec, ctx)}
    return rec

def player_record(p, ctx, sk_by_season, log, active, ref, career, lg_sh_pct,
                  bios, rookies, preseason):
    stats = sk_by_season.get(active, {}).get(p["id"])
    if not stats or stats.get("gamesPlayed", 0) < MIN_GP:
        stats = sk_by_season.get(ref, {}).get(p["id"])

    bio = bios.get(str(p["id"])) or {}
    is_rookie = (bio.get("gamesPlayed") or 0) < 3

    if (not stats or stats.get("gamesPlayed", 0) < MIN_GP) and is_rookie:
        return rookie_record(p, ctx, rookies.get(str(p["id"])), bio, lg_sh_pct, preseason)
    if not stats or stats.get("gamesPlayed", 0) < MIN_GP:
        return None

    gp = stats.get("gamesPlayed", 0)
    g, a = stats.get("goals", 0) or 0, stats.get("assists", 0) or 0
    pts, sh = stats.get("points", 0) or 0, stats.get("shots", 0) or 0
    evg, ppg = stats.get("evGoals", 0) or 0, stats.get("ppGoals", 0) or 0
    ppp = stats.get("ppPoints", 0) or 0

    gpg, apg, ptg, shpg = g / gp, a / gp, pts / gp, sh / gp
    pp_share = (ppp / pts) if pts else 0.0
    ev_gpg = evg / gp
    sh_pct = (g / sh) if sh else None

    # --- 1. régression de l'efficacité de tir ---
    car = career.get(p["id"], {})
    reg = min(1.0, gp / 35)
    flags = []
    risk, exp_sh = None, sh_pct
    if sh_pct and sh >= 40 and car.get("shPct") and car.get("sh", 0) >= 250:
        cible = 0.5 * car["shPct"] + 0.5 * lg_sh_pct
        e = (sh_pct - cible) / cible
        exp_sh = sh_pct * (1 - 0.45 * reg * e)
        risk = round((sh_pct - exp_sh) / sh_pct * 100, 1)
        if reg > 0.6 and e > 0.30:
            flags.append("tir_chaud")
        elif reg > 0.6 and e < -0.25:
            flags.append("tir_froid")
    if gp < 10:
        flags.append("echantillon")

    # --- 2. forme (5 derniers matchs) et absence ---
    form = log[:5]
    formG = formP = formSh = 0.0
    formToi = None
    if form:
        ft = sum(toi_sec(x.get("toi")) for x in form)          # secondes
        if ft:
            nb = len(form)
            formG = sum(x.get("goals", 0) for x in form) / nb
            formP = sum(x.get("points", 0) for x in form) / nb
            formSh = sum(x.get("shots", 0) for x in form) / nb
        formToi = ft / 60 / len(form)
        team_last = max((x.get("gameDate") or "") for x in log)
        if (form[0].get("gameDate") or "") < team_last:
            flags.append("absent")
    else:
        # log absent = joueur hors de l'échantillon récupéré, PAS un absent
        flags.append("hors_echantillon")
    if ctx["b2b"]:
        flags.append("b2b")
    if pp_share > 0.40 and ppp >= 8:
        flags.append("pp_gonfle")
    if form and ptg > 0 and formP >= ptg * 1.3 and formP >= 0.5:
        flags.append("en_hausse")

    # --- historique contre CET adversaire (10 derniers duos joueur/adversaire) ---
    h2h = [x for x in log[:10] if x.get("opponentAbbrev") == ctx["opp"]]
    h2h_f, h2h_pts_pg, h2h_g_pg, h2h_sh_pg = 1.0, None, None, None
    if len(h2h) >= 2 and ptg > 0:
        h2h_pts_pg = sum(x.get("points", 0) for x in h2h) / len(h2h)
        h2h_g_pg = sum(x.get("goals", 0) for x in h2h) / len(h2h)
        h2h_sh_pg = sum(x.get("shots", 0) for x in h2h) / len(h2h)
        h2h_f = clamp(h2h_pts_pg / ptg, 0.75, 1.35)

    # --- 3. objectifs / paliers ronds ---
    msG0, nxtG0, gapG0 = milestone(g, 10, 6)
    msA0, nxtA0, gapA0 = milestone(a, 25, 6)

    # --- 4. buts / passes / points attendus ---
    # 5v5 : pondéré par la défense adverse et le gardien adverse
    ev_lam = ev_gpg * ctx["defF"] * ctx["goalieF"]
    # le taux global capte aussi la qualité de l'équipe et le volume de tirs
    fg = 0.70 * gpg + 0.30 * formG if form else gpg
    tot_lam = fg * ctx["defF"] * ctx["goalieF"] * ctx["shotsAggF"] ** 0.5
    lam_g = max(0.0, 0.60 * ev_lam + 0.40 * tot_lam) * h2h_f
    # un % de tir au-dessus de sa moyenne 5 ans + ligue finit par redescendre :
    # on projette les buts sur le % de tir régressé, pas sur le % de tir constaté.
    if sh_pct and exp_sh:
        lam_g *= clamp(exp_sh / sh_pct, 0.70, 1.30)

    # passes : les siennes + une part de celles que ses propres buts génèrent (2 par but)
    lam_a = max(0.0, apg * 0.92 * h2h_f * ctx["goalieF"] * (0.55 + 0.45 * ctx["offF"])
                + 2 * 0.30 * lam_g)
    # un joueur à 1 ou 2 unités d'un palier rond cherche ce point : léger bonus
    lam_g *= (1 + 0.08 * msG0)
    lam_a *= (1 + 0.08 * msA0)
    lam_p = lam_g + lam_a

    # λ sans l'effet gardien : permet de recalculer côté client si le gardien est corrigé
    lam_g_nog = lam_g / ctx["goalieF"] if ctx["goalieF"] else lam_g
    # la part "générée par ses propres buts" n'est pas multipliée par le facteur gardien
    lam_a_nog = (lam_a - 2 * 0.30 * lam_g) / ctx["goalieF"] + 2 * 0.30 * lam_g \
        if ctx["goalieF"] else lam_a

    prob_g = 1 - math.exp(-lam_g)
    prob_a = 1 - math.exp(-lam_a)
    prob_p = 1 - math.exp(-lam_p)

    msG, nxtG, gapG = msG0, nxtG0, gapG0
    msA, nxtA, gapA = msA0, nxtA0, gapA0
    msP, nxtP, gapP = milestone(pts, 25, 6)
    msP50, nxtP50, gapP50 = milestone(pts, 50, 6)
    if msP50 > msP:
        msP, nxtP, gapP = msP50, nxtP50, gapP50

    name = f"{(p.get('firstName') or {}).get('default','')} " \
           f"{(p.get('lastName') or {}).get('default','')}".strip()
    rec = {
        "id": p["id"], "name": name, "abbr": ctx["abbr"],
        "num": p.get("sweaterNumber"), "pos": p.get("positionCode"),
        "shoots": p.get("shootsCatches"), "headshot": p.get("headshot"), "gp": gp,
        "raw": {"g": g, "a": a, "pts": pts, "sh": sh, "shPct": sh_pct, "expShPct": exp_sh,
                "toiMin": round(toi_sec(stats.get("timeOnIcePerGame")) / 60, 1),
                "ppg": ppg, "ppp": ppp, "ppShare": pp_share, "evg": evg,
                "evp": stats.get("evPoints", 0), "fo": stats.get("faceoffWinPct"),
                "pm": stats.get("plusMinus")},
        "perGame": {"g": round(gpg, 2), "a": round(apg, 2), "pts": round(ptg, 2),
                    "sh": round(shpg, 1)},
        "form": {"n": len(form), "g": round(formG, 2), "pts": round(formP, 2),
                 "sh": round(formSh, 1), "toiMin": round(formToi, 1) if formToi else None},
        "lambda": {"g": round(lam_g, 3), "a": round(lam_a, 3), "pts": round(lam_p, 3)},
        "lambdaSansGardien": {"g": round(lam_g_nog, 3), "a": round(lam_a_nog, 3)},
        "milestones": {"g": {"next": nxtG, "gap": gapG, "f": round(msG, 2)},
                       "a": {"next": nxtA, "gap": gapA, "f": round(msA, 2)},
                       "pts": {"next": nxtP, "gap": gapP, "f": round(msP, 2)}},
        "flags": flags, "regressionRisk": risk, "opp": ctx["opp"],
        "h2h": {"n": len(h2h), "pts": h2h_pts_pg, "g": h2h_g_pg, "sh": h2h_sh_pg,
                "f": round(h2h_f, 2)},
        "goalieF": ctx["goalieF"], "oppGoalie": (ctx["goalie"] or {}).get("name"),
    }
    for kind in ("buteur", "passeur", "pointeur"):
        key, _ = UNITE[kind]
        # on stocke la probabilité arrondie à 4 décimales, et le score est calculé
        # à partir de CETTE valeur : c'est exactement ce que fait le recalcul côté
        # client, donc les égalités se départagent de la même façon des deux côtés.
        prob = round({"buteur": prob_g, "passeur": prob_a, "pointeur": prob_p}[kind], 4)
        lam = {"buteur": lam_g, "passeur": lam_a, "pointeur": lam_p}[kind]
        # score = probabilité : le rang, le score et l'indice restent strictement cohérents
        rec[kind] = {"score": js_round(100 * prob, 1),
                     "prob": prob, "lam": round(lam, 3),
                     "confidence": 0.0, "palier": 1, "etoiles": "☆☆☆☆☆", "rank": None,
                     "why": justify(kind, rec, ctx)}
    return rec


def justify(kind, rec, ctx):
    """Justification courte — uniquement des chiffres réels."""
    if "recrue" in rec["flags"]:
        rc = rec["recrue"]
        unite = UNITE[kind][1]
        val = rec["perGame"][{"buteur": "g", "passeur": "a", "pointeur": "pts"}[kind]]
        bits = [f"recrue sans référence NHL ({rc['base']})",
                f"projection {f2(val)} {unite}/match depuis {rc['ligueFr']}",
                f"TGL estimé {f1(rec['raw']['toiMin'])} min"]
        gg = ctx.get("goalie") or {}
        if gg.get("sv"):
            bits.append(f"{gg['name']} en face : {pc(gg['sv'])}, {f2(gg.get('gaa'))} MOY")
        bits.append(f"défense adverse × {f2(ctx['defF'])}")
        txt = " · ".join(bits) + "."
        if rc.get("rep"):
            txt += f" {rc['rep'].capitalize()}."
        txt += " ⚠ projection indicative, indice plafonné à 2 étoiles."
        if "b2b" in rec["flags"]:
            txt += " ⚠ back-to-back."
        return txt

    r, gg = rec["raw"], ctx["goalie"]
    key, unite = UNITE[kind]
    bits = []
    if r["toiMin"]:
        bits.append(f"TGL {f1(r['toiMin'])} min/match")
    bits.append(f"{f1(rec['perGame']['sh'])} tir/match")
    if kind == "buteur":
        bits.append(f"{f2(rec['perGame']['g'])} but/match à {pc(r['shPct'])} de réussite")
        if rec["regressionRisk"] is not None and abs(rec["regressionRisk"]) >= 6:
            sens = ("intenable, régression attendue" if rec["regressionRisk"] > 0
                    else "réussite froide, marge de hausse")
            bits.append(f"% de tir {sens} ({pc(r['expShPct'])} projeté)")
    elif kind == "passeur":
        bits.append(f"{f2(rec['perGame']['a'])} passe/match")
    else:
        bits.append(f"{f2(rec['perGame']['pts'])} point/match")
        if r["ppShare"] > 0.25:
            bits.append(f"dont {pc(r['ppShare'], 0)} en avantage numérique")
    if gg and gg.get("sv"):
        bits.append(f"{gg['name']} en face {pc(gg['sv'])} / {f2(gg.get('gaa'))}")
    if ctx.get("oppGa"):
        bits.append(f"{ctx['oppNameFr']} concède {f2(ctx['oppGa'])} but/match")
    else:
        bits.append(f"défense adverse × {f2(ctx['defF'])}")
    txt = " · ".join(bits) + "."

    ms = rec["milestones"][key]
    if ms["next"] and ms["gap"] and 0 < ms["gap"] <= 6:
        deja = rec["raw"][{"g": "g", "a": "a", "pts": "pts"}[key]]
        txt += f" Objectif : {deja} {unite} cette saison, à {ms['gap']} des {ms['next']}."
    if rec["form"]["n"]:
        if kind == "buteur":
            txt += (f" Forme ({rec['form']['n']} dern.) : {dfr(rec['form']['g'])} but, "
                    f"{dfr(rec['form']['pts'])} pt.")
        else:
            txt += f" Forme ({rec['form']['n']} dern.) : {dfr(rec['form']['pts'])} pt/match."
    h = rec.get("h2h") or {}
    if h.get("n", 0) >= 2 and h.get("pts") is not None:
        txt += (f" Contre {ctx['opp']} : {h['n']} duels, {dfr(h['pts'])} pt/match"
                f" ({dfr(h['f'], 2)}× sa moyenne).")
    if "en_hausse" in rec["flags"]:
        txt += " ↗ en hausse nette sur 5 matchs."
    if "absent" in rec["flags"]:
        txt += " ⚠ n'a pas joué le dernier match de son équipe."
    elif "hors_echantillon" in rec["flags"]:
        txt += " ℹ forme récente non mesurée (hors échantillon suivi)."
    if "b2b" in rec["flags"]:
        txt += " ⚠ back-to-back."
    if "pp_gonfle" in rec["flags"] and kind == "buteur":
        txt += f" ⚠ {pc(r['ppShare'], 0)} de ses points viennent de l'AN."
    return coupe(txt)


def coupe(txt, max_len=430):
    """Filet : on ne livre jamais une justification à rallonge."""
    if len(txt) <= max_len:
        return txt
    t = txt[:max_len]
    i = t.rfind(". ")
    return (t[:i + 1] if i > max_len // 2 else t[:max_len - 1].rstrip(" ,") + "…")


if __name__ == "__main__":
    main()

"""
Pipeline de données pour l'app de pronostics NHL.

Aspire l'API officielle NHL et prépare tout ce dont le moteur a besoin :
  - les matchs à venir (présaison + saison régulière)
  - les effectifs actuels des 32 équipes
  - les stats de la saison de référence ET de la saison en cours
  - le game-log (match par match) des meilleurs pointeurs -> forme, TGL, absences
  - les gardiens : partant probable (booléen "starter" du boxscore) + stats saison

Usage:  python3 fetch_pronos.py [jours_a_venir=21]
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "data")
WEB = "https://api-web.nhle.com/v1"
REST = "https://api.nhle.com/stats/rest/en"
UA = {"User-Agent": "Mozilla/5.0 (compatible; NHL-Pronos/1.0)", "Accept": "application/json"}
SEASONS = ["20212022", "20222023", "20232024", "20242025", "20252026", "20262027"]
LOG_PER_TEAM = 25       # game-logs récupérés par équipe (forme + détection d'absence)
BOX_PER_TEAM = 4        # boxscores pour repérer le gardien partant
WORKERS = 6


def get(url, params=None, tries=4):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as exc:
            last = exc
            code = getattr(exc, "code", None)
            if code == 404:
                return None
            time.sleep(0.6 * (i + 1))
    print(f"  !! échec {url} : {last}")
    return None


def season_id(date_iso):
    y = int(date_iso[:4])
    return f"{y}{y+1}" if int(date_iso[5:7]) >= 8 else f"{y-1}{y}"


def fetch_games(days):
    """Calendrier sur N jours à partir d'aujourd'hui."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    games, seen = [], set()
    for i in range(days):
        d = time.strftime("%Y-%m-%d", time.gmtime(time.time() + i * 86400))
        sched = get(f"{WEB}/schedule/{d}")
        if not sched:
            continue
        for week in sched.get("gameWeek", []):
            if week.get("date") != d:
                continue
            for g in week.get("games", []):
                if g["id"] in seen:
                    continue
                seen.add(g["id"])
                games.append({
                    "id": g["id"], "date": week["date"], "season": g["season"],
                    "gameType": g["gameType"], "startUtc": g["startTimeUTC"],
                    "state": g.get("gameState"),
                    "away": g["awayTeam"]["abbrev"], "home": g["homeTeam"]["abbrev"],
                    "awayName": (g["awayTeam"].get("name") or {}).get("default"),
                    "homeName": (g["homeTeam"].get("name") or {}).get("default"),
                    "venue": g.get("venue", {}).get("default"),
                    "linkFr": g.get("gameCenterLink"),
                })
    games.sort(key=lambda g: (g["date"], g["startUtc"]))
    return games


def fetch_team_index():
    """id / abréviation / nom EN + FR / logo des 32 équipes."""
    today = time.strftime("%Y-%m-%d", time.gmtime())
    d = get(f"{WEB}/schedule-calendar/{today}") or {}
    out = {}
    for t in d.get("teams", []):
        out[t["abbrev"]] = {
            "id": t.get("id"), "abbr": t["abbrev"],
            "nameEn": (t.get("name") or {}).get("default"),
            "nameFr": (t.get("name") or {}).get("fr"),
            "logo": t.get("logo"), "darkLogo": t.get("darkLogo"),
        }
    return out


def fetch_skaters(season):
    rows, start, page = [], 0, 100
    while True:
        d = get(f"{REST}/skater/summary", {
            "isAggregate": "true", "reportType": "basic", "isGame": "false",
            "reportName": "skatersummary", "cayenneExp": f"seasonId={season} and gameTypeId=2",
            "limit": str(page), "start": str(start),
            "sort": json.dumps([{"property": "points", "direction": "DESC"}]),
        })
        batch = (d or {}).get("data", [])
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def fetch_goalies(season):
    rows, start, page = [], 0, 100
    while True:
        d = get(f"{REST}/goalie/summary", {
            "isAggregate": "true", "reportType": "basic", "isGame": "false",
            "reportName": "goaliesummary", "cayenneExp": f"seasonId={season} and gameTypeId=2",
            "limit": str(page), "start": str(start),
            "sort": json.dumps([{"property": "gamesPlayed", "direction": "DESC"}]),
        })
        batch = (d or {}).get("data", [])
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page
    return rows


def fetch_teams(season):
    d = get(f"{REST}/team/summary", {
        "isAggregate": "true", "reportType": "basic", "isGame": "false",
        "reportName": "teamsummary", "cayenneExp": f"seasonId={season} and gameTypeId=2",
        "limit": "50", "start": "0",
    })
    return (d or {}).get("data", [])


def fetch_bios(pids):
    """Carrière NHL + repêchage, par lots de 60 joueurs."""
    out = {}
    lots = [pids[i:i + 60] for i in range(0, len(pids), 60)]
    def un_lot(lot):
        expr = " or ".join(f"playerId={p}" for p in lot)
        d = get(f"{REST}/skater/bios", {"cayenneExp": expr, "limit": "100", "start": "0"})
        return (d or {}).get("data", [])
    with ThreadPoolExecutor(WORKERS) as ex:
        for res in ex.map(un_lot, lots):
            for r in res:
                out[str(r["playerId"])] = r
    return out


def fetch_landing(pid):
    """Carrière TODTES ligues d'un joueur sans référence NHL (recrue)."""
    d = get(f"{WEB}/player/{pid}/landing")
    if not d:
        return None
    return {
        "birthDate": d.get("birthDate"),
        "seasons": [
            {"season": x.get("season"), "league": x.get("leagueAbbrev"),
             "team": x.get("teamAbbrevs"), "gp": x.get("gamesPlayed"),
             "g": x.get("goals"), "a": x.get("assists"), "pts": x.get("points")}
            for x in (d.get("seasonTotals") or [])
            if x.get("gameTypeId") == 2 and (x.get("gamesPlayed") or 0) >= 3
        ],
    }


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 35
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()

    print("1/6 calendrier…")
    games = fetch_games(days)
    print(f"     {len(games)} matchs sur {days} jours")
    teams = sorted({g["away"] for g in games} | {g["home"] for g in games})
    print(f"     {len(teams)} équipes concernées")

    print("1b/6 index des équipes…")
    team_index = fetch_team_index()
    print(f"     {len(team_index)} équipes")

    print("2/6 effectifs…")
    rosters = {}
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(get, f"{WEB}/roster/{t}/current"): t for t in teams}
        for f in as_completed(futs):
            rosters[futs[f]] = f.result() or {}
    print(f"     {sum(len(r.get('forwards', [])) + len(r.get('defensemen', [])) for r in rosters.values())} joueurs")

    print("3/6 stats par saison…")
    skaters, goalies, teams_stats = {}, {}, {}
    for s in SEASONS:
        sk = fetch_skaters(s)
        if not sk:
            continue
        skaters[s] = sk
        goalies[s] = fetch_goalies(s)
        teams_stats[s] = fetch_teams(s)
        gp = sum(r.get("gamesPlayed", 0) for r in teams_stats[s]) // 2
        print(f"     {s}: {len(sk)} patineurs, {len(goalies[s])} gardiens, {gp} matchs joués")

    print("4/6 game-logs (forme, TGL, absences)…")
    ref = max(s for s in skaters if sum(r.get("gamesPlayed", 0) for r in teams_stats.get(s, [])) > 0)
    targets = []
    for t in teams:
        r = rosters.get(t, {})
        sk = sorted(r.get("forwards", []) + r.get("defensemen", []), key=lambda p: p.get("id", 0))
        base = {x["playerId"]: x for x in skaters.get(ref, [])}
        sk.sort(key=lambda p: (base.get(p["id"], {}).get("points", 0)), reverse=True)
        targets.extend((t, p["id"]) for p in sk[:LOG_PER_TEAM])
    glogs = {}
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(get, f"{WEB}/player/{pid}/game-log/{ref}/2"): pid for _, pid in targets}
        for i, f in enumerate(as_completed(futs), 1):
            d = f.result()
            # les 12 derniers matchs suffisent (forme, TGL, absences)
            glogs[str(futs[f])] = (d or {}).get("gameLog", [])[:LOG_PER_TEAM]
            if i % 100 == 0:
                print(f"     {i}/{len(futs)}")
    print(f"     {sum(1 for v in glogs.values() if v)} game-logs non vides")

    print("5/6 gardiens partants (boxscores)…")
    starts, starters = {}, {}
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {}
        for t in teams:
            sch = ex.submit(get, f"{WEB}/club-schedule-season/{t}/{ref}")
            futs[sch] = t
        for f in as_completed(futs):
            t = futs[f]
            d = f.result() or {}
            gs = [g for g in d.get("games", []) if g.get("gameType") == 2]
            starts[t] = [g["id"] for g in gs[-BOX_PER_TEAM:]]

    boxes = {}
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(get, f"{WEB}/gamecenter/{gid}/boxscore"): (t, gid)
                for t, ids in starts.items() for gid in ids}
        for f in as_completed(futs):
            t, gid = futs[f]
            d = f.result()
            if not d:
                continue
            pbg = d.get("playerByGameStats", {})
            for side, code in (("awayTeam", d.get("awayTeam", {}).get("abbrev")),
                               ("homeTeam", d.get("homeTeam", {}).get("abbrev"))):
                for g in pbg.get(side, {}).get("goalies", []):
                    if g.get("starter"):
                        starters.setdefault(code, []).append({
                            "playerId": g["playerId"],
                            "name": (g.get("name") or {}).get("default"),
                            "gameId": gid, "date": d.get("gameDate"),
                            "saves": g.get("saves"), "shotsAgainst": g.get("shotsAgainst"),
                            "savePctg": g.get("savePctg"), "decision": g.get("decision"),
                        })
    for t in starters:
        starters[t].sort(key=lambda x: x["date"] or "", reverse=True)
    print(f"     partant identifié pour {len(starters)} équipes")

    print("5b/6 recrues : carrière NHL, repêchage, dernières saisons en ligues mineures…")
    known = set()
    for srows in skaters.values():
        known.update(r["playerId"] for r in srows)
    roster_ids = []
    for t in teams:
        r = rosters.get(t, {})
        for grp in ("forwards", "defensemen"):
            roster_ids.extend(p["id"] for p in r.get(grp, []))
    roster_ids = sorted(set(roster_ids))
    bios = fetch_bios(roster_ids)
    print(f"     {len(bios)}/{len(roster_ids)} joueurs ont un historique NHL")
    # ceux qui n'ont aucun historique NHL : on va chercher leur dernière saison ailleurs
    sans_hist = [p for p in roster_ids
                 if str(p) not in bios or (bios[str(p)].get("gamesPlayed") or 0) < 3]
    rookies = {}
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(fetch_landing, p): p for p in sans_hist}
        for f in as_completed(futs):
            d = f.result()
            if d:
                rookies[str(futs[f])] = d
    print(f"     {len(rookies)} profils sans référence NHL récupérés (recrues / ligues mineures)")

    print("6/6 écriture…")
    payload = {
        "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "refSeason": ref, "currentSeason": season_id(time.strftime("%Y-%m-%d", time.gmtime())),
        "games": games, "teams": teams, "teamIndex": team_index,
        "rosters": rosters, "skaters": skaters, "goalies": goalies,
        "teamStats": teams_stats, "gameLogs": glogs, "recentStarters": starters,
        "bios": bios, "rookies": rookies,
        "overrides": {},
    }
    path = os.path.join(OUT, "pronos.json")
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"     data/pronos.json ({round(os.path.getsize(path)/1024/1024, 2)} Mo) "
          f"en {round(time.time()-t0, 1)} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())

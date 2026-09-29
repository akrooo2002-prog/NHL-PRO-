// Collecte NHL ciblée sur UN match (2 équipes) pour l'analyse instantanée.
// GET /collecter?game=<id>&date=AAAA-MM-JJ → payload format pronos.json.
// Port fidèle de fetch_pronos.collecte_un_match() (mêmes URL, mêmes filtres) ;
// le calcul reste dans engine.py, exécuté côté client (mêmes détails garantis).
const WEB = "https://api-web.nhle.com/v1";
const REST = "https://api.nhle.com/stats/rest/en";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; NHL-Pronos/1.0)", Accept: "application/json" };
const LOGS_N = 25;   // game-logs par joueur (comme LOG_PER_TEAM)
const BOX_N = 4;     // boxscores par équipe (comme BOX_PER_TEAM)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const j = (code, obj) => ({ statusCode: code, headers: CORS, body: JSON.stringify(obj) });

async function get(url, params) {
  if (params) url += "?" + new URLSearchParams(params).toString();
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === 1) return null;
    }
  }
  return null;
}

const seasonId = (d) => {
  const y = +d.slice(0, 4);
  return +d.slice(5, 7) >= 8 ? `${y}${y + 1}` : `${y - 1}${y}`;
};

async function paged(report, season, sortProp) {
  const rows = [];
  let start = 0;
  const page = 100;
  for (;;) {
    const d = await get(`${REST}/${report}/summary`, {
      isAggregate: "true", reportType: "basic", isGame: "false",
      reportName: report + "summary",
      cayenneExp: `seasonId=${season} and gameTypeId=2`,
      limit: String(page), start: String(start),
      sort: JSON.stringify([{ property: sortProp, direction: "DESC" },
        { property: "playerId", direction: "ASC" }]),
    });
    const b = (d && d.data) || [];
    if (!b.length) break;
    rows.push(...b);
    if (b.length < page) break;
    start += page;
  }
  return rows;
}

const skaters = (s) => paged("skater", s, "points");
const goalies = (s) => paged("goalie", s, "gamesPlayed");

async function teams(s) {
  const d = await get(`${REST}/team/summary`, {
    isAggregate: "true", reportType: "basic", isGame: "false",
    reportName: "teamsummary", cayenneExp: `seasonId=${s} and gameTypeId=2`,
    limit: "50", start: "0",
  });
  return (d && d.data) || [];
}

async function teamIndex() {
  const today = new Date().toISOString().slice(0, 10);
  const d = (await get(`${WEB}/schedule-calendar/${today}`)) || {};
  const out = {};
  for (const t of d.teams || []) {
    out[t.abbrev] = {
      id: t.id, abbr: t.abbrev,
      nameEn: (t.name || {}).default, nameFr: (t.name || {}).fr,
      logo: t.logo, darkLogo: t.darkLogo,
    };
  }
  return out;
}

async function bios(pids) {
  const out = {};
  const lots = [];
  for (let i = 0; i < pids.length; i += 60) lots.push(pids.slice(i, i + 60));
  await Promise.all(lots.map(async (lot) => {
    const expr = lot.map((p) => `playerId=${p}`).join(" or ");
    const d = await get(`${REST}/skater/bios`, { cayenneExp: expr, limit: "100", start: "0" });
    for (const r of (d && d.data) || []) out[String(r.playerId)] = r;
  }));
  return out;
}

async function landing(pid) {
  const d = await get(`${WEB}/player/${pid}/landing`);
  if (!d) return null;
  return {
    birthDate: d.birthDate,
    seasons: (d.seasonTotals || [])
      .filter((x) => x.gameTypeId === 2 && (x.gamesPlayed || 0) >= 3)
      .map((x) => ({ season: x.season, league: x.leagueAbbrev, team: x.teamAbbrevs,
        gp: x.gamesPlayed, g: x.goals, a: x.assists, pts: x.points })),
  };
}

function mapGame(g, date) {
  return {
    id: g.id, date, season: g.season, gameType: g.gameType, startUtc: g.startTimeUTC,
    state: g.gameState, away: g.awayTeam.abbrev, home: g.homeTeam.abbrev,
    awayName: (g.awayTeam.name || {}).default, homeName: (g.homeTeam.name || {}).default,
    venue: (g.venue || {}).default, linkFr: g.gameCenterLink,
  };
}

async function gameById(date, gid) {
  const sched = await get(`${WEB}/schedule/${date}`);
  if (!sched) return null;
  for (const w of sched.gameWeek || []) {
    for (const g of w.games || []) if (g.id === gid) return mapGame(g, w.date);
  }
  return null;
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const gid = Number(qs.game || 0);
  const date = String(qs.date || "");
  if (!gid || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return j(400, { erreur: "usage : /collecter?game=<id>&date=AAAA-MM-JJ" });
  }
  try {
    const game = await gameById(date, gid);
    if (!game) return j(404, { erreur: "match introuvable à cette date" });
    const teamArr = [game.away, game.home];

    // ---- compos officielles : le boxscore NHL les publie ~1 h avant le match ----
    // check=1 : sonde légère pour le suivi « dès que les compos sortent » ;
    // compo=1 : collecte complète + overrides (rayés absents, gardien officiel).
    let compo = null;
    if (qs.compo === "1" || qs.check === "1") {
      const bx = await get(`${WEB}/gamecenter/${gid}/boxscore`);
      const pbg = (bx && bx.playerByGameStats) || {};
      const equipes = {};
      let publiee = true;
      for (const [side, abbr] of [["awayTeam", game.away], ["homeTeam", game.home]]) {
        const t = pbg[side] || {};
        const ids = [...(t.forwards || []), ...(t.defense || [])].map((x) => x.playerId);
        const st = (t.goalies || []).filter((x) => x.starter)[0] || null;
        equipes[abbr] = {
          joueurs: ids,
          partant: st ? { playerId: st.playerId, name: (st.name || {}).default } : null,
        };
        if (!ids.length) publiee = false;
      }
      if (qs.check === "1") {
        return j(200, { publiee, etat: (bx && bx.gameState) || null });
      }
      if (publiee) compo = { publiee: true, equipes };
    }

    // saisons récentes seulement (4) : les repères du moteur n'utilisent que ça
    const y0 = +seasonId(new Date().toISOString().slice(0, 10)).slice(0, 4);
    const seasons = [y0 - 3, y0 - 2, y0 - 1, y0].map((v) => `${v}${v + 1}`);

    // vague 1 : index, effectifs, stats de ligue
    const [ti, rosterA, rosterB] = await Promise.all([
      teamIndex(),
      get(`${WEB}/roster/${teamArr[0]}/current`),
      get(`${WEB}/roster/${teamArr[1]}/current`),
    ]);
    const rosters = { [teamArr[0]]: rosterA || {}, [teamArr[1]]: rosterB || {} };
    const res = await Promise.all(seasons.flatMap((s) => [
      skaters(s).then((r) => ["sk", s, r]),
      goalies(s).then((r) => ["go", s, r]),
      teams(s).then((r) => ["ts", s, r]),
    ]));
    const skatersBy = {}, goaliesBy = {}, teamsBy = {};
    for (const [k, s, r] of res) {
      if (!r || !r.length) continue;
      ({ sk: skatersBy, go: goaliesBy, ts: teamsBy })[k][s] = r;
    }
    for (const s of Object.keys(skatersBy)) {
      if (!goaliesBy[s] || !teamsBy[s]) delete skatersBy[s];
    }
    const ref = Object.keys(teamsBy)
      .filter((s) => teamsBy[s].reduce((a, r) => a + (r.gamesPlayed || 0), 0) > 0)
      .sort()
      .pop();
    if (!ref) return j(502, { erreur: "stats de ligue indisponibles" });

    // vague 2 : game-logs des 25 meilleurs pointeurs de chaque équipe,
    // calendriers (pour les boxscores) et bios NHL
    const baseBy = {};
    for (const r of skatersBy[ref] || []) baseBy[r.playerId] = r;
    const ids = [];
    for (const t of teamArr) {
      const r = rosters[t] || {};
      const sk = [...(r.forwards || []), ...(r.defensemen || [])]
        .slice().sort((a, b) => (a.id || 0) - (b.id || 0))
        .sort((a, b) => ((baseBy[b.id] || {}).points || 0) - ((baseBy[a.id] || {}).points || 0));
      ids.push(...sk.slice(0, LOGS_N).map((p) => p.id));
    }
    const rosterIds = [...new Set(teamArr.flatMap((t) => {
      const r = rosters[t] || {};
      return [...(r.forwards || []), ...(r.defensemen || [])].map((p) => p.id);
    }))].sort((a, b) => a - b);
    const [logsArr, schedA, schedB, biosOut] = await Promise.all([
      Promise.all(ids.map((pid) =>
        get(`${WEB}/player/${pid}/game-log/${ref}/2`).then((d) => [String(pid), ((d || {}).gameLog || []).slice(0, LOGS_N)]))),
      get(`${WEB}/club-schedule-season/${teamArr[0]}/${ref}`),
      get(`${WEB}/club-schedule-season/${teamArr[1]}/${ref}`),
      bios(rosterIds),
    ]);
    const glogs = {};
    for (const [pid, rows] of logsArr) glogs[pid] = rows;

    // vague 3 : boxscores (gardien partant) + profils sans référence NHL
    const boxIds = {};
    for (const [t, sch] of [[teamArr[0], schedA], [teamArr[1], schedB]]) {
      const gs = ((sch || {}).games || []).filter((g) => g.gameType === 2).slice(-BOX_N);
      boxIds[t] = gs.map((g) => g.id);
    }
    const known = new Set(Object.values(skatersBy).flat().map((r) => r.playerId));
    const sansHist = rosterIds.filter((p) => !biosOut[String(p)] || (biosOut[String(p)].gamesPlayed || 0) < 3);
    const [boxes, rookiesArr] = await Promise.all([
      Promise.all(Object.values(boxIds).flat()
        .map((id) => get(`${WEB}/gamecenter/${id}/boxscore`).then((d) => [id, d]))),
      Promise.all(sansHist.map((p) => landing(p).then((d) => [String(p), d]))),
    ]);
    const starters = {};
    for (const [id, d] of boxes) {
      if (!d) continue;
      const pbg = d.playerByGameStats || {};
      for (const side of ["awayTeam", "homeTeam"]) {
        const code = ((d[side] || {}).abbrev);
        for (const g of (pbg[side] || {}).goalies || []) {
          if (!g.starter) continue;
          (starters[code] = starters[code] || []).push({
            playerId: g.playerId, name: (g.name || {}).default,
            gameId: id, date: d.gameDate, saves: g.saves,
            shotsAgainst: g.shotsAgainst, savePctg: g.savePctg, decision: g.decision,
          });
        }
      }
    }
    for (const t of Object.keys(starters)) {
      starters[t].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }
    const rookies = {};
    for (const [pid, d] of rookiesArr) if (d) rookies[pid] = d;

    // compos officielles → rayés absents + gardien partant officiel
    const overrides = {};
    if (compo) {
      const absents = [];
      const goaliesOv = {};
      for (const [side, t] of [["away", teamArr[0]], ["home", teamArr[1]]]) {
        const r = rosters[t] || {};
        const all = [...(r.forwards || []), ...(r.defensemen || [])].map((p) => p.id);
        const actifs = new Set(compo.equipes[t].joueurs);
        absents.push(...all.filter((id) => !actifs.has(id)));
        const gk = compo.equipes[t].partant;
        if (gk) goaliesOv[side] = gk.playerId;
      }
      overrides[String(gid)] = { absents, goalies: goaliesOv };
      game.compo = compo;
    }

    const payload = {
      generatedUtc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      refSeason: ref,
      currentSeason: seasonId(new Date().toISOString().slice(0, 10)),
      games: [game], teams: teamArr, teamIndex: ti, rosters,
      skaters: skatersBy, goalies: goaliesBy, teamStats: teamsBy,
      gameLogs: glogs, recentStarters: starters, bios: biosOut, rookies,
      overrides,
    };
    return j(200, payload);
  } catch (e) {
    return j(502, { erreur: "collecte impossible : " + (e && e.message) });
  }
};

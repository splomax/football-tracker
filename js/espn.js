// Fetching and normalizing ESPN's unofficial scoreboard API into the shape the UI renders. No browser APIs: the
// program on Cloudflare (worker/scorekeeper.js) uses it too.

import { LEAGUES } from "./leagues.js";

// ESPN's NFL scoreboard doesn't say which conference or division a team is in, so keep the alignment here.
export const NFL_DIVISIONS = {
  "AFC East": ["BUF", "MIA", "NE", "NYJ"],
  "AFC North": ["BAL", "CIN", "CLE", "PIT"],
  "AFC South": ["HOU", "IND", "JAX", "TEN"],
  "AFC West": ["DEN", "KC", "LAC", "LV"],
  "NFC East": ["DAL", "NYG", "PHI", "WSH"],
  "NFC North": ["CHI", "DET", "GB", "MIN"],
  "NFC South": ["ATL", "CAR", "NO", "TB"],
  "NFC West": ["ARI", "LAR", "SEA", "SF"],
};
const nflDivisionOf = Object.fromEntries(
  Object.entries(NFL_DIVISIONS).flatMap(([division, teams]) => teams.map((abbr) => [abbr, division])));

// Conference names arrive only on conference games, so learn them as games come in.
// Independents (Notre Dame etc.) never play a "conference game", so seed that one.
export const confNames = { 18: "Independent" };

// How far the team with the ball is from the goal it's attacking, or null if nobody has it or ESPN hasn't written the
// spot out. Only the written spot ("1st & 10 at OSU 20", or "at 50" for midfield) is trusted: ESPN's yardLine is
// sometimes stale right after a change of possession (once putting a team at its own 20 in the red zone) and sometimes
// plain junk with no written spot at all (Alabama on Tennessee's goal line, yardLine 0, right after a sack).
function yardsToGoal(s, possession, home, away) {
  const offense = possession === home.id ? home : possession === away.id ? away : null;
  const spot = s.downDistanceText ?? s.possessionText;
  if (!offense || !spot) return null;
  const defense = offense === home ? away : home;
  const [, side, yards] = /\bat (?:(\S+) )?(\d+)$/.exec(s.downDistanceText ?? "") ?? /^(?:(\S+) )?(\d+)$/.exec(s.possessionText ?? "") ?? [];
  if (yards == null) return null;
  if (side === offense.abbr) return 100 - Number(yards);
  if (side === defense.abbr || side == null) return Number(yards);  // no team named: midfield, 50 either way
  return null;  // a team name ESPN spells differently from its abbreviation: don't guess
}

/**
 * ESPN's game detail for g: its scoring plays so far, oldest first ([{ id, kind ("touchdown", "field-goal", "safety"...),
 * teamId, text, awayScore, homeScore }], each with the score it left; a touchdown's text grows the try's result, "(Cam
 * Little Kick)" or "(... PAT failed)", once it's in), for notifications (js/alerts.js, worker/scorekeeper.js); and its
 * latest play, for freshen(); and every play's type, for turnovers.
 */
export async function fetchSummary(g) {
  const [league, id] = g.key.split(":");
  const d = await (await fetch(LEAGUES[league].replace(/scoreboard.*$/, `summary?event=${id}`))).json();
  const all = [...(d.drives?.previous ?? []), ...(d.drives?.current ? [d.drives.current] : [])];
  const plays = all.flatMap((x) => x.plays ?? []);
  const latest = plays.at(-1) ?? null;
  // Every play once (the current drive repeats the last of the previous ones), for turnovers (js/alerts.js
  // turnoverAlerts): its id, ESPN's type ("Rush", "Pass Interception Return"...), the teams with the ball before and
  // after it, and whether it scored.
  const playList = [...new Map(plays.map((p) => [String(p.id), { id: String(p.id), type: p.type?.text, teamId: String(p.start?.team?.id ?? ""),
    endTeamId: String(p.end?.team?.id ?? ""), scoring: !!p.scoringPlay }])).values()];
  const scoringPlays = (d.scoringPlays ?? []).map((p) => ({ id: String(p.id), kind: p.scoringType?.name, teamId: String(p.team?.id), text: p.text,
    awayScore: Number(p.awayScore), homeScore: Number(p.homeScore) }));
  // How each finished drive ended ("INT", "FUMBLE", "DOWNS", "MISSED FG", "TD", "PUNT"...). The current drive is also
  // the last of the previous ones, under the same id, and gets its result as soon as it ends.
  const drives = [...new Map(all.filter((x) => x.result).map((x) => [String(x.id), { id: String(x.id), result: x.result, teamId: String(x.team?.id) }])).values()];
  return { scoringPlays, latest, drives, plays: playList };
}

/** The game's scoring plays only (fetchSummary). */
export const fetchScoringPlays = async (g) => (await fetchSummary(g)).scoringPlays;

// How far into a game: periods, then the clock running down.
const seconds = (clock) => {
  const [m, s] = String(clock ?? "").split(":").map(Number);
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : 0;
};
const progress = (period, clock) => (period ?? 0) * 10_000 - seconds(clock);
const NTH = ["1st", "2nd", "3rd", "4th"];

/**
 * ESPN's scoreboard can lag its own play-by-play by minutes (seen live: stuck at 13:11 in the 1st with no score while
 * the play-by-play had a touchdown), and the other way round too. So the latest play (fetchSummary) wins only when it's
 * plainly further along: no earlier in the game and with no fewer points (points never go down), and ahead on one of
 * them. Then g takes its clock, score, ball spot and last play. A tie keeps the scoreboard's: college overtime has no
 * clock, so a stale play-by-play can look as far along as a fresh scoreboard (seen live: 6-6 in OT against 13-6). A
 * finished game keeps the scoreboard's.
 */
export function freshen(g, latest) {
  if (!latest?.clock || g.state === "post") return g;
  const period = latest.period?.number, clock = latest.clock.displayValue;
  // The scoreboard can sit at "End of 4th" long after the final whistle (seen live: USC @ Wisconsin, still in progress 6
  // minutes after the play-by-play's "End of Game"). Only a tie can go on: to overtime, except an NFL overtime ending tied.
  const tied = latest.awayScore === latest.homeScore;
  if (/^end of game$/i.test(latest.type?.text ?? "") && (!tied || (g.key.startsWith("nfl:") && period > 4))) {
    Object.assign(g, { state: "post", period, clock: "0:00", detail: period > 5 ? `Final/${period - 4}OT` : period === 5 ? "Final/OT" : "Final",
      possession: undefined, yardLine: undefined, distance: undefined, ddText: undefined, redZone: false, lastPlay: latest.text ?? g.lastPlay });
    g.away = { ...g.away, score: String(latest.awayScore ?? g.away.score) };
    g.home = { ...g.home, score: String(latest.homeScore ?? g.home.score) };
    return g;
  }
  const ahead = progress(period, clock) - (g.state === "in" ? progress(g.period, g.clock) : -Infinity);
  const morePoints = (latest.awayScore ?? 0) + (latest.homeScore ?? 0) - (Number(g.away.score) || 0) - (Number(g.home.score) || 0);
  if (ahead < 0 || morePoints < 0 || (ahead === 0 && morePoints === 0)) return g;  // the scoreboard is as far along
  g.away = { ...g.away, score: String(latest.awayScore ?? g.away.score) };
  g.home = { ...g.home, score: String(latest.homeScore ?? g.home.score) };
  const between = /end period|end of/i.test(latest.type?.text ?? "");
  if (ahead > 0) {
    g.state = "in";
    g.period = period;
    g.clock = clock;
    g.detail = between ? (period === 2 ? "Halftime" : `End of ${NTH[period - 1] ?? "OT"} Quarter`) : `${clock} - ${NTH[period - 1] ?? "OT"}`;
  }
  const end = between || g.detail === "Halftime" ? {} : latest.end ?? {};
  const s = { downDistanceText: end.downDistanceText, possessionText: end.possessionText };
  g.possession = end.downDistanceText && !/timeout/i.test(latest.type?.text ?? "") ? String(end.team?.id ?? "") || undefined : undefined;
  g.yardLine = end.yardLine;
  g.distance = end.distance;
  g.ddText = end.downDistanceText;
  const toGoal = yardsToGoal(s, g.possession, g.home, g.away);
  g.redZone = toGoal != null && toGoal <= 20;
  g.lastPlay = latest.text ?? g.lastPlay;
  return g;
}

/** Freshen the given games from their play-by-play (freshen), all at once; a game whose detail fails keeps the scoreboard's. */
export async function freshenGames(games) {
  await Promise.all(games.map(async (g) => {
    try {
      freshen(g, (await fetchSummary(g)).latest);
    } catch (err) {
      console.error("play-by-play", g.key, err);
    }
  }));
}

export async function fetchGames(league) {
  const data = await (await fetch(LEAGUES[league])).json();
  return data.events.map((e) => parseEvent(league, e));
}

function parseEvent(league, e) {
  const comp = e.competitions[0];
  if (comp.groups?.isConference) confNames[comp.groups.id] = comp.groups.shortName;
  const side = (ha) => {
    const c = comp.competitors.find((t) => t.homeAway === ha);
    // conf: a college conference id, or an NFL division name like "AFC East".
    const conf = league === "nfl" ? nflDivisionOf[c.team.abbreviation] : c.team.conferenceId;
    return { id: c.team.id, abbr: c.team.abbreviation, name: c.team.shortDisplayName || c.team.abbreviation, logo: c.team.logo, conf,
             color: "#" + (c.team.color || "555"), score: c.score, rank: c.curatedRank?.current,
             record: c.records?.find((r) => r.type === "total")?.summary };  // overall W-L, e.g. "4-1"
  };
  // At halftime ESPN keeps the last down and distance around; nobody has the ball, so drop the situation.
  const s = e.status.type.name === "STATUS_HALFTIME" ? {} : comp.situation || {};
  // ESPN often omits `possession` after kickoffs, scores and timeouts. When a down is in progress, the last
  // play's ending team is who has the ball, except for timeouts and period ends, where it's whoever called it.
  const lp = s.lastPlay;
  const possession = s.possession ??
    (s.downDistanceText && !/timeout|end period|end of/i.test(lp?.type?.text || "") ? lp?.end?.team?.id : undefined);
  const home = side("home"), away = side("away");
  // ESPN's isRedZone can be stale (still true during a timeout after the ball has moved), so work it out from
  // the ball instead: the team with the ball is within 20 yards of the goal it's attacking.
  const toGoal = yardsToGoal(s, possession, home, away);
  const redZone = toGoal != null && toGoal <= 20;
  return {
    key: `${league}:${e.id}`, date: new Date(e.date),
    state: e.status.type.state, detail: e.status.type.shortDetail,
    clock: e.status.displayClock, period: e.status.period,
    home, away,
    // ESPN's yardLine is yards from the home team's goal line.
    yardLine: s.yardLine, distance: s.distance, possession,
    ddText: s.downDistanceText, redZone,
    // No timeouts: ESPN's college counts don't reset at halftime (scripts/check-timeouts.js), so they're often wrong.
    lastPlay: lp?.text,
    // Where to watch, e.g. "ABC" or "CBS / Paramount+".
    network: [...new Set((comp.broadcasts || []).flatMap((b) => b.names || []))].join(" / "),
    // Link to ESPN's written recap, once the game is over. js/recap.js checks that the story actually exists.
    recap: e.links?.find((l) => l.rel?.includes("recap"))?.href,
  };
}

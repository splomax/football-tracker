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
 * The text of the scoring play that left the game at this score ("Travis Hunter 7 Yd pass from Trevor Lawrence (Cam
 * Little Kick)"), from ESPN's game detail, or null if it isn't listed yet. For score notifications, when the last play
 * the scoreboard reports isn't the scoring one (worker/scorekeeper.js).
 */
export async function fetchScoringPlay(g) {
  const [league, id] = g.key.split(":");
  const { scoringPlays = [] } = await (await fetch(LEAGUES[league].replace(/scoreboard.*$/, `summary?event=${id}`))).json();
  const play = scoringPlays.findLast((p) => String(p.awayScore) === String(g.away.score) && String(p.homeScore) === String(g.home.score));
  return play?.text ?? null;
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
    return { id: c.team.id, abbr: c.team.abbreviation, name: c.team.shortDisplayName || c.team.abbreviation,
             location: c.team.location, fullName: c.team.displayName, logo: c.team.logo, conf,
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
    // Whether that last play scored. ESPN often updates the score a moment before the last play, so a score
    // notification only quotes the last play when it's the scoring one (js/alerts.js).
    lastPlayScored: (lp?.scoreValue ?? 0) > 0,
    // Where to watch, e.g. "ABC" or "CBS / Paramount+".
    network: [...new Set((comp.broadcasts || []).flatMap((b) => b.names || []))].join(" / "),
    // Link to ESPN's written recap, once the game is over. js/recap.js checks that the story actually exists.
    recap: e.links?.find((l) => l.rel?.includes("recap"))?.href,
  };
}

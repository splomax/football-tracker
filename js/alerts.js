// What happened in a game, as notifications: scores (and how each touchdown's try went), trips inside the red zone,
// two-minute warnings, and the start and end of each quarter. Every one carries the score. No browser APIs here: it
// runs in the program on Cloudflare (worker/scorekeeper.js), and the tests (worker/alerts.test.js) drive it directly.
//
// Each event has a fixed name: "score:<ESPN's id for the scoring play>", "try:<id>", "start-3", "end-2", "two-minute-4",
// "final". The game's memo lists the names already sent, and the program saves the memo, so after a restart nothing
// is sent twice or lost: whatever hasn't been sent yet still goes out.

const TRY_GIVE_UP_MS = 4 * 60_000;  // after a touchdown, how long to watch for how its try went
const TRY_RESULTS = { "missed-pat": "Missed PAT", "two-point": "2-pt conversion", "failed-two-point": "Failed 2-pt" };
const SCORE_NAMES = { "field-goal": "field goal", safety: "safety" };

/**
 * How a touchdown's try went, from ESPN's wording on the touchdown's play: "kick", "missed-pat", "two-point",
 * "failed-two-point", or null if it doesn't say (yet).
 */
export function classifyTry(text) {
  if (!text) return null;
  if (/PAT (failed|blocked)/i.test(text)) return "missed-pat";
  if (/Two-Point \w* ?Conversion Failed/i.test(text)) return "failed-two-point";
  if (/for Two-Point Conversion/i.test(text)) return "two-point";
  if (/Kick\)?\s*$/i.test(text)) return "kick";
  return null;
}

/** "1st quarter" … "4th quarter", then "overtime", "2nd overtime", … */
export function periodName(period) {
  const nth = (n) => `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n] ?? "th"}`;  // periods never reach 21
  return period <= 4 ? `${nth(period)} quarter` : period === 5 ? "overtime" : `${nth(period - 4)} overtime`;
}

/** "Ohio State 24, Iowa 6 · 2:00 - 4th": both scores, away first, and where the game is. */
export function scoreLine(g) {
  return `${score(g)} · ${g.detail}`;
}

/** "Ohio State 24, Iowa 6": both scores, away first. */
const score = (g) => `${nameOf(g.away)} ${g.away.score}, ${nameOf(g.home)} ${g.home.score}`;

/** "Cardinals @ Rams": the game, away first. */
const matchup = (g) => `${nameOf(g.away)} @ ${nameOf(g.home)}`;

// What a notification calls the teams: ESPN's short name ("Cardinals", "Ohio State"), or the abbreviation without one.
const nameOf = (t) => t.name || t.abbr;

const seconds = (clock) => {
  const [m, s] = String(clock ?? "").split(":").map(Number);
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
};
// Between quarters: ESPN's "End of 1st Quarter", or halftime.
const between = (g) => g.state === "in" && /^End of|Halftime/i.test(g.detail ?? "");


const total = (p) => p.awayScore + p.homeScore;
const endName = (period) => (period === 2 ? "Halftime" : `End of the ${periodName(period)}`);

/**
 * The notifications for game g, given how it looked at the last poll (prev; undefined right after a restart) and its
 * memo (start it as {}; the program saves it between polls). g.scoringPlays (js/espn.js fetchScoringPlays) is there
 * when the program fetched them: whenever the score is ahead of the plays it last saw, or a try is pending
 * (needsScoringPlays). The very first look only fills the memo: what already happened before then isn't news.
 * @returns {{ title: string, body: string, tag?: string, icon?: string }[]}
 */
export function gameAlerts(prev, g, memo, now = Date.now()) {
  const sent = new Set(memo.sent);
  const fire = (name) => !sent.has(name) && sent.add(name);
  if (!memo.sent) {
    firstLook(g, memo, sent);
    return [];
  }
  const alerts = [];
  const add = (title, extra, more = {}, at = g) => alerts.push({ title, body: [scoreLine(at), extra].filter(Boolean).join("\n"), ...more });
  // Styled: what happened as the title (shown bold), then the game, then the score ("TD Cardinals" / "Cardinals @
  // Rams" / "Cardinals 7, Rams 0"). Each has its own tag, so it shows as a new notification: a repeated tag only
  // replaces the earlier one, out of sight.
  const styled = (title, t, at, tag) => alerts.push({ title, body: `${matchup(at)}\n${score(at)}`, tag, styled: true, icon: t.logo });

  // A new quarter counts once two polls in a row show it under way: ESPN sometimes reports the next period for a
  // single poll before the quarter has ended, then goes back to "End of 1st". A quarter that ended between polls
  // without us seeing its "End of" status still gets its notification first.
  const underWay = (x) => x?.state === "in" && x.period === g.period && !between(x);
  if (underWay(g) && underWay(prev) && !sent.has(`start-${g.period}`)) {
    if (g.period > 1 && fire(`end-${g.period - 1}`)) add(endName(g.period - 1));
    fire(`start-${g.period}`);
    add(g.period === 1 ? "Kickoff" : `Start of the ${periodName(g.period)}`);
  }

  if (g.scoringPlays) scoringAlerts(g, memo, sent, now, add, styled);

  // One per trip: it resets only once the other team has the ball (possession can drop out between plays).
  if (g.possession && g.possession !== memo.redZoneTeam) memo.redZoneTeam = null;
  if (g.state === "in" && g.redZone && g.possession && !memo.redZoneTeam) {
    memo.redZoneTeam = g.possession;
    const t = g.possession === g.home.id ? g.home : g.away;
    add(`${nameOf(t)} in the red zone`, g.ddText);
  }

  // The 2nd and 4th quarters' clock running past 2:00 (the NFL's two-minute warning, and college's two-minute timeout).
  // Right after a restart (no prev), only if it's still close to 2:00. Not once the quarter is over.
  const is = seconds(g.clock), was = prev?.period === g.period ? seconds(prev.clock) : null;
  if (g.state === "in" && !between(g) && (g.period === 2 || g.period === 4) && is !== null && is <= 120
      && (prev ? was > 120 : is >= 100) && fire(`two-minute-${g.period}`)) {
    add("Two-minute warning");
  }

  if (g.state === "post") {
    if (fire("final")) add("Final");
  } else if (between(g) && fire(`end-${g.period}`)) {
    add(endName(g.period));
  }
  memo.sent = [...sent];
  return alerts;
}

// The first look at a game: everything that already happened counts as sent.
function firstLook(g, memo, sent) {
  const period = g.state === "pre" ? 0 : g.period;
  const ended = g.state === "post" || between(g) ? period : period - 1;
  for (let n = 1; n <= period; n++) sent.add(`start-${n}`);
  for (let n = 1; n <= ended; n++) sent.add(`end-${n}`);
  for (const n of [2, 4]) if (n < period || (n === period && (g.state !== "in" || between(g) || seconds(g.clock) <= 120))) sent.add(`two-minute-${n}`);
  if (g.state === "post") sent.add("final");
  memo.seenTotal = Number(g.away.score) + Number(g.home.score);  // the score its scoring plays have reached
  memo.redZoneTeam = g.redZone ? g.possession : null;
  memo.sent = [...sent];
}

/** Whether the program should fetch g's scoring plays for gameAlerts: the score is ahead of them, or a try is pending. */
export function needsScoringPlays(g, memo) {
  if (!memo.sent) return false;  // the first look sends nothing
  return Number(g.away.score) + Number(g.home.score) !== memo.seenTotal || Object.keys(memo.tries ?? {}).length > 0;
}

// Each scoring play not sent yet; then each touchdown still waiting on its try, which shows up in the touchdown's text.
function scoringAlerts(g, memo, sent, now, add, styled) {
  const plays = g.scoringPlays;
  if (!memo.playsSeen) {
    // The first list since the first look: the plays that started before then (the one before them had left a lower
    // score than the first look saw) were already old news.
    plays.forEach((p, i) => {
      if ((i ? total(plays[i - 1]) : 0) < memo.seenTotal) sent.add(`score:${p.id}`).add(`try:${p.id}`);
    });
    memo.playsSeen = true;
  }
  if (plays.length) memo.seenTotal = total(plays.at(-1));
  const tries = { ...memo.tries };
  for (const p of plays) {
    const t = p.teamId === g.home.id ? g.home : g.away;
    // The score this play left (ESPN's scoreboard can be a moment ahead or behind).
    const at = { ...g, away: { ...g.away, score: String(p.awayScore) }, home: { ...g.home, score: String(p.homeScore) } };
    const tried = classifyTry(p.text);
    if (!sent.has(`score:${p.id}`)) {
      sent.add(`score:${p.id}`);
      if (p.kind === "touchdown") {
        // A try already in comes with it ("TD Cardinals · 2-pt conversion"); otherwise watch for it.
        if (tried) sent.add(`try:${p.id}`);
        else tries[p.id] = now;
        styled(`TD ${nameOf(t)}${TRY_RESULTS[tried] ? ` · ${TRY_RESULTS[tried]}` : ""}`, t, at, `${g.key}:score:${p.id}`);
      } else {
        sent.add(`try:${p.id}`);
        add(`${nameOf(t)} ${SCORE_NAMES[p.kind] ?? "score"}`, p.text, { tag: `${g.key}:score:${p.id}`, icon: t.logo }, at);
      }
    } else if (tries[p.id] !== undefined && (tried || now - tries[p.id] > TRY_GIVE_UP_MS)) {
      // A made extra point is expected, so it's skipped; a missed one, or a 2-point try either way, is news.
      delete tries[p.id];
      sent.add(`try:${p.id}`);
      if (TRY_RESULTS[tried]) styled(`${TRY_RESULTS[tried]} ${nameOf(t)}`, t, at, `${g.key}:try:${p.id}`);
    }
  }
  if (Object.keys(tries).length) memo.tries = tries;
  else delete memo.tries;
}

/**
 * One poll's notifications for a game, as one: shown together they'd stack, and the system often shows only the last.
 * Titles are joined; the body is the score line once, then each one's extra line.
 */
export function mergeAlerts(alerts) {
  if (alerts.length < 2) return alerts[0];
  const scored = alerts.find((a) => a.tag);
  // A styled one (a touchdown or a try) sets the layout: everything that happened, then the game and the new score.
  const styled = alerts.findLast((a) => a.styled);  // the latest, for the latest score
  if (styled) return { title: alerts.map((a) => a.title).join(" · "), body: styled.body, tag: scored.tag, icon: styled.icon };
  const [line] = alerts[0].body.split("\n");
  return {
    title: alerts.map((a) => a.title).join(" · "),
    body: [line, ...alerts.flatMap((a) => a.body.split("\n").slice(1))].join("\n"),
    ...(scored && { tag: scored.tag, icon: scored.icon }),
  };
}


/** The kinds of sample notification the admin's test button can send (sampleAlert), in the order its chooser lists them. */
export const SAMPLE_KINDS = {
  test: "Test", touchdown: "Touchdown", "missed-pat": "Missed PAT", "two-point": "2-pt conversion",
  "failed-two-point": "Failed 2-pt", "field-goal": "Field goal", "red-zone": "Red zone", "two-minute": "Two-minute warning",
  kickoff: "Kickoff", "quarter-start": "Start of quarter", "quarter-end": "End of quarter", halftime: "Halftime", final: "Final",
};

/**
 * A sample notification of one kind for game g, for styling them: a made-up moment in the game (the away team scores,
 * the clock crosses 2:00, the 1st quarter ends...) run through gameAlerts, so it reads exactly like a real one. Null
 * for "test" or a kind it doesn't know.
 */
export function sampleAlert(g, kind) {
  const away = Number(g.away.score) || 0, home = Number(g.home.score) || 0;
  const base = { ...g, state: "in", period: 2, clock: "8:00", detail: "8:00 - 2nd", redZone: false, possession: g.away.id,
    ddText: "1st & 10", scoringPlays: undefined, away: { ...g.away, score: String(away) }, home: { ...g.home, score: String(home) } };
  const at = (period, clock, detail) => ({ ...base, period, clock, detail: detail ?? `${clock} - ${periodName(period).split(" ")[0]}` });
  // Everything already sent but the sample's own event, so only the sample fires.
  const sent = ["start-1", "start-2", "start-3", "start-4", "end-1", "end-2", "end-3", "end-4", "two-minute-2", "two-minute-4", "final"];
  const memo = { sent, seenTotal: away + home, playsSeen: true, redZoneTeam: g.away.id };
  const unsent = (name) => { memo.sent = sent.filter((n) => n !== name); };
  const who = g.away.name ?? g.away.abbr;
  const play = (kind, points, text) => [{ id: "sample", kind, teamId: g.away.id, text, awayScore: away + points, homeScore: home }];
  const tryPending = () => { memo.sent = [...sent, "score:sample"]; memo.tries = { sample: Date.now() }; };
  let prev = base, now;
  switch (kind) {
    case "touchdown":
      now = { ...base, scoringPlays: play("touchdown", 7, `${who} 25 Yd pass (sample Kick)`) };
      break;
    case "missed-pat":
      tryPending();
      now = { ...base, scoringPlays: play("touchdown", 6, `${who} 25 Yd pass (sample PAT failed)`) };
      break;
    case "two-point":
      tryPending();
      now = { ...base, scoringPlays: play("touchdown", 8, `${who} 25 Yd pass (sample Pass to ${who} for Two-Point Conversion)`) };
      break;
    case "failed-two-point":
      tryPending();
      now = { ...base, scoringPlays: play("touchdown", 6, `${who} 25 Yd pass (Two-Point Pass Conversion Failed)`) };
      break;
    case "field-goal":
      now = { ...base, scoringPlays: play("field-goal", 3, `${who} 42 Yd Field Goal (sample)`) };
      break;
    case "red-zone":
      memo.redZoneTeam = null;
      prev = { ...base, possession: g.home.id };
      now = { ...base, redZone: true, ddText: `1st & 10 at ${g.home.abbr} 15` };
      break;
    case "two-minute":
      unsent("two-minute-4");
      prev = at(4, "2:05");
      now = at(4, "2:00");
      break;
    case "kickoff":
      unsent("start-1");
      prev = at(1, "15:00");
      now = at(1, "14:52");
      break;
    case "quarter-start":
      unsent("start-3");
      prev = at(3, "15:00");
      now = at(3, "14:52");
      break;
    case "quarter-end":
      unsent("end-1");
      prev = at(1, "0:04");
      now = at(1, "0:00", "End of 1st Quarter");
      break;
    case "halftime":
      unsent("end-2");
      prev = at(2, "0:04");
      now = at(2, "0:00", "Halftime");
      break;
    case "final":
      unsent("final");
      prev = at(4, "0:04");
      now = { ...at(4, "0:00", "Final"), state: "post" };
      break;
    default:
      return null;
  }
  const alerts = gameAlerts(prev, now, memo);
  if (!alerts.length) return null;
  const sample = mergeAlerts(alerts);
  // Every sample is a new notification, however quickly they're sent.
  return sample.tag ? { ...sample, tag: `${sample.tag}:${Math.random().toString(36).slice(2)}` } : sample;
}

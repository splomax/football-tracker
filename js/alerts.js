// What happened in a game, as notifications: scores (and how each touchdown's try went, and whether a score changed
// the lead), turnovers (from ESPN's play-by-play), turnovers on downs and missed field goals (from how ESPN says each
// drive ended), two-minute
// warnings, and the start and end of each quarter. Every one carries the score. No browser APIs here: it
// runs in the program on Cloudflare (worker/scorekeeper.js), and the tests (worker/alerts.test.js) drive it directly.
//
// Each event has a fixed name: "score:<ESPN's id for the scoring play>", "try:<id>", "start-3", "end-2", "two-minute-4",
// "drive:<id>", "turnover:<play id>", "final". The game's memo lists the names already sent, and the program saves the memo, so after a restart nothing
// is sent twice or lost: whatever hasn't been sent yet still goes out.

const TRY_GIVE_UP_MS = 4 * 60_000;  // after a touchdown, how long to watch for how its try went
const TRY_RESULTS = { "missed-pat": "Missed PAT", "two-point": "2-pt conversion", "failed-two-point": "Failed 2-pt" };
const SCORE_NAMES = { "field-goal": "field goal", safety: "safety" };
const DRIVES_STALE_MS = 60_000;  // drives last seen longer ago than this are caught up silently, not sent
const CALLED_BACK_MS = 10 * 60_000;  // how long after a score or turnover to watch for it being called back

/**
 * Every kind of notification, in the order Notification settings (js/notify-settings.js) list them, grouped. Each notification
 * names its kind; a device gets the kinds it chose (worker/phones.js), or DEFAULT_KINDS. A lead change rides on the
 * score that made it ("TD Cardinals · Lead change") and also lets that score through on its own.
 */
export const NOTIFY_KINDS = [
  ["Scores", { touchdown: "Touchdown", "field-goal": "Field goal", safety: "Safety", "lead-change": "Lead change" }],
  ["After a touchdown", { "missed-pat": "Missed PAT", "two-point": "2-pt conversion", "failed-two-point": "Failed 2-pt" }],
  ["Possession", { turnover: "Interception or lost fumble", downs: "Turnover on downs", "missed-fg": "Missed field goal" }],
  ["Game", { kickoff: "Kickoff", "quarter-start": "Start of a quarter", "quarter-end": "End of a quarter", halftime: "Halftime",
    "two-minute": "Two-minute warning", final: "Final" }],
];

/** What every device gets until it chooses otherwise (js/notify-settings.js). */
export const DEFAULT_KINDS = ["touchdown", "field-goal", "safety", "missed-pat", "two-point", "failed-two-point", "turnover",
  "kickoff", "quarter-start", "quarter-end", "halftime", "two-minute", "final"];

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
// Which quarter just ended, from the words: ESPN's scoreboard can already say period 2 while its detail still reads
// "End of 1st Quarter", which once sent "Halftime" at the start of the 2nd.
const endedPeriod = (g) => (/Halftime/i.test(g.detail) ? 2 : Number(g.detail.match(/^End of (\d)/i)?.[1]) || g.period);


const total = (p) => p.awayScore + p.homeScore;
const endName = (period) => (period === 2 ? "Halftime" : `End of the ${periodName(period)}`);
const endKind = (period) => (period === 2 ? "halftime" : "quarter-end");

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
  const add = (kind, title, extra, more = {}, at = g) => alerts.push({ kind, title, body: [scoreLine(at), extra].filter(Boolean).join("\n"), ...more });
  // Styled: what happened as the title (shown bold), then the game, then the score ("TD Cardinals" / "Cardinals @
  // Rams" / "Cardinals 7, Rams 0"). Each has its own tag, so it shows as a new notification: a repeated tag only
  // replaces the earlier one, out of sight.
  const styled = (kind, title, t, at, tag, more = {}) => alerts.push({ kind, title, body: `${matchup(at)}\n${score(at)}`, tag, styled: true, icon: t.logo, ...more });

  // A new quarter counts once two polls in a row show it under way: ESPN sometimes reports the next period for a
  // single poll before the quarter has ended, then goes back to "End of 1st". A quarter that ended between polls
  // without us seeing its "End of" status still gets its notification first.
  const underWay = (x) => x?.state === "in" && x.period === g.period && !between(x);
  if (underWay(g) && underWay(prev) && !sent.has(`start-${g.period}`)) {
    if (g.period > 1 && fire(`end-${g.period - 1}`)) add(endKind(g.period - 1), endName(g.period - 1));
    fire(`start-${g.period}`);
    g.period === 1 ? add("kickoff", "Kickoff") : add("quarter-start", `Start of the ${periodName(g.period)}`);
  }

  if (g.scoringPlays) scoringAlerts(g, memo, sent, now, add, styled);
  if (g.plays?.length) turnoverAlerts(g, memo, sent, now, styled);
  if (g.drives) driveAlerts(g, memo, sent, now, styled);

  // The 2nd and 4th quarters' clock running past 2:00 (the NFL's two-minute warning, and college's two-minute timeout).
  // Right after a restart (no prev), only if it's still close to 2:00. Not once the quarter is over.
  const is = seconds(g.clock), was = prev?.period === g.period ? seconds(prev.clock) : null;
  if (g.state === "in" && !between(g) && (g.period === 2 || g.period === 4) && is !== null && is <= 120
      && (prev ? was > 120 : is >= 100) && fire(`two-minute-${g.period}`)) {
    add("two-minute", "Two-minute warning");
  }

  if (g.state === "post") {
    if (fire("final")) add("final", "Final");
  } else if (between(g) && fire(`end-${endedPeriod(g)}`)) {
    add(endKind(endedPeriod(g)), endName(endedPeriod(g)));
  }
  memo.sent = [...sent];
  return alerts;
}

// The first look at a game: everything that already happened counts as sent.
function firstLook(g, memo, sent) {
  const period = g.state === "pre" ? 0 : g.period;
  const ended = g.state === "post" ? period : between(g) ? endedPeriod(g) : period - 1;
  for (let n = 1; n <= period; n++) sent.add(`start-${n}`);
  for (let n = 1; n <= ended; n++) sent.add(`end-${n}`);
  for (const n of [2, 4]) if (n < period || (n === period && (g.state !== "in" || between(g) || seconds(g.clock) <= 120))) sent.add(`two-minute-${n}`);
  if (g.state === "post") sent.add("final");
  memo.seenTotal = Number(g.away.score) + Number(g.home.score);  // the score its scoring plays have reached
  memo.sent = [...sent];
}

/** Whether the program should fetch g's scoring plays for gameAlerts: the score is ahead of them, or a try is pending. */
export function needsScoringPlays(g, memo) {
  if (!memo.sent) return false;  // the first look sends nothing
  // (A score called back shows as the scoreboard falling below the plays seen.)
  return Number(g.away.score) + Number(g.home.score) !== memo.seenTotal || Object.keys(memo.tries ?? {}).length > 0;
}

// Each scoring play not sent yet; then each touchdown still waiting on its try, which shows up in the touchdown's text.
// ESPN lists a score as soon as it's called, before it's reviewed, so one can be called back (seen live: an Oklahoma
// State touchdown wiped out by holding). A score sent in the last CALLED_BACK_MS that then leaves the list, with the
// scoreboard down below it too (not just ESPN's list hiccuping), gets a notification saying so.
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
  const tries = { ...memo.tries }, scored = { ...memo.scored };
  const listed = new Set(plays.map((p) => p.id)), scoreNow = Number(g.away.score) + Number(g.home.score);
  for (const [id, s] of Object.entries(scored)) {
    if (now - s.at > CALLED_BACK_MS) { delete scored[id]; continue; }
    if (listed.has(id) || scoreNow >= s.total) continue;
    delete scored[id];
    delete tries[id];
    if (!plays.length) memo.seenTotal = 0;  // the only score, called back
    const t = g[s.side];
    styled(s.kind, `No ${s.kind === "touchdown" ? "TD" : SCORE_NAMES[s.kind] ?? "score"} ${nameOf(t)} · Called back`, t, g, `${g.key}:called-back:${id}`);
  }
  const leader = (p) => (!p || p.awayScore === p.homeScore ? null : p.awayScore > p.homeScore ? "away" : "home");
  for (const [i, p] of plays.entries()) {
    const t = p.teamId === g.home.id ? g.home : g.away;
    // The score this play left (ESPN's scoreboard can be a moment ahead or behind).
    const at = { ...g, away: { ...g.away, score: String(p.awayScore) }, home: { ...g.home, score: String(p.homeScore) } };
    const tried = classifyTry(p.text);
    if (!sent.has(`score:${p.id}`)) {
      sent.add(`score:${p.id}`);
      scored[p.id] = { at: now, kind: p.kind, side: t === g.home ? "home" : "away", total: total(p) };
      // The trailing team going ahead (from a tie doesn't count): for devices that want lead changes, the title says so.
      const before = leader(plays[i - 1]), after = leader(p);
      const lead = (title) => (before && after && before !== after ? { leadChange: true, leadTitle: `${title} · Lead change` } : {});
      if (p.kind === "touchdown") {
        // A try already in comes with it ("TD Cardinals · 2-pt conversion"); otherwise watch for it.
        if (tried) sent.add(`try:${p.id}`);
        else tries[p.id] = now;
        const title = `TD ${nameOf(t)}${TRY_RESULTS[tried] ? ` · ${TRY_RESULTS[tried]}` : ""}`;
        styled("touchdown", title, t, at, `${g.key}:score:${p.id}`, lead(title));
      } else {
        sent.add(`try:${p.id}`);
        const title = `${nameOf(t)} ${SCORE_NAMES[p.kind] ?? "score"}`;
        add(p.kind === "field-goal" ? "field-goal" : "safety", title, p.text, { tag: `${g.key}:score:${p.id}`, icon: t.logo, ...lead(title) }, at);
      }
    } else if (tries[p.id] !== undefined && (tried || now - tries[p.id] > TRY_GIVE_UP_MS)) {
      // A made extra point is expected, so it's skipped; a missed one, or a 2-point try either way, is news, unless
      // it took ESPN so long to say that it's old news.
      const late = now - tries[p.id] > TRY_GIVE_UP_MS;
      delete tries[p.id];
      sent.add(`try:${p.id}`);
      if (TRY_RESULTS[tried] && !late) styled(tried, `${TRY_RESULTS[tried]} ${nameOf(t)}`, t, at, `${g.key}:try:${p.id}`);
    }
  }
  if (Object.keys(tries).length) memo.tries = tries;
  else delete memo.tries;
  if (Object.keys(scored).length) memo.scored = scored;
  else delete memo.scored;
}

// Turnovers, from ESPN's play types (js/espn.js fetchSummary plays): an interception or a lost fumble (a returner's on
// a punt or kickoff too), returned for a touchdown or not, as soon as the play is logged. One wiped out by a penalty is logged as a "Penalty" play, and one
// overturned on review turns into the play it really was ("Sack", "Rush"), so neither counts; one sent and then turned
// into something else (or gone) within CALLED_BACK_MS gets a notification saying it was called back. The first plays
// seen, and plays after a gap with none seen, are caught up silently, as drives are (driveAlerts).
const TURNOVER = /interception|fumble recovery \(opponent\)|opp fumble recovery|fumble return/i;
const isTurnover = (p) => TURNOVER.test(p.type ?? "");

function turnoverAlerts(g, memo, sent, now, styled) {
  const fresh = memo.playsAt !== undefined && now - memo.playsAt <= DRIVES_STALE_MS;
  memo.playsAt = now;
  const byId = new Map(g.plays.map((p) => [p.id, p]));
  const watching = { ...memo.turnovers };  // sent turnovers that could still be called back: id -> { at, side, what }
  for (const [id, w] of Object.entries(watching)) {
    if (now - w.at > CALLED_BACK_MS) { delete watching[id]; continue; }
    if (byId.has(id) && isTurnover(byId.get(id))) continue;
    delete watching[id];
    const t = g[w.side];  // the team that lost it gets it back
    styled("turnover", `${w.what} called back · ${nameOf(t)} ball`, t, g, `${g.key}:turnover-back:${id}`);
  }
  for (const p of g.plays) {
    if (!isTurnover(p) || sent.has(`turnover:${p.id}`)) continue;
    sent.add(`turnover:${p.id}`);
    if (!fresh) continue;
    // Who has it now: the team with the ball after the play (on a punt or kickoff that's the kicking team, which also
    // started it), else the other side.
    const [lost, got] = [g.home, g.away].some((t) => t.id === p.endTeamId)
      ? (p.endTeamId === g.home.id ? [g.away, g.home] : [g.home, g.away])
      : (p.teamId === g.home.id ? [g.home, g.away] : [g.away, g.home]);
    const what = /interception/i.test(p.type) ? "Interception" : "Fumble";
    // Returned for a touchdown: the touchdown's own notification comes with it ("Interception · TD Falcons").
    styled("turnover", p.scoring || /touchdown/i.test(p.type) ? what : `${what} · ${nameOf(got)} ball`, got, g, `${g.key}:turnover:${p.id}`);
    watching[p.id] = { at: now, side: lost === g.home ? "home" : "away", what };
  }
  if (Object.keys(watching).length) memo.turnovers = watching;
  else delete memo.turnovers;
}

// How each drive ended (js/espn.js fetchSummary): a turnover on downs, or a missed field goal. The first drives seen, and drives after a gap with none seen (the program fetches them only for belled games,
// so a bell lit later mustn't bring up old ones), are caught up silently.
const DRIVE_RESULTS = [
  [/^DOWNS$/, "downs", (o, d) => `Turnover on downs · ${nameOf(d)} ball`],
  [/^(MISSED|BLOCKED) FG/, "missed-fg", (o) => `Missed FG ${nameOf(o)}`],
];

function driveAlerts(g, memo, sent, now, styled) {
  const fresh = memo.drivesAt !== undefined && now - memo.drivesAt <= DRIVES_STALE_MS;
  memo.drivesAt = now;
  for (const d of g.drives) {
    if (sent.has(`drive:${d.id}`)) continue;
    sent.add(`drive:${d.id}`);
    const match = DRIVE_RESULTS.find(([re]) => re.test(d.result));
    if (!fresh || !match) continue;
    const [offense, defense] = d.teamId === g.home.id ? [g.home, g.away] : [g.away, g.home];
    const [, kind, title] = match;
    styled(kind, title(offense, defense), kind === "missed-fg" ? offense : defense, g, `${g.key}:drive:${d.id}`);
  }
}

/**
 * The parts of one poll's notification (gameAlerts) that a device choosing `kinds` gets, merged (mergeAlerts), or
 * undefined if none. A score that changed the lead gets through for "lead-change" too, and then says so.
 */
export function forDevice(parts, kinds = DEFAULT_KINDS) {
  const wanted = new Set(kinds);
  const mine = parts.filter((a) => wanted.has(a.kind) || (a.leadChange && wanted.has("lead-change")))
    .map((a) => (a.leadChange && wanted.has("lead-change") ? { ...a, title: a.leadTitle } : a));
  return mine.length ? mergeAlerts(mine) : undefined;
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
  "failed-two-point": "Failed 2-pt", "field-goal": "Field goal", "lead-change": "Lead change", turnover: "Interception",
  downs: "Turnover on downs", "missed-fg": "Missed field goal", "two-minute": "Two-minute warning",
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
  const memo = { sent, seenTotal: away + home, playsSeen: true };
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
    case "lead-change": {
      // The away team, down 3, scores a touchdown.
      const was = { id: "sample-before", kind: "field-goal", teamId: g.home.id, text: "", awayScore: away, homeScore: away + 3 };
      memo.sent = [...sent, "score:sample-before"];
      now = { ...base, home: { ...base.home, score: String(away + 3) },
        scoringPlays: [was, { id: "sample", kind: "touchdown", teamId: g.away.id, text: `${who} 25 Yd pass (sample Kick)`, awayScore: away + 7, homeScore: away + 3 }] };
      prev = now;
      break;
    }
    case "turnover":
      memo.playsAt = Date.now();
      now = { ...base, plays: [{ id: "sample", type: "Pass Interception Return", teamId: g.home.id }] };
      break;
    case "downs":
    case "missed-fg":
      memo.drivesAt = Date.now();
      now = { ...base, drives: [{ id: "sample", teamId: g.home.id, result: { downs: "DOWNS", "missed-fg": "MISSED FG" }[kind] }] };
      break;
    case "field-goal":
      now = { ...base, scoringPlays: play("field-goal", 3, `${who} 42 Yd Field Goal (sample)`) };
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
  const sample = kind === "lead-change" ? forDevice(alerts, ["lead-change"]) : mergeAlerts(alerts);
  // Every sample is a new notification, however quickly they're sent.
  return sample.tag ? { ...sample, tag: `${sample.tag}:${Math.random().toString(36).slice(2)}` } : sample;
}

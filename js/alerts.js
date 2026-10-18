// What happened in a game between two polls, as notifications: scores, trips inside the red zone, two-minute
// warnings, and the start and end of each quarter. Every one carries the game's score. No browser APIs here: it runs
// in the program on Cloudflare (worker/scorekeeper.js), and the tests (worker/alerts.test.js) drive it directly.

const TRY_GIVE_UP_MS = 4 * 60_000;  // after a touchdown, how long to watch for how its try went

const SCORE_KINDS = { 2: "2 points", 3: "field goal", 6: "touchdown", 7: "touchdown", 8: "touchdown" };

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

/** "OSU 24, IOWA 6 · 2:00 - 4th": both scores, away first, and where the game is. */
export function scoreLine(g, nameOf = abbr) {
  return `${score(g, nameOf)} · ${g.detail}`;
}

/** "OSU 24, IOWA 6": both scores, away first. */
const score = (g, nameOf) => `${nameOf(g.away)} ${g.away.score}, ${nameOf(g.home)} ${g.home.score}`;

/** "CHI @ ATL": the game, away first. */
const matchup = (g, nameOf) => `${nameOf(g.away)} @ ${nameOf(g.home)}`;

// What a notification calls the teams. While we try them out, each notification picks one of ESPN's names at random,
// a third of the time each: "Bears" / "Ohio State", "Chicago" / "Ohio State", "Chicago Bears" / "Ohio State Buckeyes".
// A team without that name (as in the tests) gets its abbreviation.
const abbr = (t) => t.abbr;
const NAMINGS = ["name", "location", "fullName"];
function pickNaming() {
  const field = NAMINGS[Math.floor(Math.random() * NAMINGS.length)];
  return (t) => t[field] || t.abbr;
}

const seconds = (clock) => {
  const [m, s] = String(clock ?? "").split(":").map(Number);
  return Number.isFinite(m) && Number.isFinite(s) ? m * 60 + s : null;
};
// Between quarters: ESPN's "End of 1st Quarter", or halftime.
const between = (g) => g.state === "in" && /^End of|Halftime/i.test(g.detail ?? "");

/**
 * The notifications for game g, given how it looked at the last poll (prev; undefined the first time it's seen) and
 * memo, an object kept per game between calls (start it as {}). The first look only fills memo: something already
 * under way when the page opens isn't news.
 * @returns {{ title: string, body: string, tag?: string, icon?: string }[]}
 */
export function gameAlerts(prev, g, memo, now = Date.now()) {
  if (!prev) {
    memo.started = g.state === "pre" ? 0 : g.period;
    memo.ended = g.state === "post" ? Infinity : between(g) ? g.period : g.period - 1;
    memo.redZoneTeam = g.redZone ? g.possession : null;
    return [];
  }
  const alerts = [];
  const nameOf = pickNaming();
  const add = (title, extra, more = {}) => alerts.push({ title, body: [scoreLine(g, nameOf), extra].filter(Boolean).join("\n"), ...more });
  const endOf = (period) => {
    memo.ended = period;
    add(period === 2 ? "Halftime" : `End of the ${periodName(period)}`);
  };

  // A new quarter counts once two polls in a row show it under way: ESPN sometimes reports the next period for a
  // single poll before the quarter has ended, then goes back to "End of 1st". A quarter that ended between polls
  // without us seeing its "End of" status still gets its notification first.
  const underWay = (x) => x.state === "in" && x.period === g.period && !between(x);
  if (underWay(g) && underWay(prev) && g.period > memo.started) {
    if (g.period > 1 && memo.ended < g.period - 1) endOf(g.period - 1);
    memo.started = g.period;
    add(g.period === 1 ? "Kickoff" : `Start of the ${periodName(g.period)}`);
  }

  // The scoring play: looked up by the score when the scoreboard's last play isn't it yet (worker/scorekeeper.js), else
  // the last play if it scored, else nothing rather than the wrong play. After a touchdown it also says how the try
  // went: ESPN adds "(J.Bates Kick)", "(J.Bates PAT failed)" and so on to the touchdown's play.
  const play = g.scoringPlay ?? (g.lastPlayScored ? g.lastPlay : undefined);
  // Styled: the game, then what happened, then the new score ("CHI @ ATL" / "TD CHI" / "CHI 7, ATL 0"). Each score gets
  // its own tag, so it shows as a new notification: a repeated tag only replaces the earlier one, out of sight.
  const styled = (headline, t) => {
    const alert = { title: matchup(g, nameOf), body: `${headline}\n${score(g, nameOf)}`, tag: `${g.key}:score:${t.id}:${now}`, headline, score: score(g, nameOf), icon: t.logo };
    alerts.push(alert);
    return alert;
  };
  let touchdown;  // this poll's touchdown notification, which a try seen in the same poll joins
  for (const side of ["away", "home"]) {
    const gained = Number(g[side].score) - Number(prev[side].score);
    if (gained <= 0) continue;
    const t = g[side];
    const tryFor = memo.pendingTry?.team === t.id;
    if (memo.pendingTry && !tryFor) memo.pendingTry = null;  // the other team scored: that try is long over
    if (gained === 1) {
      // A made extra point is expected, so it's skipped; a missed one is the news (below).
      if (tryFor) memo.pendingTry = null;
    } else if (gained === 2 && tryFor) {
      memo.pendingTry = null;
      styled(`2-pt conversion ${nameOf(t)}`, t);
    } else if (SCORE_KINDS[gained] === "touchdown") {
      // +6 waits for its try; +7 already has the extra point; +8 had the 2-point conversion.
      touchdown = styled(gained === 8 ? `TD ${nameOf(t)} · 2-pt conversion` : `TD ${nameOf(t)}`, t);
      if (gained === 6) memo.pendingTry = { team: t.id, at: now };
    } else {
      add(`${nameOf(t)} ${SCORE_KINDS[gained] ?? `+${gained}`}`, play, { tag: `${g.key}:score:${t.id}:${now}`, icon: t.logo });
    }
  }

  // A touchdown whose try failed: the score doesn't move, so the touchdown's play says so (or, after a while, nothing will).
  if (memo.pendingTry) {
    const t = memo.pendingTry.team === g.home.id ? g.home : g.away;
    const result = classifyTry(play);
    const missed = { "missed-pat": "Missed PAT", "failed-two-point": "Failed 2-pt" }[result];
    if (now - memo.pendingTry.at > TRY_GIVE_UP_MS) {
      memo.pendingTry = null;
    } else if (missed && touchdown) {
      memo.pendingTry = null;
      touchdown.headline = `${touchdown.headline} · ${missed}`;
      touchdown.body = `${touchdown.headline}\n${touchdown.score}`;
    } else if (missed) {
      memo.pendingTry = null;
      styled(`${missed} ${nameOf(t)}`, t);
    }
  }

  // One per trip: it resets only once the other team has the ball (possession can drop out between plays).
  if (g.possession && g.possession !== memo.redZoneTeam) memo.redZoneTeam = null;
  if (g.state === "in" && g.redZone && g.possession && !memo.redZoneTeam) {
    memo.redZoneTeam = g.possession;
    const t = g.possession === g.home.id ? g.home : g.away;
    add(`${nameOf(t)} in the red zone`, g.ddText);
  }

  // The 2nd and 4th quarters' clock running past 2:00 (the NFL's two-minute warning, and college's two-minute timeout).
  const was = seconds(prev.clock), is = seconds(g.clock);
  // Not once the quarter is over: its clock reaching 0:00 between polls isn't a warning.
  if (g.state === "in" && !between(g) && (g.period === 2 || g.period === 4) && prev.period === g.period && was > 120 && is !== null && is <= 120) {
    add("Two-minute warning");
  }

  if (g.state === "post" && memo.ended !== Infinity) {
    memo.ended = Infinity;
    add("Final");
  } else if (between(g) && memo.ended < g.period) {
    endOf(g.period);
  }
  return alerts;
}

/**
 * One poll's notifications for a game, as one: shown together they'd stack, and the system often shows only the last.
 * Titles are joined; the body is the score line once, then each one's extra line.
 */
export function mergeAlerts(alerts) {
  if (alerts.length < 2) return alerts[0];
  const scored = alerts.find((a) => a.tag);
  // A styled one (a touchdown or a try) sets the layout: the game, everything that happened, the new score.
  const styled = alerts.find((a) => a.headline);
  if (styled) {
    const happened = alerts.map((a) => a.headline ?? a.title).join(" · ");
    return { title: styled.title, body: `${happened}\n${styled.score}`, tag: scored.tag, icon: styled.icon };
  }
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
    ddText: "1st & 10", lastPlayScored: false, scoringPlay: undefined, away: { ...g.away, score: String(away) }, home: { ...g.home, score: String(home) } };
  const at = (period, clock, detail) => ({ ...base, period, clock, detail: detail ?? `${clock} - ${periodName(period).split(" ")[0]}` });
  const memo = { started: 2, ended: 1, redZoneTeam: g.away.id };  // nothing else pending, so only the sample fires
  let prev = base, now;
  switch (kind) {
    case "touchdown":
      now = { ...base, away: { ...base.away, score: String(away + 7) }, scoringPlay: `${g.away.name ?? g.away.abbr} 25 Yd pass (sample)` };
      break;
    case "missed-pat":
    case "failed-two-point":
      // The touchdown came a poll earlier; its play now says the try failed.
      memo.pendingTry = { team: g.away.id, at: Date.now() };
      prev = now = { ...base, scoringPlay: `${g.away.name ?? g.away.abbr} 25 Yd pass (${kind === "missed-pat" ? "sample PAT failed" : "Two-Point Pass Conversion Failed"})` };
      break;
    case "two-point":
      memo.pendingTry = { team: g.away.id, at: Date.now() };
      now = { ...base, away: { ...base.away, score: String(away + 2) } };
      break;
    case "field-goal":
      now = { ...base, away: { ...base.away, score: String(away + 3) }, scoringPlay: `${g.away.name ?? g.away.abbr} 42 Yd Field Goal (sample)` };
      break;
    case "red-zone":
      memo.redZoneTeam = null;
      prev = { ...base, possession: g.home.id };
      now = { ...base, redZone: true, ddText: `1st & 10 at ${g.home.abbr} 15` };
      break;
    case "two-minute":
      Object.assign(memo, { started: 4, ended: 3 });
      prev = at(4, "2:05");
      now = at(4, "2:00");
      break;
    case "kickoff":
      Object.assign(memo, { started: 0, ended: 0 });
      prev = at(1, "15:00");
      now = at(1, "14:52");
      break;
    case "quarter-start":
      Object.assign(memo, { started: 2, ended: 2 });
      prev = at(3, "15:00");
      now = at(3, "14:52");
      break;
    case "quarter-end":
      Object.assign(memo, { started: 1, ended: 0 });
      prev = at(1, "0:04");
      now = at(1, "0:00", "End of 1st Quarter");
      break;
    case "halftime":
      prev = at(2, "0:04");
      now = at(2, "0:00", "Halftime");
      break;
    case "final":
      Object.assign(memo, { started: 4, ended: 3 });
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

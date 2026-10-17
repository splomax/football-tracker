// What happened in a game between two polls, as notifications: scores, trips inside the red zone, two-minute
// warnings, and the start and end of each quarter. Every one carries the game's score. No browser APIs here, so the
// admin's desktop notifications (worker/admin.js) and tests (worker/alerts.test.js) share it.

const SCORE_MERGE_MS = 90_000;  // a touchdown's extra point inside this updates the touchdown's notification quietly

const SCORE_KINDS = { 1: "extra point", 2: "2 points", 3: "field goal", 6: "touchdown", 7: "touchdown", 8: "touchdown" };

/** "1st quarter" … "4th quarter", then "overtime", "2nd overtime", … */
export function periodName(period) {
  const nth = (n) => `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n] ?? "th"}`;  // periods never reach 21
  return period <= 4 ? `${nth(period)} quarter` : period === 5 ? "overtime" : `${nth(period - 4)} overtime`;
}

/** "OSU 24, IOWA 6 · 2:00 - 4th": both scores, away first, and where the game is. */
export function scoreLine(g) {
  return `${g.away.abbr} ${g.away.score}, ${g.home.abbr} ${g.home.score} · ${g.detail}`;
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
 * @returns {{ title: string, body: string, tag?: string, silent?: boolean }[]}
 */
export function gameAlerts(prev, g, memo, now = Date.now()) {
  if (!prev) {
    memo.started = g.state === "pre" ? 0 : g.period;
    memo.ended = g.state === "post" ? Infinity : between(g) ? g.period : g.period - 1;
    memo.redZoneTeam = g.redZone ? g.possession : null;
    return [];
  }
  const alerts = [];
  const add = (title, extra, more = {}) => alerts.push({ title, body: [scoreLine(g), extra].filter(Boolean).join("\n"), ...more });
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

  for (const side of ["away", "home"]) {
    const gained = Number(g[side].score) - Number(prev[side].score);
    if (gained <= 0) continue;
    const t = g[side];
    const quiet = now - (memo.scoredAt?.[t.id] ?? -Infinity) < SCORE_MERGE_MS;
    memo.scoredAt = { ...memo.scoredAt, [t.id]: now };
    add(`${t.abbr} ${SCORE_KINDS[gained] ?? `+${gained}`}`, g.lastPlay, { tag: `${g.key}:score:${t.id}`, silent: quiet });
  }

  // One per trip: it resets only once the other team has the ball (possession can drop out between plays).
  if (g.possession && g.possession !== memo.redZoneTeam) memo.redZoneTeam = null;
  if (g.state === "in" && g.redZone && g.possession && !memo.redZoneTeam) {
    memo.redZoneTeam = g.possession;
    const t = g.possession === g.home.id ? g.home : g.away;
    add(`${t.abbr} in the red zone`, g.ddText);
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
  const [line] = alerts[0].body.split("\n");
  const scored = alerts.find((a) => a.tag);
  return {
    title: alerts.map((a) => a.title).join(" · "),
    body: [line, ...alerts.flatMap((a) => a.body.split("\n").slice(1))].join("\n"),
    ...(scored && { tag: scored.tag, silent: alerts.every((a) => a.silent) }),
  };
}


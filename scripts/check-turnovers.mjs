// Replays finished games' play-by-play through the turnover notifications (js/alerts.js turnoverAlerts), one play at
// a time, and prints what each game would have sent next to ESPN's own turnover drive results, to check detection.
//
// Usage: node scripts/check-turnovers.mjs [league:eventId ...]   (default: today's finished NFL and college games)

import { fetchSummary, fetchGames } from "../js/espn.js";
import { gameAlerts } from "../js/alerts.js";

const keys = process.argv.slice(2).length ? process.argv.slice(2)
  : (await Promise.all(["nfl", "cfb"].map(fetchGames))).flat().filter((g) => g.state === "post").map((g) => g.key);
const games = Object.fromEntries((await Promise.all(["nfl", "cfb"].map(fetchGames))).flat().map((g) => [g.key, g]));
for (const key of keys) {
  const g = games[key] ?? { key, away: { id: "?", abbr: "away", score: "0" }, home: { id: "?", abbr: "home", score: "0" } };
  const { plays, drives } = await fetchSummary(g);
  const memo = {};
  const at = (n) => ({ ...g, state: "in", detail: "", plays: plays.slice(0, n) });
  gameAlerts(undefined, at(0), memo, 0);
  const sent = [];
  for (let n = 1; n <= plays.length; n++) {
    for (const a of gameAlerts(at(n - 1), at(n), memo, n * 10_000)) if (a.kind === "turnover") sent.push(a.title);
  }
  const espn = drives.filter((d) => /^(INT|FUMBLE)/.test(d.result)).map((d) => d.result);
  console.log(`${g.away.abbr} @ ${g.home.abbr} (${key})\n  sent: ${sent.join(" | ") || "none"}\n  ESPN drives: ${espn.join(", ") || "none"}`);
}

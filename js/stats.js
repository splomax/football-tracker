// Stats mode (?stats-mode-beta, for now): each live game's leading offensive player per team, and more detailed stats
// on request, from ESPN's game detail (one request per live game on the board, at most every REFRESH_MS). js/board.js
// draws them; this keeps the latest per game and asks for a redraw when new ones arrive.

export const STATS_BETA = new URLSearchParams(location.search).has("stats-mode-beta");
const REFRESH_MS = 30_000;
const SUMMARY = { cfb: "college-football", nfl: "nfl" };

const cache = new Map();  // game key -> { at, stats }
const loading = new Set();

/** The latest stats for live game g, fetching fresh ones in the background when they're old; onNew redraws. */
export function statsFor(g, onNew) {
  const hit = cache.get(g.key);
  if ((!hit || Date.now() - hit.at > REFRESH_MS) && !loading.has(g.key)) {
    loading.add(g.key);
    fetchStats(g)
      .then((stats) => { cache.set(g.key, { at: Date.now(), stats }); onNew(); })
      .catch((err) => console.error("stats", g.key, err))
      .finally(() => loading.delete(g.key));
  }
  return hit?.stats ?? null;
}

async function fetchStats(g) {
  const [league, id] = g.key.split(":");
  const d = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/${SUMMARY[league]}/summary?event=${id}`)).json();
  const side = (t) => {
    const cats = Object.fromEntries((d.leaders?.find((l) => String(l.team?.id) === String(t.id))?.leaders ?? [])
      .map((c) => [c.name, player(c.leaders?.[0])]));
    const box = Object.fromEntries((d.boxscore?.teams?.find((b) => String(b.team?.id) === String(t.id))?.statistics ?? [])
      .map((s) => [s.name, s.displayValue]));
    const pass = cats.passingYards, rush = cats.rushingYards, rec = cats.receivingYards;
    return { pass, rush, rec, box, top: leading([pass, rush, rec]) };
  };
  return { away: side(g.away), home: side(g.home) };
}

// One leader: { name: "Purdy", value: "18/23, 249 YDS, 1 TD", yds, td, int }.
function player(l) {
  if (!l?.athlete) return null;
  const v = l.displayValue ?? "";
  const n = (label) => Number(v.match(new RegExp(`(-?\\d+) ${label}\\b`))?.[1] ?? 0);
  return { name: (l.athlete.shortName ?? l.athlete.displayName ?? "").replace(/^\S+\.\s+/, ""), value: v, yds: n("YDS"), td: n("TD"), int: n("INT") };
}

// A team's leading offensive player: its passer, rusher or receiver with the most yards (a passer's count half, since
// passing yards come easier), plus 20 a touchdown and minus 20 an interception.
function leading(players) {
  const worth = (p, i) => (i === 0 ? p.yds / 2 : p.yds) + 20 * p.td - 20 * p.int;
  return players.map((p, i) => p && { p, w: worth(p, i) }).filter(Boolean).sort((a, b) => b.w - a.w)[0]?.p ?? null;
}

/** "Purdy 249 yds 1 TD" */
export const short = (p) => [p.name, `${p.yds} yds`, p.td && `${p.td} TD`, p.int && `${p.int} INT`].filter(Boolean).join(" ");

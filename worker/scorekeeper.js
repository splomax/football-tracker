// The program on Cloudflare that fetches the scores and works out the notifications: it asks ESPN for both leagues,
// keeps the latest games, compares each game with the last update to see what's news (js/alerts.js), and keeps the
// recent notifications, numbered, for the admin's pages (GET /api/games, worker/handler.js). It lives in one Durable
// Object (ScoreKeeper, worker/index.js), so there's a single copy; this file is plain code so Node tests can drive it
// (worker/scorekeeper.test.js).
//
// It works only when someone could want it (nextWake), which keeps it inside Cloudflare's free plan: every POLL_MS while
// an admin page has asked within IDLE_MS, or while a phone has a lit bell on a game that's live or starts within
// SOON_MS; every IDLE_CHECK_MS while phones have bells on later games (to notice kickoffs); otherwise not at all.

import { fetchGames, fetchScoringPlay, confNames } from "../js/espn.js";
import { gameAlerts, mergeAlerts, scoreLine, sampleAlert } from "../js/alerts.js";

export const POLL_MS = 10_000;
export const IDLE_MS = 2 * 60_000;
export const SOON_MS = 15 * 60_000;
export const IDLE_CHECK_MS = 15 * 60_000;
const KEEP_ALERTS = 200;  // the most recent notifications kept for pages to catch up on

export class ScoreKeeper {
  /** @param {{ fetchGames?: typeof fetchGames, fetchScoringPlay?: typeof fetchScoringPlay, now?: () => number }} [deps]  stand-ins for tests */
  constructor(deps = {}) {
    this.fetch = deps.fetchGames ?? fetchGames;
    this.fetchScoringPlay = deps.fetchScoringPlay ?? fetchScoringPlay;
    this.now = deps.now ?? Date.now;
    this.games = { cfb: [], nfl: [] };
    this.last = new Map();   // game key -> the game at the last update
    this.memos = new Map();  // game key -> what js/alerts.js remembers about it between updates
    this.alerts = [];        // { id, key, title, body, tag?, icon?, test?, at }, oldest first (test: from the test button)
    this.nextId = 1;
    this.polledAt = -Infinity;  // never
    this.askedAt = -Infinity;
  }

  /**
   * Fetch both leagues and note what's news in each game. A league that fails (or comes back empty, as ESPN now and
   * then does) keeps its last games.
   */
  async poll() {
    const now = this.now();
    this.polledAt = now;
    await Promise.all(Object.keys(this.games).map(async (league) => {
      let games;
      try {
        games = await this.fetch(league);
      } catch (err) {
        console.error(league, err);
        return;
      }
      if (!games.length && this.games[league].length) return;
      this.games[league] = games;
      for (const g of games) {
        if (!this.memos.has(g.key)) this.memos.set(g.key, {});
        await this.findScoringPlay(this.last.get(g.key), g, this.memos.get(g.key));
        const news = gameAlerts(this.last.get(g.key), g, this.memos.get(g.key), now);
        this.last.set(g.key, g);
        if (news.length) this.add({ key: g.key, ...mergeAlerts(news) });  // one notification per game per update
      }
    }));
  }

  // When the score changed but the scoreboard's last play isn't the scoring one (ESPN updates the score first), look
  // the scoring play up by the new score, for the notification's description (js/alerts.js). While a touchdown's try
  // is pending, look every time: a missed try doesn't move the score, only the touchdown's play says so.
  async findScoringPlay(prev, g, memo) {
    if (!prev) return;
    const changed = g.away.score !== prev.away.score || g.home.score !== prev.home.score;
    if (!memo?.pendingTry && (!changed || g.lastPlayScored)) return;
    try {
      g.scoringPlay = (await this.fetchScoringPlay(g)) ?? undefined;
    } catch (err) {
      console.error("scoring play", g.key, err);
    }
  }

  add(alert) {
    this.alerts.push({ id: this.nextId++, at: this.now(), ...alert });
    if (this.alerts.length > KEEP_ALERTS) this.alerts.splice(0, this.alerts.length - KEEP_ALERTS);
  }

  /**
   * A page asking for the games, and the notifications after the last one it saw (since; null for a page just
   * opening, which gets none of the old ones). Fetches first if the last fetch is older than POLL_MS.
   */
  async ask(since = null) {
    this.askedAt = this.now();
    if (this.now() - this.polledAt >= POLL_MS) await this.poll();
    return {
      games: this.games,
      confNames: { ...confNames },
      alerts: since == null ? [] : this.alerts.filter((a) => a.id > since),
      cursor: this.nextId - 1,  // the newest notification's number, for the page's next ask
    };
  }

  /**
   * The admin's test button: a notification for this game, sent the same way as real ones (to lit bells only): a sample of
   * `kind` (js/alerts.js SAMPLE_KINDS, for styling them) or, by default, a plain test. Returns it (the Durable Object
   * also pushes it to phones, worker/scorekeeper-object.js), or null for a game it doesn't know.
   */
  test(key, kind = "test") {
    const g = [...this.games.cfb, ...this.games.nfl].find((x) => x.key === key);
    if (!g) return null;
    const sample = sampleAlert(g, kind) ?? { title: "Test notification", body: `${scoreLine(g)}\nSent through the Game Tracker server` };
    this.add({ key, ...sample, test: true });
    return this.alerts.at(-1);
  }

  /** Whether a page asked within IDLE_MS. */
  get watched() {
    return this.now() - this.askedAt < IDLE_MS;
  }

  /**
   * How long until the next fetch, or null for none: POLL_MS while watched or while a phone's lit bell is on a game
   * that's live or starts within SOON_MS; IDLE_CHECK_MS while phones' bells are on later games (or games it hasn't
   * fetched yet); null when no phone has a bell on a game still to come.
   * @param {{ bells: string[] }[]} phones
   */
  nextWake(phones) {
    if (this.watched) return POLL_MS;
    const bells = new Set(phones.flatMap((p) => p.bells));
    if (!bells.size) return null;
    // Just started (after a deploy, or Cloudflare unloading it while idle), it knows no games yet: fetch right away.
    if (this.polledAt === -Infinity) return 0;
    const known = [...this.games.cfb, ...this.games.nfl].filter((g) => bells.has(g.key));
    const now = this.now();
    if (known.some((g) => g.state === "in" || (g.state === "pre" && new Date(g.date) - now < SOON_MS))) return POLL_MS;
    // Later games, or bells on games ESPN doesn't list (yet, or any more): look again now and then.
    return known.length < bells.size || known.some((g) => g.state === "pre") ? IDLE_CHECK_MS : null;
  }

  /** The notifications after `id`, for sending to phones. */
  since(id) {
    return this.alerts.filter((a) => a.id > id);
  }
}

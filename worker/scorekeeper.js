// The program on Cloudflare that fetches the scores and works out the notifications: it asks ESPN for both leagues,
// keeps the latest games, compares each game with the last update to see what's news (js/alerts.js), and keeps the
// recent notifications, numbered, for the admin's pages (GET /api/games, worker/handler.js). It lives in one Durable
// Object (ScoreKeeper, worker/index.js), so there's a single copy; this file is plain code so Node tests can drive it
// (worker/scorekeeper.test.js).
//
// It only works while someone is watching: every POLL_MS while an admin page has asked within IDLE_MS, then it stops,
// which keeps it inside Cloudflare's free plan. The next ask starts it again.

import { fetchGames, confNames } from "../js/espn.js";
import { gameAlerts, mergeAlerts, scoreLine } from "../js/alerts.js";

export const POLL_MS = 10_000;
export const IDLE_MS = 2 * 60_000;
const KEEP_ALERTS = 200;  // the most recent notifications kept for pages to catch up on

export class ScoreKeeper {
  /** @param {{ fetchGames?: typeof fetchGames, now?: () => number }} [deps]  stand-ins for tests */
  constructor(deps = {}) {
    this.fetch = deps.fetchGames ?? fetchGames;
    this.now = deps.now ?? Date.now;
    this.games = { cfb: [], nfl: [] };
    this.last = new Map();   // game key -> the game at the last update
    this.memos = new Map();  // game key -> what js/alerts.js remembers about it between updates
    this.alerts = [];        // { id, key, title, body, tag?, silent?, forced?, at }, oldest first
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
        const news = gameAlerts(this.last.get(g.key), g, this.memos.get(g.key), now);
        this.last.set(g.key, g);
        if (news.length) this.add({ key: g.key, ...mergeAlerts(news) });  // one notification per game per update
      }
    }));
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

  /** The admin's test button: a notification for this game, sent the same way as real ones, bell or not. */
  test(key) {
    const g = [...this.games.cfb, ...this.games.nfl].find((x) => x.key === key);
    if (!g) return false;
    this.add({ key, title: "Test notification", body: `${scoreLine(g)}\nSent through the Game Tracker server`, forced: true });
    return true;
  }

  /** Whether to keep going: a page asked within IDLE_MS. */
  get watched() {
    return this.now() - this.askedAt < IDLE_MS;
  }
}

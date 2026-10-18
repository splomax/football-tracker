// The backend's game feed: polls ESPN, keeps the latest games, and works out what's news in each one (js/alerts.js),
// keeping recent notifications for the pages to pick up. Lives in one Durable Object (GameHub, worker/index.js), so
// there's a single copy of the state; this file is plain logic so Node tests can drive it (worker/hub.test.js).
//
// It polls only while someone is using it: every POLL_MS while a page has asked for games within IDLE_MS, then it
// stops, which keeps it inside Cloudflare's free plan. (Phone push will need it running through games regardless.)

import { fetchGames, confNames } from "../js/espn.js";
import { gameAlerts, mergeAlerts, scoreLine } from "../js/alerts.js";

export const POLL_MS = 10_000;
export const IDLE_MS = 2 * 60_000;
const KEEP_ALERTS = 200;  // the most recent notifications kept for pages to catch up on

export class Hub {
  /** @param {{ fetchGames?: typeof fetchGames, now?: () => number }} [deps]  stand-ins for tests */
  constructor(deps = {}) {
    this.fetch = deps.fetchGames ?? fetchGames;
    this.now = deps.now ?? Date.now;
    this.games = { cfb: [], nfl: [] };
    this.last = new Map();   // game key -> the game at the last poll
    this.memos = new Map();  // game key -> js/alerts.js's memo
    this.alerts = [];        // { id, key, title, body, tag?, silent?, forced?, at }, oldest first
    this.nextId = 1;
    this.polledAt = -Infinity;  // never
    this.askedAt = -Infinity;
  }

  /** Fetch both leagues and note what changed. A league that fails (or comes back empty) keeps its last games. */
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
      if (!games.length && this.games[league].length) return;  // ESPN's occasional empty week
      this.games[league] = games;
      for (const g of games) {
        if (!this.memos.has(g.key)) this.memos.set(g.key, {});
        const news = gameAlerts(this.last.get(g.key), g, this.memos.get(g.key), now);
        this.last.set(g.key, g);
        if (news.length) this.add({ key: g.key, ...mergeAlerts(news) });
      }
    }));
  }

  add(alert) {
    this.alerts.push({ id: this.nextId++, at: this.now(), ...alert });
    if (this.alerts.length > KEEP_ALERTS) this.alerts.splice(0, this.alerts.length - KEEP_ALERTS);
  }

  /**
   * A page asking for the games. Polls first if the last poll is stale (the hub may have been idle). since: the last
   * alert id the page has seen; null for a page just starting, which gets none of the old ones.
   */
  async feed(since) {
    this.askedAt = this.now();
    if (this.now() - this.polledAt >= POLL_MS) await this.poll();
    const cursor = this.nextId - 1;
    return {
      games: this.games,
      confNames: { ...confNames },
      alerts: since == null ? [] : this.alerts.filter((a) => a.id > since),
      cursor,
    };
  }

  /** The admin's test button: a notification for this game through the same path as real ones, bell or not. */
  test(key) {
    const g = [...this.games.cfb, ...this.games.nfl].find((x) => x.key === key);
    if (!g) return false;
    this.add({ key, title: "Test notification", body: `${scoreLine(g)}\nSent through the backend`, forced: true });
    return true;
  }

  /** Whether to keep polling: someone asked within IDLE_MS. */
  get active() {
    return this.now() - this.askedAt < IDLE_MS;
  }
}

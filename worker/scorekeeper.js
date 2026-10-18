// The program on Cloudflare that fetches the scores: it asks ESPN for both leagues and keeps the latest games for the
// admin's pages (GET /api/games, worker/handler.js). It lives in one Durable Object (ScoreKeeper, worker/index.js), so
// there's a single copy; this file is plain code so Node tests can drive it (worker/scorekeeper.test.js).
//
// It only works while someone is watching: every POLL_MS while an admin page has asked within IDLE_MS, then it stops,
// which keeps it inside Cloudflare's free plan. The next ask starts it again.

import { fetchGames, confNames } from "../js/espn.js";

export const POLL_MS = 10_000;
export const IDLE_MS = 2 * 60_000;

export class ScoreKeeper {
  /** @param {{ fetchGames?: typeof fetchGames, now?: () => number }} [deps]  stand-ins for tests */
  constructor(deps = {}) {
    this.fetch = deps.fetchGames ?? fetchGames;
    this.now = deps.now ?? Date.now;
    this.games = { cfb: [], nfl: [] };
    this.polledAt = -Infinity;  // never
    this.askedAt = -Infinity;
  }

  /** Fetch both leagues. One that fails (or comes back empty, as ESPN now and then does) keeps its last games. */
  async poll() {
    this.polledAt = this.now();
    await Promise.all(Object.keys(this.games).map(async (league) => {
      try {
        const games = await this.fetch(league);
        if (games.length || !this.games[league].length) this.games[league] = games;
      } catch (err) {
        console.error(league, err);
      }
    }));
  }

  /** A page asking for the games. Fetches first if the last fetch is older than POLL_MS (it may have been idle). */
  async ask() {
    this.askedAt = this.now();
    if (this.now() - this.polledAt >= POLL_MS) await this.poll();
    return { games: this.games, confNames: { ...confNames } };
  }

  /** Whether to keep going: a page asked within IDLE_MS. */
  get watched() {
    return this.now() - this.askedAt < IDLE_MS;
  }
}

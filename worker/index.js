// Cloudflare Worker entry point: the site and its admin API (handler.js), plus ScoreKeeper, the Durable Object that runs
// the program fetching the scores (scorekeeper.js). admin.js is bundled as text (see rules in wrangler.toml), not run here.

import code from "./admin.js";
import { handle } from "./handler.js";
import { ScoreKeeper as Keeper, POLL_MS } from "./scorekeeper.js";

export default {
  fetch: (request, env) => handle(request, env, code),
};

// One instance (handler.js asks for it by name), so every admin page sees the same games. While pages keep asking, an
// alarm fetches the scores every POLL_MS; once nobody has asked for a while (keeper.watched), it lets the alarm lapse.
export class ScoreKeeper {
  constructor(ctx) {
    this.ctx = ctx;
    this.keeper = new Keeper();
  }

  async fetch() {
    const body = await this.keeper.ask();
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    return Response.json(body);
  }

  async alarm() {
    if (!this.keeper.watched) return;
    await this.keeper.poll();
    await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }
}

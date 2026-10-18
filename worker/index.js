// Cloudflare Worker entry point: the site and its admin API (handler.js), plus GameHub, the Durable Object that runs the
// backend's game feed (hub.js). admin.js is bundled as text (see rules in wrangler.toml), not run here.

import code from "./admin.js";
import { handle } from "./handler.js";
import { Hub, POLL_MS } from "./hub.js";

export default {
  fetch: (request, env) => handle(request, env, code),
};

// One instance (handler.js asks for it by name), so every page sees the same games and notifications. While pages keep
// asking, an alarm polls ESPN every POLL_MS; once nobody has asked for a while (hub.active), it lets the alarm lapse.
export class GameHub {
  constructor(ctx) {
    this.ctx = ctx;
    this.hub = new Hub();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/feed") {
      const since = url.searchParams.get("since");
      const body = await this.hub.feed(since ? Number(since) : null);
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      return Response.json(body);
    }
    if (url.pathname === "/test" && request.method === "POST") {
      const { key } = await request.json();
      return this.hub.test(key) ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    if (!this.hub.active) return;
    await this.hub.poll();
    await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }
}

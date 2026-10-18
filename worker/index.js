// Cloudflare Worker entry point: the site and its admin API (handler.js), plus ScoreKeeper, the Durable Object that runs
// the program fetching the scores and working out the notifications (scorekeeper.js). admin.js is bundled as text (see rules in wrangler.toml), not run here.

import code from "./admin.js";
import { handle } from "./handler.js";
import { ScoreKeeper as Keeper, POLL_MS } from "./scorekeeper.js";
import { sendToPhones } from "./phones.js";

const PHONE_TEST_DELAY_MS = 5000;  // a test reaches phones a few seconds late, time to lock the phone and see it arrive

export default {
  fetch: (request, env) => handle(request, env, code),
};

// One instance (handler.js asks for it by name), so every admin page sees the same games and notifications. While pages
// keep asking, an alarm fetches the scores every POLL_MS; once nobody has asked for a while (keeper.watched), it lets
// the alarm lapse. GET /?since=<n>: the games and notifications; POST /test { key }: a test notification.
export class ScoreKeeper {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.keeper = new Keeper();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/test") {
      const { key } = await request.json();
      const alert = this.keeper.test(key);
      if (!alert) return Response.json({ ok: false }, { status: 404 });
      // Pages pick it up with their next update; phones get it pushed, a little later.
      const send = async () => {
        await new Promise((resolve) => setTimeout(resolve, PHONE_TEST_DELAY_MS));
        await sendToPhones(this.env, { title: alert.title, body: alert.body, key });
      };
      this.ctx.waitUntil(send());
      return Response.json({ ok: true });
    }
    const since = url.searchParams.get("since");
    const body = await this.keeper.ask(since ? Number(since) : null);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    return Response.json(body);
  }

  async alarm() {
    if (!this.keeper.watched) return;
    await this.keeper.poll();
    await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
  }
}

// The ScoreKeeper Durable Object (exported by worker/index.js): it runs the program fetching the scores and working out
// the notifications (scorekeeper.js), and sends them to phones (phones.js). Its own file so Node tests can drive it
// (worker/scorekeeper-object.test.js), with stand-ins for Cloudflare's storage and for ESPN.

import { ScoreKeeper as Keeper } from "./scorekeeper.js";
import { listPhones, sendToPhones } from "./phones.js";

export const PHONE_TEST_DELAY_MS = 5000;  // a test reaches phones a few seconds late, time to lock the phone

// One instance, so every page and phone sees the same games and notifications. Requests carry the deployed version
// (handler.js); an instance still on older code resets itself and the request is retried on the new code. It wakes
// itself with an alarm on the schedule keeper.nextWake sets, and sends each new notification to the phones whose lit
// bells include that game. Routes: GET /?since=<n> the games and notifications; POST /test { key } a test
// notification; /phones a phone changed (reload the list); /wake the 15-minute nudge.
export class ScoreKeeper {
  /** @param deps  stand-ins for tests: { fetchGames, now, testDelay } (Cloudflare passes only ctx and env) */
  constructor(ctx, env, deps = {}) {
    this.ctx = ctx;
    this.env = env;
    this.keeper = new Keeper(deps);
    this.testDelay = deps.testDelay ?? PHONE_TEST_DELAY_MS;
    this.phones = null;  // [{ subscription, bells }], loaded from KV on first need, on /phones and on /wake
    this.sentThrough = 0;  // the last notification sent to phones
  }

  async fetch(request) {
    const wanted = request.headers.get("X-Version"), running = this.env.VERSION?.id;
    if (wanted && running && wanted !== running) this.ctx.abort("newer code deployed");  // throws; handler.js retries
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/test") {
      const { key, kind } = await request.json();
      return this.test(key, kind);
    }
    if (url.pathname === "/phones" || url.pathname === "/wake") {
      await this.loadPhones();
      await this.schedule();
      return Response.json({ ok: true, phones: this.phones.length });
    }
    const since = url.searchParams.get("since");
    const body = await this.keeper.ask(since ? Number(since) : null);
    await this.sendNew();  // asking may have fetched
    await this.schedule();
    return Response.json(body);
  }

  async alarm() {
    if (!this.phones) await this.loadPhones();
    if (this.keeper.nextWake(this.phones) == null) return;
    await this.keeper.poll();
    await this.sendNew();
    await this.schedule();
  }

  async loadPhones() {
    this.phones = this.env.PUSH ? await listPhones(this.env.PUSH) : [];
  }

  // Set the alarm for the next fetch (or clear it when nothing needs one). An earlier alarm already set stays.
  async schedule() {
    if (!this.phones) await this.loadPhones();
    const wait = this.keeper.nextWake(this.phones);
    const set = await this.ctx.storage.getAlarm();
    if (wait == null) {
      if (set) await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = this.keeper.now();
    if (!set || set > now + wait) await this.ctx.storage.setAlarm(now + wait);
  }

  // Each notification since the last send, to the phones whose bells include its game (tests go their own way).
  async sendNew() {
    const fresh = this.keeper.since(this.sentThrough);
    if (!fresh.length) return;
    this.sentThrough = fresh.at(-1).id;
    if (!this.phones) await this.loadPhones();
    for (const a of fresh) {
      if (a.test) continue;  // the test button sends those itself (test())
      const phones = this.phones.filter((p) => p.bells.includes(a.key));
      if (phones.length) await this.send({ title: a.title, body: a.body, key: a.key, icon: a.icon }, phones);
    }
  }

  async send(message, phones) {
    const { gone } = await sendToPhones(this.env, message, phones);
    if (gone.length) this.phones = this.phones.filter((p) => !gone.includes(p.subscription.endpoint));
  }

  test(key, kind) {
    const alert = this.keeper.test(key, kind);
    if (!alert) return Response.json({ ok: false }, { status: 404 });
    // Pages pick it up with their next update (only admins' pages ask the program); admins' phones whose bells include
    // the game get it pushed, a little later. A test follows the bells like a real notification, so it shows exactly
    // what someone subscribed would get.
    this.ctx.waitUntil((async () => {
      await new Promise((resolve) => setTimeout(resolve, this.testDelay));
      if (!this.phones) await this.loadPhones();
      const belled = this.phones.filter((p) => !p.public && p.bells.includes(key));
      if (belled.length) await this.send({ title: alert.title, body: alert.body, key, icon: alert.icon }, belled);
    })());
    return Response.json({ ok: true });
  }
}

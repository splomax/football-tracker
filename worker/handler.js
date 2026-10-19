// The whole site: the static files (env.ASSETS, the repo minus .assetsignore) plus the admin API, on one domain.
// Split from index.js so it can be tested in Node, where admin.js can't be imported as text.
//
//   POST /api/login     Authorization: Bearer <password>  ->  { token }, good for TOKEN_DAYS
//   GET  /api/admin.js  Authorization: Bearer <token>     ->  the admin module
//   GET  /api/visits    Authorization: Bearer <token>     ->  { weekly, monthly, total } from the visit counter
//   GET  /api/games?since=<n>  Authorization: Bearer <token>  ->  { games: { cfb, nfl }, confNames, alerts, cursor } from
//                       the program on Cloudflare (scorekeeper.js): the notifications after number n (none without it)
//   POST /api/test-alert  Authorization: Bearer <token>, { key, kind? }  ->  a test notification for that game, or a
//                       sample of one kind (js/alerts.js SAMPLE_KINDS) for styling them (phones get it
//                       about 5 seconds later, time to lock the phone)
//   POST /api/push/subscribe    Authorization: Bearer <token>, { subscription, bells }  ->  a phone turning on notifications
//   POST /api/push/bells        Authorization: Bearer <token>, { endpoint, bells }      ->  a phone's lit bells changed
//   POST /api/push/unsubscribe  Authorization: Bearer <token>, { endpoint }             ->  a phone turning them off
//   anything else       the site's files; www. redirects to the bare domain
//
// The admin code is only ever served by /api/admin.js, so regular visitors never get it, and only the token, never
// the password, is kept in a browser. Tokens are signed with the password, so changing the password (wrangler secret
// put ADMIN_PASSWORD) signs everyone out at once.

import { savePhone, setBells, removePhone } from "./phones.js";
import { SAMPLE_KINDS } from "../js/alerts.js";

export const TOKEN_DAYS = 30;

// The visit counter's stats (js/counter.js counts the hits). hits.sh sends no CORS headers, so the browser can't read
// them itself. Reading them doesn't add a hit.
export const VISITS_URL = "https://hits.sh/api/urns/yawyawfootbaw.github.io/football-tracker";

/**
 * @param {Request} request
 * @param {{ ADMIN_PASSWORD?: string, ASSETS?: { fetch: (r: Request) => Promise<Response> }, SCORES?: DurableObjectNamespace, VERSION?: { id: string } }} env
 *   the password is a Worker secret; ASSETS serves the site's files; SCORES is the program fetching the scores (index.js);
 *   VERSION is the deployed version; PUSH (KV) holds the phones that turned on notifications (wrangler.toml)
 * @param {string} code  admin.js's source
 * @param {number} [now]  for tests
 */
export async function handle(request, env, code, now = Date.now()) {
  const url = new URL(request.url);
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

  const reply = (body, status, headers = {}) => new Response(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
  const route = `${request.method} ${url.pathname}`;
  const given = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!env.ADMIN_PASSWORD) return reply("Not set up", 401);  // no password configured: nobody gets in

  if (route === "POST /api/login") {
    if (!(await sameText(given, env.ADMIN_PASSWORD))) return reply("Wrong password", 401);
    const expires = now + TOKEN_DAYS * 86_400_000;
    const token = `${expires}.${await sign(String(expires), env.ADMIN_PASSWORD)}`;
    return reply(JSON.stringify({ token, expires }), 200, { "Content-Type": "application/json" });
  }
  if (route === "GET /api/admin.js") {
    if (!(await validToken(given, env.ADMIN_PASSWORD, now))) return reply("Log in again", 401);
    return reply(code, 200, { "Content-Type": "text/javascript" });
  }
  if (route === "GET /api/visits") {
    if (!(await validToken(given, env.ADMIN_PASSWORD, now))) return reply("Log in again", 401);
    const res = await fetch(VISITS_URL).catch(() => null);
    if (!res?.ok) return reply("Counter unavailable", 502);
    const { weekly, monthly, total } = await res.json();
    return reply(JSON.stringify({ weekly, monthly, total }), 200, { "Content-Type": "application/json" });
  }
  if (route === "GET /api/games") {
    if (!(await validToken(given, env.ADMIN_PASSWORD, now))) return reply("Log in again", 401);
    const since = url.searchParams.get("since");
    const res = await keeperFetch(env, `/${since ? `?since=${encodeURIComponent(since)}` : ""}`);
    return reply(await res.text(), res.status, { "Content-Type": "application/json" });
  }
  if (route === "POST /api/test-alert") {
    if (!(await validToken(given, env.ADMIN_PASSWORD, now))) return reply("Log in again", 401);
    const { key, kind } = await request.json().catch(() => ({}));
    if (typeof key !== "string") return reply("Which game?", 400);
    if (kind != null && !(kind in SAMPLE_KINDS)) return reply("Which kind?", 400);
    const res = await keeperFetch(env, "/test", { method: "POST", body: JSON.stringify({ key, kind }) });
    return reply(await res.text(), res.status, { "Content-Type": "application/json" });
  }
  // Phones turning notifications on and off, and their bells (worker/phones.js).
  if (route.startsWith("POST /api/push/")) {
    if (!(await validToken(given, env.ADMIN_PASSWORD, now))) return reply("Log in again", 401);
    const body = await request.json().catch(() => ({}));
    // Logged in as admin (above), so these phones are admins' and get test notifications (worker/phones.js).
    const ok = route === "POST /api/push/subscribe" ? await savePhone(env.PUSH, body.subscription, body.bells, now, true)
      : route === "POST /api/push/bells" ? await setBells(env.PUSH, body.endpoint, body.bells, now, true)
      : route === "POST /api/push/unsubscribe" ? (await removePhone(env.PUSH, body.endpoint), true)
      : null;
    if (ok === null) return reply("Not found", 404);
    if (!ok) return reply("Not a phone, or not its bells", 400);
    await keeperFetch(env, "/phones").catch((err) => console.error("phones", err));  // the program reloads its list
    return reply('{"ok":true}', 200, { "Content-Type": "application/json" });
  }
  return reply("Not found", 404);
}

const encode = (s) => new TextEncoder().encode(s);
const hmacKey = (password) =>
  crypto.subtle.importKey("raw", encode(`football-tracker-admin:${password}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sign(text, password) {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(password), encode(text)));
}

// "<expires>.<signature>", unexpired and signed with the current password. verify() compares in constant time.
async function validToken(token, password, now) {
  const [expires, sig] = token.split(".");
  if (!/^\d+$/.test(expires ?? "") || !/^[0-9a-f]{64}$/.test(sig ?? "") || Number(expires) <= now) return false;
  const bytes = new Uint8Array(sig.match(/../g).map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(password), bytes, encode(expires));
}

// Compares hashes byte by byte without stopping early, so response timing doesn't reveal how much of a guess was right.
async function sameText(a, b) {
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  return x.reduce((diff, byte, i) => diff | (byte ^ y[i]), 0) === 0;
}

/**
 * Ask the program (the ScoreKeeper Durable Object, worker/index.js): one instance, found by name. Each request carries
 * the deployed version; an instance still running older code (pages and phones keep it busy, so it never restarts on
 * its own) resets itself and throws, and the request is tried once more, on the new code.
 */
export async function keeperFetch(env, path, init = {}) {
  const ask = () => env.SCORES.get(env.SCORES.idFromName("scores")).fetch(`https://scorekeeper${path}`,
    { ...init, headers: { ...init.headers, "X-Version": env.VERSION?.id ?? "" } });
  try {
    return await ask();
  } catch (err) {
    console.error("scorekeeper, retrying", err);
    return ask();
  }
}

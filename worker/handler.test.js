// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, TOKEN_DAYS, VISITS_URL } from "./handler.js";

const assets = { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`) };
const env = { ADMIN_PASSWORD: "right horse battery", ASSETS: assets };
const NOW = Date.UTC(2026, 9, 9);
const call = (method, path, auth, { at = NOW, envOverride = env, host = "site.example" } = {}) => handle(
  new Request(`https://${host}${path}`, { method, headers: auth != null ? { Authorization: `Bearer ${auth}` } : {} }),
  envOverride, "export const x = 1;", at);
const login = async (password = env.ADMIN_PASSWORD, opts) => call("POST", "/api/login", password, opts);
const tokenFor = async (opts) => (await (await login(env.ADMIN_PASSWORD, opts)).json()).token;

test("the right password gets a token that loads the code", async () => {
  const res = await login();
  assert.equal(res.status, 200);
  const { token, expires } = await res.json();
  assert.equal(expires, NOW + TOKEN_DAYS * 86_400_000);
  assert.ok(!token.includes(env.ADMIN_PASSWORD));
  const code = await call("GET", "/api/admin.js", token);
  assert.equal(code.status, 200);
  assert.equal(await code.text(), "export const x = 1;");
  assert.equal(code.headers.get("Cache-Control"), "no-store");
});

test("a wrong or missing password gets no token", async () => {
  for (const password of ["nope", `${env.ADMIN_PASSWORD}x`, "", null]) {
    const res = await login(password);
    assert.equal(res.status, 401);
    assert.doesNotMatch(await res.text(), /token/);
  }
});

test("the password itself doesn't load the code; only a token does", async () => {
  assert.equal((await call("GET", "/api/admin.js", env.ADMIN_PASSWORD)).status, 401);
});

test("tokens expire, and changing the password cancels them", async () => {
  const token = await tokenFor();
  assert.equal((await call("GET", "/api/admin.js", token, { at: NOW + (TOKEN_DAYS - 1) * 86_400_000 })).status, 200);
  assert.equal((await call("GET", "/api/admin.js", token, { at: NOW + TOKEN_DAYS * 86_400_000 })).status, 401);
  assert.equal((await call("GET", "/api/admin.js", token, { envOverride: { ...env, ADMIN_PASSWORD: "new password" } })).status, 401);
});

test("a tampered token is refused", async () => {
  const [expires, sig] = (await tokenFor()).split(".");
  const later = String(Number(expires) + 365 * 86_400_000);
  for (const bad of [`${later}.${sig}`, `${expires}.${sig.replace(/^./, (c) => (c === "0" ? "1" : "0"))}`, "garbage", `${expires}.`]) {
    assert.equal((await call("GET", "/api/admin.js", bad)).status, 401, bad);
  }
});

test("no password configured means nobody gets in", async () => {
  assert.equal((await login("", { envOverride: { ASSETS: assets } })).status, 401);
});

test("everything outside /api/ is the site's files, and the admin source isn't among them by path", async () => {
  assert.equal(await (await call("GET", "/")).text(), "asset /");
  assert.equal(await (await call("GET", "/js/main.js?x=1")).text(), "asset /js/main.js");
  // /worker/admin.js goes to ASSETS too, where .assetsignore leaves it out (so it's a 404 on the real site).
  assert.equal(await (await call("GET", "/worker/admin.js")).text(), "asset /worker/admin.js");
});

test("www. redirects to the bare domain, keeping the path and query", async () => {
  const res = await call("GET", "/?game=cfb:1", null, { host: "www.site.example" });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("Location"), "https://site.example/?game=cfb:1");
});

test("other API paths and methods are 404", async () => {
  const token = await tokenFor();
  assert.equal((await call("GET", "/api/", token)).status, 404);
  assert.equal((await call("GET", "/api/login", env.ADMIN_PASSWORD)).status, 404);
});

test("a token gets the visit counts from the counter; the password and no token don't", async () => {
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return Response.json({ weekly: 12, monthly: 345, total: 6789, items: [] });
  };
  try {
    const res = await call("GET", "/api/visits", await tokenFor());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { weekly: 12, monthly: 345, total: 6789 });
    assert.deepEqual(asked, [VISITS_URL]);
    assert.equal((await call("GET", "/api/visits", env.ADMIN_PASSWORD)).status, 401);
    assert.equal((await call("GET", "/api/visits")).status, 401);
    assert.equal(asked.length, 1);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal((await call("GET", "/api/visits", await tokenFor())).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

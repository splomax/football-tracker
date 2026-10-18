// Run with: npm run test:worker
import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, vapidAuthorization } from "./webpush.js";

const { subtle } = globalThis.crypto;
const b64url = (b) => Buffer.from(b).toString("base64url");
const enc = new TextEncoder();

// A pretend phone: its key pair and auth secret, as a real subscription would hand over.
async function phone() {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, auth, keys: { p256dh: b64url(await subtle.exportKey("raw", pair.publicKey)), auth: b64url(auth) } };
}

// What the phone does on receipt (RFC 8291, read independently of webpush.js): parse the header, rebuild the key and
// nonce from its own private key, decrypt, and drop the record delimiter.
async function phoneDecrypts(body, { pair, auth }) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  const senderPublic = body.slice(21, 21 + idlen), ciphertext = body.slice(21 + idlen);
  const myPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const sender = await subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: sender }, pair.privateKey, 256);
  const derive = async (s, ikm, info, n) => new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info },
    await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...myPublic, ...senderPublic]);
  const ikm = await derive(auth, shared, info, 32);
  const key = await subtle.importKey("raw", await derive(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
  const nonce = await derive(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  return { rs, idlen, text: new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))), delimiter: plain.at(-1) };
}

test("a message encrypted for a phone decrypts on that phone, in one record ending with the delimiter", async () => {
  const p = await phone();
  const message = JSON.stringify({ title: "Test notification", body: "OSU 24, IOWA 6 · 2:00 - 4th", key: "cfb:1" });
  const body = await encrypt(enc.encode(message), p.keys);
  const got = await phoneDecrypts(body, p);
  assert.deepEqual(got, { rs: 4096, idlen: 65, text: message, delimiter: 2 });
});

test("another phone can't read it, and two sends of the same message differ (fresh keys and salt each time)", async () => {
  const p = await phone(), other = await phone();
  const body = await encrypt(enc.encode("hello"), p.keys);
  await assert.rejects(phoneDecrypts(body, other));
  assert.notDeepEqual(await encrypt(enc.encode("hello"), p.keys), body);
});

test("the VAPID header is a JWT for the push service's origin, signed with our key, carrying our public key", async () => {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  const now = Date.UTC(2026, 9, 18);
  const header = await vapidAuthorization("https://web.push.apple.com/QGabc123", jwk, "mailto:sean@gametrackerlive.com", now);
  const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  const [h, c, sig] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url")), { aud: "https://web.push.apple.com", exp: now / 1000 + 12 * 3600, sub: "mailto:sean@gametrackerlive.com" });
  assert.equal(k, b64url(await subtle.exportKey("raw", pair.publicKey)));
  assert.equal(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(sig, "base64url"), enc.encode(`${h}.${c}`)), true);
});

// Sending a phone notification ("Web Push"), with nothing but the Worker's built-in WebCrypto. A phone that turns on
// notifications hands over a subscription: an address at its push service (Apple's, for an iPhone) and two keys. To
// send, we POST the message there, encrypted so only that phone can read it (RFC 8291, "aes128gcm"), with a short
// signed token saying it's from us (RFC 8292, "VAPID": the phone subscribed with our public key, js/push.js, and only
// our private key, the VAPID_PRIVATE_KEY secret, can sign for it). Tested in worker/webpush.test.js.

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** HKDF-SHA-256: `length` bytes from `ikm`, with `salt` and `info`. */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/**
 * The message encrypted for one subscription (RFC 8291): the body to POST, a header (salt, record size, our one-off
 * public key) followed by the AES-128-GCM ciphertext.
 * @param {Uint8Array} plaintext
 * @param {{ p256dh: string, auth: string }} keys  the subscription's keys, base64url
 */
export async function encrypt(plaintext, keys) {
  const phonePublic = unb64url(keys.p256dh), authSecret = unb64url(keys.auth);
  // A one-off key pair for this message; the shared secret comes from it and the phone's public key.
  const ours = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const ourPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ours.publicKey));
  const phoneKey = await crypto.subtle.importKey("raw", phonePublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: phoneKey }, ours.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), phonePublic, ourPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record, so it ends with the last-record delimiter (2) and no padding.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);  // record size
  header[20] = ourPublic.length;
  return concat(header, ourPublic, ciphertext);
}

/**
 * The Authorization header for a push service (RFC 8292): a JWT for the service's origin, good for 12 hours, signed
 * with our private key (a P-256 JWK), plus our public key.
 */
export async function vapidAuthorization(endpoint, privateJwk, subject, now = Date.now()) {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto signs in the raw r||s form a JWT wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  const { x, y } = privateJwk;
  const publicKey = b64url(concat(new Uint8Array([4]), unb64url(x), unb64url(y)));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${publicKey}`;
}

/**
 * Send one notification. Resolves with the push service's status: 201 (or 2xx) sent; 404 or 410 means the phone has
 * gone (turned notifications off, removed the app), so the caller should forget it.
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
 * @param {object} message  shown by sw.js: { title, body, key }
 * @param {{ privateJwk: JsonWebKey, subject: string, ttl?: number }} vapid
 */
export async function sendPush(subscription, message, { privateJwk, subject, ttl = 600 }) {
  const body = await encrypt(enc.encode(JSON.stringify(message)), subscription.keys);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, privateJwk, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),        // seconds the push service may hold it for a phone that's offline
      Urgency: "high",
    },
    body,
  });
  return res.status;
}

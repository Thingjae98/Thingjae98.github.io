// 웹푸시 발송 (RFC 8291 aes128gcm + RFC 8292 VAPID) — WebCrypto만 사용, 외부 패키지 없음
const te = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const cat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

async function vapidJwt(endpoint, privateJwk, sub) {
  const aud = new URL(endpoint).origin;
  const header = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64u(sig)}`;
}

/** sub: {endpoint,p256dh,auth}  payload: object → JSON. env: VAPID_PRIVATE_JWK(JSON 문자열), VAPID_PUBLIC(base64url 65바이트), VAPID_SUBJECT(mailto:) */
/** 한 구독에 푸시를 보낸다. 실패해도 던지지 않고 결과로 돌려준다 (한 건 실패가 브리핑 저장·다른 사람 알림을 막지 않게) */
export async function sendPush(sub, payload, env) {
  try { return await sendPushRaw(sub, payload, env); }
  catch (e) { return { status: 0, gone: false, error: String(e.message || e) }; }
}

async function sendPushRaw(sub, payload, env) {
  const uaPub = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const plain = cat(te.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  const body = cat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);

  const jwt = await vapidJwt(sub.endpoint, JSON.parse(env.VAPID_PRIVATE_JWK), env.VAPID_SUBJECT);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "normal", Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}` },
    body,
  });
  return { status: r.status, gone: r.status === 404 || r.status === 410 };
}

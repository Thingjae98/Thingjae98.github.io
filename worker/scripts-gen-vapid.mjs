// VAPID 키 생성: node scripts-gen-vapid.mjs → 출력 두 줄을 wrangler secret 으로 넣는다
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const b64u = (buf) => Buffer.from(buf).toString("base64url");
console.log("VAPID_PUBLIC=" + b64u(raw));
console.log("VAPID_PRIVATE_JWK=" + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));

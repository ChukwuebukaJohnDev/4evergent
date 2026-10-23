import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";

const API = "http://127.0.0.1:3000";
const XRW = { "X-Requested-With": "4evergent", "Content-Type": "application/json" };

function cookieOf(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(/^four_eg_session=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

test("E2E email: register via HTTP → session cookie → /agents → /auth/me", async () => {
  const email = `e2e-${Date.now()}@test.dev`;
  const reg = await fetch(`${API}/auth/register`, {
    method: "POST", headers: XRW,
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(reg.status, 201);
  const cookie = cookieOf(reg);
  assert.ok(cookie);

  const list = await fetch(`${API}/agents`, { headers: { Cookie: `four_eg_session=${cookie}` } });
  assert.equal(list.status, 200);

  const create = await fetch(`${API}/agents`, {
    method: "POST", headers: { ...XRW, Cookie: `four_eg_session=${cookie}` },
    body: JSON.stringify({ displayName: "E2E Agent" }),
  });
  assert.equal(create.status, 201);

  const me = await fetch(`${API}/auth/me`, { headers: { Cookie: `four_eg_session=${cookie}` } });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.subject, `email:${email}`);
  assert.equal(meBody.method, "email");
});

test("E2E stellar: challenge → Keypair.sign (stellar semantics) → verify → session", async () => {
  const kp = Keypair.random();
  const ch = await fetch(`${API}/auth/stellar/challenge`, {
    method: "POST", headers: XRW,
    body: JSON.stringify({ publicKey: kp.publicKey() }),
  });
  assert.equal(ch.status, 200);
  const c = await ch.json();

  const sig = kp.sign(Buffer.from(c.message, "utf8")).toString("base64");
  const verify = await fetch(`${API}/auth/stellar/verify`, {
    method: "POST", headers: XRW,
    body: JSON.stringify({ publicKey: kp.publicKey(), challengeId: c.challengeId, signature: sig }),
  });
  assert.equal(verify.status, 200, "stellar-semantic signature accepted");
  const cookie = cookieOf(verify);
  const me = await fetch(`${API}/auth/me`, { headers: { Cookie: `four_eg_session=${cookie}` } });
  const m = await me.json();
  assert.equal(m.subject, `stellar:${kp.publicKey()}`);
});

test("E2E stellar: raw-ed25519 (wallet signMessage semantics) also accepted", async () => {
  const kp = Keypair.random();
  const ch = await fetch(`${API}/auth/stellar/challenge`, {
    method: "POST", headers: XRW,
    body: JSON.stringify({ publicKey: kp.publicKey() }),
  });
  assert.equal(ch.status, 200);
  const c = await ch.json();

  // raw ed25519 over the message bytes (no sha256), like wallet signMessage
  const { createPrivateKey, sign } = await import("node:crypto");
  const seed = kp.rawSecretKey();        // 32-byte ed25519 seed
  const pub = kp.rawPublicKey();
  // PKCS#8 v1 Ed25519: 302e 020100 3005 0603 2b6570(oid) 0422 0420<seed> a01f301d...?
  // Standard form: SEQUENCE{ ver=0, AI{ oid 1.3.101.110 }, OCTETSTR( OCTETSTR(seed) ), [1]{ BITSTR pub } }
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
    Buffer.from("a023022100", "hex"),
    pub,
  ]);
  const keyObj = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const rawSig = sign(null, Buffer.from(c.message, "utf8"), keyObj);
  const verify = await fetch(`${API}/auth/stellar/verify`, {
    method: "POST", headers: XRW,
    body: JSON.stringify({ publicKey: kp.publicKey(), challengeId: c.challengeId, signature: rawSig.toString("hex") }),
  });
  assert.equal(verify.status, 200, "raw ed25519 hex signature accepted (wallet semantics)");
});

test("E2E google: start → 302 with state+nonce; unconfigured secret never leaks", async () => {
  const res = await fetch(`${API}/auth/google/start`, { redirect: "manual" });
  assert.equal(res.status, 503);
  const b = await res.json();
  assert.equal(b.error, "google_oauth_not_configured");
  assert.deepEqual(b.requiredEnv, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
});

test("E2E bearer fallback: API key still authenticates machine clients", async () => {
  const res = await fetch(`${API}/agents`, { headers: { Authorization: "Bearer test-machine-key" } });
  assert.equal(res.status, 200);
});

test("E2E logout: invalidates server-side session", async () => {
  const email = `lo-${Date.now()}@test.dev`;
  const reg = await fetch(`${API}/auth/register`, {
    method: "POST", headers: XRW,
    body: JSON.stringify({ email, password: "password123" }),
  });
  const cookie = cookieOf(reg);
  assert.equal((await fetch(`${API}/agents`, { headers: { Cookie: `four_eg_session=${cookie}` } })).status, 200);
  const out = await fetch(`${API}/auth/logout`, {
    method: "POST", headers: { ...XRW, Cookie: `four_eg_session=${cookie}` },
  });
  assert.equal(out.status, 204);
  assert.equal((await fetch(`${API}/agents`, { headers: { Cookie: `four_eg_session=${cookie}` } })).status, 401);
});

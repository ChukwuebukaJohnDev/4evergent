// Production runtime safety: bind-host configurability and fail-closed auth.
//
// These tests cover the two behaviors added for persistent hosted deployment:
//   1. server.listen(port, host) honors an explicit host (default = loopback).
//   2. Startup refuses a non-loopback bind with no API_KEYS unless the operator
//      explicitly opts in with ALLOW_DEV_AUTH=1.
//
// decideAuthMode is a pure function, so these are deterministic and fast. The
// bind-host test uses a real loopback socket to prove the default is unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { decideAuthMode } from "../src/server.js";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import type { Signer } from "@4evergent/stellar";

class MockSigner implements Signer {
  private id: string;
  constructor(id: string) {
    this.id = id.startsWith("G") ? id : `G${id.padEnd(55, "A").slice(0, 55)}`;
  }
  getAccountId(): string {
    return this.id;
  }
  getNetworkPassphrase(): string {
    return "Test SDF Network ; September 2015";
  }
  async sign(transaction: any): Promise<any> {
    transaction.signatures = [{ hint: Buffer.from("mock"), signature: Buffer.from("sig") }];
    return transaction;
  }
}

async function makeServer(id: string) {
  return createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner(id),
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
  });
}

// ---------------------------------------------------------------------------
// decideAuthMode — the fail-closed startup rule
// ---------------------------------------------------------------------------

test("auth mode: API_KEYS on a public bind selects production auth", () => {
  const d = decideAuthMode({ host: "0.0.0.0", hasApiKeys: true, allowDevAuth: false });
  assert.equal(d.mode, "production");
});

test("auth mode: API_KEYS takes precedence over an ALLOW_DEV_AUTH opt-in", () => {
  const d = decideAuthMode({ host: "0.0.0.0", hasApiKeys: true, allowDevAuth: true });
  assert.equal(d.mode, "production");
});

test("auth mode: loopback bind without API_KEYS keeps local dev ergonomics", () => {
  const d = decideAuthMode({ host: "127.0.0.1", hasApiKeys: false, allowDevAuth: false });
  assert.equal(d.mode, "development");
  assert.equal(d.mode === "development" && d.devOptIn, false);
});

test("auth mode: 'localhost' and '::1' are treated as loopback", () => {
  for (const host of ["localhost", "::1"]) {
    assert.equal(decideAuthMode({ host, hasApiKeys: false, allowDevAuth: false }).mode, "development");
  }
});

test("auth mode: REFUSE — public bind without API_KEYS (the fail-closed case)", () => {
  const d = decideAuthMode({ host: "0.0.0.0", hasApiKeys: false, allowDevAuth: false });
  assert.equal(d.mode, "refuse");
  assert.ok(d.mode === "refuse" && d.reason.includes("API_KEYS"));
  assert.ok(d.mode === "refuse" && d.reason.includes("0.0.0.0"));
});

test("auth mode: a non-loopback hostname also refuses", () => {
  assert.equal(decideAuthMode({ host: "10.0.0.5", hasApiKeys: false, allowDevAuth: false }).mode, "refuse");
});

test("auth mode: ALLOW_DEV_AUTH=1 permits an explicit public dev bind", () => {
  const d = decideAuthMode({ host: "0.0.0.0", hasApiKeys: false, allowDevAuth: true });
  assert.equal(d.mode, "development");
  assert.equal(d.mode === "development" && d.devOptIn, true);
});

// ---------------------------------------------------------------------------
// listen() bind host
// ---------------------------------------------------------------------------

test("listen() defaults to loopback when no host is passed", async () => {
  const server = await makeServer("default-host");
  try {
    await server.listen(0);
    const addr = server.server.address() as AddressInfo;
    assert.equal(addr.address, "127.0.0.1");
    // Reachable on loopback: proves the default was actually bound.
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`, { keepalive: false });
    assert.equal(res.status, 200);
  } finally {
    await server.close();
  }
});

test("listen() honors an explicit host argument", async () => {
  const server = await makeServer("explicit-host");
  try {
    await server.listen(0, "127.0.0.1");
    const addr = server.server.address() as AddressInfo;
    assert.equal(addr.address, "127.0.0.1");
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`, { keepalive: false });
    assert.equal(res.status, 200);
  } finally {
    await server.close();
  }
});
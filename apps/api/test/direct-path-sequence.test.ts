import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import type { Signer } from "@4evergent/stellar";

/**
 * Phase 26A integration tests — verify the direct intent execution path
 * uses the AccountSequenceCoordinator.
 */

class MockSigner implements Signer {
  private id: string;
  constructor(id: string) {
    this.id = id.startsWith("G") ? id : `G${id.padEnd(55, "A").slice(0, 55)}`;
  }
  getAccountId(): string { return this.id; }
  getNetworkPassphrase(): string { return "Test SDF Network ; September 2015"; }
  async sign(transaction: any): Promise<any> {
    transaction.signatures = [{ hint: Buffer.from("mock"), signature: Buffer.from("sig") }];
    return transaction;
  }
}

function makeAgent(id: string, ownerId: string) {
  return {
    id,
    displayName: "Test",
    description: "test agent",
    ownerId,
    stellarAddress: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    capabilities: [],
    status: "active" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
    metadata: {},
  };
}

async function startServer(opts?: { signer?: Signer; ownerId?: string }) {
  const signer = opts?.signer ?? new MockSigner("G_DIRECT_PATH_TEST_ACCOUNT");
  const ownerId = opts?.ownerId ?? "test";
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer,
    authProvider: new DevAuthProvider({ defaultOwnerId: ownerId }),
  });
  server.registerAgent(makeAgent("test-agent", ownerId));

  await server.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.server.address() as any).port}`;
  return { baseUrl, close: () => server.close(), signer };
}

test("DIRECT PATH: concurrent intents for same account do not crash server", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // Submit two concurrent intents for the same agent (same Stellar account)
    // The StellarAdapter will fail (no real Horizon), but the server should
    // handle it gracefully without crashing.
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/agents/test-agent/intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment",
          asset: "XLM",
          destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          amount: "1",
          reason: "test-1",
        }),
      }),
      fetch(`${baseUrl}/agents/test-agent/intents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "payment",
          asset: "XLM",
          destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          amount: "2",
          reason: "test-2",
        }),
      }),
    ]);

    // Both should complete (either 200 or 502, but not 500/crash)
    assert.ok(res1.status === 200 || res1.status === 502, `Unexpected status: ${res1.status}`);
    assert.ok(res2.status === 200 || res2.status === 502, `Unexpected status: ${res2.status}`);

    // Server should still be alive
    const healthRes = await fetch(`${baseUrl}/executions/test-agent`);
    assert.ok(healthRes.status === 200 || healthRes.status === 404);
  } finally {
    await close();
  }
});

test("DIRECT PATH: failure releases coordinator lock", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // First request: will fail at Horizon (no real network)
    const res1 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "payment",
        asset: "XLM",
        destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        amount: "1",
        reason: "test-fail",
      }),
    });
    assert.equal(res1.status, 502); // Source account load fails

    // Second request: should also complete (lock was released)
    const res2 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "payment",
        asset: "XLM",
        destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        amount: "2",
        reason: "test-success",
      }),
    });
    assert.equal(res2.status, 502); // Same failure, but proves lock was released
  } finally {
    await close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import type { Signer } from "@4evergent/stellar";
import type { PolicyRules } from "@4evergent/shared";

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

async function startServer(opts?: { policyRules?: Partial<PolicyRules>; signer?: Signer; ownerId?: string; agentId?: string }) {
  const signer = opts?.signer ?? new MockSigner("test-agent");
  const ownerId = opts?.ownerId ?? "test";
  const agentId = opts?.agentId ?? "test-agent";
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer,
    policyRules: opts?.policyRules,
    authProvider: new DevAuthProvider({ defaultOwnerId: ownerId }),
  });
  server.registerAgent(makeAgent(agentId, ownerId));

  await server.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.server.address() as any).port}`;
  return { baseUrl, close: () => server.close(), store: server.store, agentId };
}

const INTENT_BODY = {
  type: "payment",
  asset: "XLM",
  destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  amount: "100",
  reason: "test payment",
};

test("TEST A: same owner+agent+key → exactly 1 activity record", async () => {
  const { baseUrl, close, store } = await startServer();
  try {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "idem-key-a" };
    const res1 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(INTENT_BODY),
    });
    assert.equal(res1.status, 202);
    const res2 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(INTENT_BODY),
    });
    assert.equal(res2.status, 200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    assert.equal(body1.activityId, body2.activityId);

    const existing = await store.getByIdempotencyKey("test", "test-agent", "idem-key-a");
    assert.ok(existing);
    assert.equal(existing?.id, body1.activityId);
  } finally {
    await close();
  }
});

test("TEST B: duplicate returns consistent activity identity", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "idem-key-b" };
    const responses = await Promise.all([
      fetch(`${baseUrl}/agents/test-agent/intents`, { method: "POST", headers, body: JSON.stringify(INTENT_BODY) }),
      fetch(`${baseUrl}/agents/test-agent/intents`, { method: "POST", headers, body: JSON.stringify(INTENT_BODY) }),
    ]);
    assert.equal(responses[0].status, 202);
    assert.equal(responses[1].status, 200);

    const bodies = await Promise.all(responses.map(r => r.json()));
    assert.equal(bodies[0].activityId, bodies[1].activityId);
  } finally {
    await close();
  }
});

test("TEST C: same key + different intent → second rejected as conflict", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "idem-key-c" };
    const res1 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(INTENT_BODY),
    });
    assert.equal(res1.status, 202);

    const differentIntent = { ...INTENT_BODY, amount: "999" };
    const res2 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(differentIntent),
    });
    assert.equal(res2.status, 409);
  } finally {
    await close();
  }
});

test("TEST D: same key + different owner → isolation preserved", async () => {
  const serverA = await startServer({ ownerId: "owner-a", agentId: "agent-a" });
  const serverB = await startServer({ ownerId: "owner-b", agentId: "agent-b" });

  try {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": "idem-key-d" };
    const resA = await fetch(`${serverA.baseUrl}/agents/agent-a/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(INTENT_BODY),
    });
    const resB = await fetch(`${serverB.baseUrl}/agents/agent-b/intents`, {
      method: "POST",
      headers,
      body: JSON.stringify(INTENT_BODY),
    });
    assert.equal(resA.status, 202);
    assert.equal(resB.status, 202);

    const bodyA = await resA.json();
    const bodyB = await resB.json();
    assert.notEqual(bodyA.activityId, bodyB.activityId);
  } finally {
    await serverA.close();
    await serverB.close();
  }
});

test("TEST E: same owner+agent + different keys → multiple activities allowed", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res1 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-key-e1" },
      body: JSON.stringify(INTENT_BODY),
    });
    const res2 = await fetch(`${baseUrl}/agents/test-agent/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-key-e2" },
      body: JSON.stringify(INTENT_BODY),
    });
    assert.equal(res1.status, 202);
    assert.equal(res2.status, 202);

    const body1 = await res1.json();
    const body2 = await res2.json();
    assert.notEqual(body1.activityId, body2.activityId);
  } finally {
    await close();
  }
});

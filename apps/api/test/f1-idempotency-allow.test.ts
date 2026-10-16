/**
 * F1 Regression Test: ALLOW execution must preserve Idempotency-Key.
 * Verifies that submitting the same ALLOW intent twice with the same key
 * results in only one activity being created, even when execution fails
 * (e.g. Horizon unreachable).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";

const mockSigner = {
  getAccountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  getNetworkPassphrase: () => "Test SDF Network ; September 2015",
  sign: async (tx: any) => { tx.signatures = [{ hint: Buffer.from("mock"), signature: Buffer.from("sig") }]; return tx; },
};

async function startServer() {
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: mockSigner as any,
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
    // Policy that ALLOWs the payment intent (amount 10 XLM < 1000 limit)
    policyRules: { maxTxAmount: { XLM: "1000" }, dailySpendingLimit: { XLM: "1000" } },
    executionQueue: { enabled: false },
  });
  await server.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.server.address() as any).port}`;
  return { server, baseUrl };
}

async function postIntent(baseUrl: string, agentId: string, idempotencyKey?: string, amount = "10") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${baseUrl}/agents/${agentId}/intents`, {
    method: "POST", headers,
    body: JSON.stringify({ type: "payment", asset: "XLM", destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amount, reason: "F1 regression test" }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("F1 regression: ALLOW execution with Idempotency-Key must be idempotent", async () => {
  const { server, baseUrl } = await startServer();
  const agentRes = await fetch(`${baseUrl}/agents`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "F1 Regression Test Agent" }),
  });
  const agentId = (await agentRes.json()).agent.id;

  try {
    // First request with Idempotency-Key — ALLOW path.
    // Horizon is unreachable so the request returns 502, but an activity IS created.
    const res1 = await postIntent(baseUrl, agentId, "f1-regression-key");
    console.log("F1 res1:", res1.status, res1.body?.activityId);
    assert.ok(res1.body?.activityId, "First request should return an activityId");

    // Second request with SAME Idempotency-Key — should return the SAME activity.
    // The dedup check at line 1145 finds the existing activity before executing.
    const res2 = await postIntent(baseUrl, agentId, "f1-regression-key");
    console.log("F1 res2:", res2.status, res2.body?.activityId);
    assert.equal(
      res1.body?.activityId,
      res2.body?.activityId,
      "F1 BUG: Same idempotency key produced two different activity IDs"
    );

    // Third request with DIFFERENT Idempotency-Key — should create a NEW activity
    const res3 = await postIntent(baseUrl, agentId, "f1-regression-key-2");
    console.log("F1 res3:", res3.status, res3.body?.activityId);
    assert.notEqual(
      res1.body?.activityId,
      res3.body?.activityId,
      "Different idempotency keys should produce different activity IDs"
    );

    // Fourth request WITHOUT Idempotency-Key — should also create a new activity
    const res4 = await postIntent(baseUrl, agentId);
    console.log("F1 res4:", res4.status, res4.body?.activityId);
    assert.ok(res4.body?.activityId, "Request without key should return an activityId");
    assert.notEqual(
      res1.body?.activityId,
      res4.body?.activityId,
      "No-key request should produce a different activity ID"
    );

    console.log("F1 regression: all idempotency assertions passed");
  } finally {
    await server.close();
  }
});

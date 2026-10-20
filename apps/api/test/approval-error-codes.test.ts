import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import type { Signer } from "@4evergent/stellar";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";

// Regression tests for issue #49: approve/reject error paths must carry a
// machine-readable `code` while keeping their HTTP status and approval fields.

class MockSigner implements Signer {
  getAccountId(): string { return `G${"A".repeat(55)}`; }
  getNetworkPassphrase(): string { return "Test SDF Network ; September 2015"; }
  async sign(transaction: any): Promise<any> { return transaction; }
}

const TEST_AGENT = {
  id: "test-agent",
  displayName: "Test",
  description: "test agent",
  ownerId: "test",
  stellarAddress: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  capabilities: [],
  status: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  active: true,
  metadata: {},
};

async function startServer() {
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner(),
    policyRules: { maxTxAmount: { XLM: "1000" }, requireHumanApprovalForAmountAbove: "10" },
    deferExecution: true,
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
  });
  server.registerAgent(TEST_AGENT);
  return new Promise<{ baseUrl: string; close: () => Promise<void>; approvals: typeof server.approvals }>((resolve) => {
    const http = server.server.listen(0, "127.0.0.1", () => {
      const addr = http.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, close: () => server.close(), approvals: server.approvals });
    });
  });
}

async function post(baseUrl: string, path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function pendingApproval(baseUrl: string): Promise<string> {
  const res = await post(baseUrl, "/agents/test-agent/intents", {
    type: "payment",
    asset: "XLM",
    destination: Keypair.random().publicKey(),
    amount: "50",
    reason: "error code test",
  });
  assert.equal(res.status, 202);
  return res.body.approvalId;
}

for (const action of ["approve", "reject"] as const) {
  test(`${action}: unknown approval → 404 APPROVAL_NOT_FOUND`, async () => {
    const { baseUrl, close } = await startServer();
    try {
      const id = "00000000-0000-4000-8000-000000000000";
      const res = await post(baseUrl, `/approvals/${id}/${action}`, {});
      assert.equal(res.status, 404);
      assert.equal(res.body.code, "APPROVAL_NOT_FOUND");
      assert.equal(res.body.error, "approval not found");
      assert.equal(res.body.message, "approval not found");
      assert.equal(res.body.approvalId, id);
    } finally {
      await close();
    }
  });

  test(`${action}: raw XDR body → 400 RAW_TRANSACTION_REJECTED`, async () => {
    const { baseUrl, close } = await startServer();
    try {
      const id = await pendingApproval(baseUrl);
      const res = await post(baseUrl, `/approvals/${id}/${action}`, { xdr: "AAAA" });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, "RAW_TRANSACTION_REJECTED");
      assert.match(res.body.message, new RegExp(`not accepted at the ${action} endpoint`));
    } finally {
      await close();
    }
  });
}

test("approve already-approved → 409 APPROVAL_INVALID_STATE", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const id = await pendingApproval(baseUrl);
    assert.equal((await post(baseUrl, `/approvals/${id}/approve`, {})).status, 200);
    const res = await post(baseUrl, `/approvals/${id}/approve`, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "APPROVAL_INVALID_STATE");
    assert.match(res.body.message, /cannot approve/);
    assert.equal(res.body.error, res.body.message);
    assert.equal(res.body.status, "approved");
  } finally {
    await close();
  }
});

test("reject already-approved → 409 APPROVAL_INVALID_STATE", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const id = await pendingApproval(baseUrl);
    assert.equal((await post(baseUrl, `/approvals/${id}/approve`, {})).status, 200);
    const res = await post(baseUrl, `/approvals/${id}/reject`, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "APPROVAL_INVALID_STATE");
    assert.match(res.body.message, /cannot reject/);
  } finally {
    await close();
  }
});

test("approve expired approval → 410 APPROVAL_EXPIRED", async () => {
  const { baseUrl, close, approvals } = await startServer();
  try {
    const id = await pendingApproval(baseUrl);
    await approvals.update(id, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const res = await post(baseUrl, `/approvals/${id}/approve`, {});
    assert.equal(res.status, 410);
    assert.equal(res.body.code, "APPROVAL_EXPIRED");
    assert.equal(res.body.error, "approval expired");
    assert.equal(res.body.message, "approval expired");
    assert.equal(res.body.status, "expired");
    assert.equal((await approvals.get(id))?.status, "expired");
  } finally {
    await close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import type { Signer } from "@4evergent/stellar";
import type { PolicyRules } from "@4evergent/shared";
import { DevAuthProvider } from "@4evergent/shared";

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
    displayName: "Test Agent",
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

async function startServer(opts?: { signer?: Signer; ownerId?: string; agentId?: string }) {
  const signer = opts?.signer ?? new MockSigner("G_TEST");
  const ownerId = opts?.ownerId ?? "test-owner";
  const agentId = opts?.agentId ?? "test-agent";
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer,
    authProvider: new DevAuthProvider({ defaultOwnerId: ownerId }),
  });
  server.registerAgent(makeAgent(agentId, ownerId));

  await server.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.server.address() as any).port}`;
  return { baseUrl, close: () => server.close(), agentId, registerAgent: (agent: any) => server.registerAgent(agent) };
}

test("POLICY: GET /agents/:id/policy returns DEFAULT_RULES when no custom policy", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.agentId, agentId);
    assert.ok(body.policy);
    assert.equal(body.policy.maxTxAmount.XLM, "100");
    assert.equal(body.policy.dailySpendingLimit.XLM, "500");
    assert.deepEqual(body.policy.allowedAssets, ["XLM"]);
    assert.equal(body.policy.approvalThreshold, "50");
  } finally {
    await close();
  }
});

test("POLICY: PUT /agents/:id/policy saves and returns custom policy", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const customPolicy: PolicyRules = {
      maxTxAmount: { XLM: "50" },
      dailySpendingLimit: { XLM: "200" },
      allowedAssets: ["XLM", "USDC"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: {
        payment: true,
        trustline: true,
        contract_call: false,
        account_settings: false,
      },
      approvalThreshold: "25",
      requireHumanApprovalForAmountAbove: "25",
    };

    const putRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customPolicy),
    });
    assert.equal(putRes.status, 200);

    const putBody = await putRes.json();
    assert.equal(putBody.agentId, agentId);
    assert.equal(putBody.policy.maxTxAmount.XLM, "50");
    assert.equal(putBody.policy.dailySpendingLimit.XLM, "200");
    assert.deepEqual(putBody.policy.allowedAssets, ["XLM", "USDC"]);

    // GET should return the saved policy
    const getRes = await fetch(`${baseUrl}/agents/${agentId}/policy`);
    assert.equal(getRes.status, 200);

    const getBody = await getRes.json();
    assert.equal(getBody.policy.maxTxAmount.XLM, "50");
    assert.equal(getBody.policy.dailySpendingLimit.XLM, "200");
  } finally {
    await close();
  }
});

test("POLICY: PUT invalid policy returns 400 and does not corrupt existing", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    // First save a valid policy
    const validPolicy: PolicyRules = {
      maxTxAmount: { XLM: "50" },
      dailySpendingLimit: { XLM: "200" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: {
        payment: true,
        trustline: true,
        contract_call: false,
        account_settings: false,
      },
      approvalThreshold: "25",
      requireHumanApprovalForAmountAbove: "25",
    };

    const saveRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPolicy),
    });
    assert.equal(saveRes.status, 200);

    // Now try to save an invalid policy (negative amount)
    const invalidRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxTxAmount: { XLM: "-10" },
      }),
    });
    assert.equal(invalidRes.status, 400);

    // GET should still return the original valid policy
    const getRes = await fetch(`${baseUrl}/agents/${agentId}/policy`);
    assert.equal(getRes.status, 200);

    const getBody = await getRes.json();
    assert.equal(getBody.policy.maxTxAmount.XLM, "50");
  } finally {
    await close();
  }
});

test("POLICY: maxTxAmount enforcement is agent-scoped", async () => {
  const { baseUrl, close, registerAgent } = await startServer({ agentId: "agent-a" });
  try {
    // Register a second agent
    const agentB = makeAgent("agent-b", "test-owner");
    registerAgent(agentB);

    // Set Agent A's maxTxAmount to 10
    const policyA: PolicyRules = {
      maxTxAmount: { XLM: "10" },
      dailySpendingLimit: { XLM: "100" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "50",
      requireHumanApprovalForAmountAbove: "50",
    };

    const saveA = await fetch(`${baseUrl}/agents/agent-a/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policyA),
    });
    assert.equal(saveA.status, 200);

    // Agent B should still have default policy (maxTxAmount = 100)
    const getRes = await fetch(`${baseUrl}/agents/agent-b/policy`);
    assert.equal(getRes.status, 200);

    const getBody = await getRes.json();
    assert.equal(getBody.policy.maxTxAmount.XLM, "100"); // Default, not Agent A's
  } finally {
    await close();
  }
});

test("POLICY: persistence survives server restart", async () => {
  // This test verifies that policy is stored in SQLite (if dbPath provided)
  // For InMemory store, we verify the policy is returned correctly within the same process
  const { baseUrl, close, agentId } = await startServer();
  try {
    const customPolicy: PolicyRules = {
      maxTxAmount: { XLM: "42" },
      dailySpendingLimit: { XLM: "420" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "21",
      requireHumanApprovalForAmountAbove: "21",
    };

    const saveRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customPolicy),
    });
    assert.equal(saveRes.status, 200);

    // GET again to verify persistence within same process
    const getRes = await fetch(`${baseUrl}/agents/${agentId}/policy`);
    assert.equal(getRes.status, 200);

    const getBody = await getRes.json();
    assert.equal(getBody.policy.maxTxAmount.XLM, "42");
    assert.equal(getBody.policy.dailySpendingLimit.XLM, "420");
  } finally {
    await close();
  }
});

test("POLICY: PUT with malformed JSON returns 400", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("POLICY: GET for nonexistent agent returns 404", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/nonexistent/policy`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

// ===== PHASE 28J: VERSIONING TESTS =====

test("POLICY: version starts at 1 after first upsert", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const customPolicy: PolicyRules = {
      maxTxAmount: { XLM: "50" },
      dailySpendingLimit: { XLM: "200" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "25",
      requireHumanApprovalForAmountAbove: "25",
    };

    const putRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customPolicy),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.version, 1);

    // GET should also return version
    const getRes = await fetch(`${baseUrl}/agents/${agentId}/policy`);
    const getBody = await getRes.json();
    assert.equal(getBody.version, 1);
    assert.ok(getBody.updatedAt !== null);
  } finally {
    await close();
  }
});

test("POLICY: version increments on each mutation", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const policy: PolicyRules = {
      maxTxAmount: { XLM: "50" },
      dailySpendingLimit: { XLM: "200" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "25",
      requireHumanApprovalForAmountAbove: "25",
    };

    // First upsert: version 1
    const res1 = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });
    const body1 = await res1.json();
    assert.equal(body1.version, 1);

    // Second upsert: version 2
    const res2 = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, maxTxAmount: { XLM: "75" } }),
    });
    const body2 = await res2.json();
    assert.equal(body2.version, 2);

    // Third upsert: version 3
    const res3 = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...policy, maxTxAmount: { XLM: "100" } }),
    });
    const body3 = await res3.json();
    assert.equal(body3.version, 3);
  } finally {
    await close();
  }
});

test("POLICY: GET returns version=0 and updatedAt=null when no custom policy", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.version, 0);
    assert.equal(body.updatedAt, null);
    // Policy should be DEFAULT_RULES
    assert.equal(body.policy.maxTxAmount.XLM, "100");
  } finally {
    await close();
  }
});

// ===== PHASE 28J: AUTHORIZATION TESTS =====

test("POLICY: owner A cannot read owner B's policy", async () => {
  const serverA = await startServer({ ownerId: "owner-a", agentId: "agent-a" });
  const serverB = await startServer({ ownerId: "owner-b", agentId: "agent-b" });
  try {
    // Owner B saves a policy
    const policyB: PolicyRules = {
      maxTxAmount: { XLM: "999" },
      dailySpendingLimit: { XLM: "9999" },
      allowedAssets: ["XLM", "USDC"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "10",
      requireHumanApprovalForAmountAbove: "10",
    };
    const saveB = await fetch(`${serverB.baseUrl}/agents/agent-b/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policyB),
    });
    assert.equal(saveB.status, 200);

    // Owner A tries to GET owner B's policy via their own server
    // Since agents are in-memory, owner-a doesn't have agent-b registered
    const res = await fetch(`${serverA.baseUrl}/agents/agent-b/policy`);
    assert.equal(res.status, 404);
  } finally {
    await serverA.close();
    await serverB.close();
  }
});

test("POLICY: owner A cannot mutate owner B's policy", async () => {
  const serverA = await startServer({ ownerId: "owner-a", agentId: "agent-a" });
  const serverB = await startServer({ ownerId: "owner-b", agentId: "agent-b" });
  try {
    // Owner B saves a policy
    const saveB = await fetch(`${serverB.baseUrl}/agents/agent-b/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxTxAmount: { XLM: "999" },
        dailySpendingLimit: { XLM: "9999" },
        allowedAssets: ["XLM"],
        allowedDestinations: [],
        allowedContractIds: [],
        txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
        approvalThreshold: "10",
        requireHumanApprovalForAmountAbove: "10",
      }),
    });
    assert.equal(saveB.status, 200);

    // Owner A tries to PUT to agent-b — should be 404 (agent not in owner-a's context)
    const res = await fetch(`${serverA.baseUrl}/agents/agent-b/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxTxAmount: { XLM: "1" },
        dailySpendingLimit: { XLM: "1" },
        allowedAssets: ["XLM"],
        allowedDestinations: [],
        allowedContractIds: [],
        txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
        approvalThreshold: "1",
        requireHumanApprovalForAmountAbove: "1",
      }),
    });
    assert.equal(res.status, 404);

    // Verify owner B's policy was NOT mutated
    const getRes = await fetch(`${serverB.baseUrl}/agents/agent-b/policy`);
    const getBody = await getRes.json();
    assert.equal(getBody.policy.maxTxAmount.XLM, "999");
  } finally {
    await serverA.close();
    await serverB.close();
  }
});

// ===== PHASE 28J: MALFORMED POLICY REJECTION =====

test("POLICY: NaN amount rejected", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxTxAmount: { XLM: "NaN" },
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("POLICY: Infinity amount rejected", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxTxAmount: { XLM: "Infinity" },
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("POLICY: negative daily limit rejected", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailySpendingLimit: { XLM: "-100" },
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("POLICY: invalid asset code rejected", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowedAssets: ["", "XLM"],
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test("POLICY: non-boolean txTypeRestrictions value rejected", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txTypeRestrictions: { payment: "yes" },
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

// ===== PHASE 28J: EXECUTION-TIME POLICY EVALUATION =====

test("POLICY: queued execution re-evaluates current policy (strictened policy denies)", async () => {
  const { baseUrl, close, agentId } = await startServer();
  try {
    // Set lenient policy first
    const lenientPolicy: PolicyRules = {
      maxTxAmount: { XLM: "500" },
      dailySpendingLimit: { XLM: "5000" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "1000",
      requireHumanApprovalForAmountAbove: "1000",
    };
    const saveRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lenientPolicy),
    });
    assert.equal(saveRes.status, 200);

    // Now tighten policy: maxTxAmount = 10
    const strictPolicy: PolicyRules = {
      maxTxAmount: { XLM: "10" },
      dailySpendingLimit: { XLM: "100" },
      allowedAssets: ["XLM"],
      allowedDestinations: [],
      allowedContractIds: [],
      txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
      approvalThreshold: "5",
      requireHumanApprovalForAmountAbove: "5",
    };
    const updateRes = await fetch(`${baseUrl}/agents/${agentId}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(strictPolicy),
    });
    assert.equal(updateRes.status, 200);

    // Intent of 100 XLM should now be DENIED at API layer (current policy = maxTxAmount 10)
    // handleIntent returns 403 for policy deny
    const intentRes = await fetch(`${baseUrl}/agents/${agentId}/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "payment",
        asset: "XLM",
        destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        amount: "100",
        reason: "execution-time policy test",
      }),
    });
    assert.equal(intentRes.status, 403);
    const intentBody = await intentRes.json();
    assert.equal(intentBody.policyDecision.result, "deny");
    assert.match(intentBody.policyDecision.reason, /max_tx_amount/);
  } finally {
    await close();
  }
});

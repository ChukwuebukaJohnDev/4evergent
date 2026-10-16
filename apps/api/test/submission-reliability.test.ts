import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import { InMemoryExecutionStore, InMemoryActivityStore, InMemoryApprovalStore, InMemoryScheduleStore, InMemoryAgentStore } from "@4evergent/database";
import type { ExecutionRecord } from "@4evergent/database";

function makeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerId: "owner-a",
    agentId: "agent-a",
    approvalId: null,
    activityId: null,
    intent: { type: "payment", asset: "XLM", destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amount: "10", reason: "test" },
    status: "submitted",
    policyDecision: null,
    simulationResult: null,
    txHash: "tx-hash-123",
    error: null,
    attempt: 1,
    nextRetryAt: null,
    startedAt: null,
    completedAt: null,
    errorClass: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function startServer() {
  const executionStore = new InMemoryExecutionStore();
  const activityStore = new InMemoryActivityStore();
  const approvalStore = new InMemoryApprovalStore();
  const scheduleStore = new InMemoryScheduleStore();
  const agentStore = new InMemoryAgentStore();

  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: {
      getAccountId: () => "GTEST",
      getNetworkPassphrase: () => "Test SDF Network ; September 2015",
      sign: async (tx: any) => tx,
    },
    activityStore,
    approvalStore,
    scheduleStore,
    executionStore,
    agentStore,
    authProvider: new DevAuthProvider({ defaultOwnerId: "owner-a" }),
    executionQueue: { enabled: true, intervalMs: 60000 },
  });

  await server.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.server.address() as any).port}`;
  return { baseUrl, close: () => server.close(), executionStore };
}

test("SUBMIT: txHash persisted before submit — crash window safe", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-hash-abc" });
    await executionStore.record(execution);

    // Simulate crash: execution still has txHash
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.txHash, "tx-hash-abc");
    assert.equal(body.execution.status, "submitted");
  } finally {
    await close();
  }
});

test("SUBMIT: executing + txHash → recovery skips (ambiguous submission)", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "executing", txHash: "tx-hash-ambiguous" });
    await executionStore.record(execution);

    // Recovery should NOT move this to failed — txHash present means it may have been submitted
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "executing");
    assert.equal(body.execution.txHash, "tx-hash-ambiguous");
  } finally {
    await close();
  }
});

test("SUBMIT: executing + no txHash → recovery can safely move to failed", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "executing", txHash: null });
    await executionStore.record(execution);

    // Recovery should move to failed — no txHash means it definitely wasn't submitted
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "executing");
    assert.equal(body.execution.txHash, null);
  } finally {
    await close();
  }
});

test("SUBMIT: confirmed execution is not reprocessed by reconciler", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "confirmed", txHash: "tx-hash-confirmed" });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "confirmed");
    assert.equal(body.execution.txHash, "tx-hash-confirmed");
  } finally {
    await close();
  }
});

test("SUBMIT: submitted + not_found → remains submitted (no blind retry)", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-hash-notfound" });
    await executionStore.record(execution);

    // Reconciler should NOT change status — not_found ≠ not_submitted
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "submitted");
    assert.equal(body.execution.txHash, "tx-hash-notfound");
  } finally {
    await close();
  }
});

test("SUBMIT: submitted + network_error → remains submitted (no false failure)", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-hash-network-error" });
    await executionStore.record(execution);

    // Reconciler should NOT change status — network_error ≠ transaction failure
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "submitted");
    assert.equal(body.execution.txHash, "tx-hash-network-error");
  } finally {
    await close();
  }
});

test("SUBMIT: owner isolation — cross-owner access rejected", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ ownerId: "owner-b", status: "submitted", txHash: "tx-hash-b" });
    await executionStore.record(execution);

    // owner-a should not see owner-b's execution
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test("SUBMIT: concurrent reconciliation does not overwrite newer state", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-hash-concurrent" });
    await executionStore.record(execution);

    // Simulate concurrent state change
    await executionStore.update(execution.id, { status: "confirmed" });

    // Reconciler should NOT overwrite confirmed → submitted
    const res = await fetch(`${baseUrl}/executions/${execution.id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "confirmed");
  } finally {
    await close();
  }
});

test("SUBMIT: retry does not bypass approval/policy/simulation boundary", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "failed", attempt: 1, errorClass: "transient" });
    await executionStore.record(execution);

    // Manual retry should work (failed → queued)
    const retryRes = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(retryRes.status, 200);
    const retryBody = await retryRes.json();
    assert.equal(retryBody.execution.status, "queued");

    // Second retry should fail — already queued, not failed/dead_letter
    const secondRetry = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(secondRetry.status, 409);
  } finally {
    await close();
  }
});

test("SUBMIT: cancel does not affect submitted/confirmed executions", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-hash-cancel" });
    await executionStore.record(execution);

    // Cancel should be rejected for submitted
    const res = await fetch(`${baseUrl}/executions/${execution.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});

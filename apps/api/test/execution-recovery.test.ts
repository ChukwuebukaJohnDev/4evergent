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
    status: "failed",
    policyDecision: null,
    simulationResult: null,
    txHash: null,
    error: "Network timeout",
    attempt: 1,
    nextRetryAt: null,
    startedAt: null,
    completedAt: null,
    errorClass: "transient",
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

test("POST /executions/:id/retry — failed → queued", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "failed", attempt: 1, errorClass: "transient" });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "queued");
    assert.equal(body.execution.error, null);
    assert.equal(body.execution.nextRetryAt, null);
  } finally {
    await close();
  }
});

test("POST /executions/:id/retry — dead_letter → queued", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    // dead_letter with attempt < maxRetries (dead_letter can occur via permanent failure without exhausting retries)
    const execution = makeExecution({ status: "dead_letter", attempt: 2, errorClass: "permanent" });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "queued");
  } finally {
    await close();
  }
});

test("POST /executions/:id/retry — submitted → 409", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-123" });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});

test("POST /executions/:id/retry — confirmed → 409", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "confirmed", txHash: "tx-123" });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});

test("POST /executions/:id/retry — max attempts reached → 409", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "failed", attempt: 3, errorClass: "transient" });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /max retry attempts/);
  } finally {
    await close();
  }
});

test("POST /executions/:id/retry — not found → 404", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/executions/nonexistent/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test("POST /executions/:id/cancel — queued → dead_letter", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "queued", attempt: 0 });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "dead_letter");
    assert.equal(body.execution.error, "cancelled by user");
  } finally {
    await close();
  }
});

test("POST /executions/:id/cancel — executing → dead_letter", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "executing", attempt: 1 });
    await executionStore.record(execution);

    const res = await fetch(`${baseUrl}/executions/${execution.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.execution.status, "dead_letter");
  } finally {
    await close();
  }
});

test("POST /executions/:id/cancel — submitted → 409", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "submitted", txHash: "tx-123" });
    await executionStore.record(execution);

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

test("POST /executions/:id/cancel — confirmed → 409", async () => {
  const { baseUrl, close, executionStore } = await startServer();
  try {
    const execution = makeExecution({ status: "confirmed", txHash: "tx-123" });
    await executionStore.record(execution);

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

test("POST /executions/:id/cancel — not found → 404", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/executions/nonexistent/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

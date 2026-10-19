import { test } from "node:test";
import assert from "node:assert/strict";
import { TransactionStatusReconciler } from "../src/reconciler.js";
import { InMemoryExecutionStore } from "@4evergent/database";
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

test("Reconciler: submitted + confirmed → confirmed", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "submitted", txHash: "tx-1" });
  await store.record(execution);

  const provider = {
    getStatus: async () => "confirmed" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });
  const result = await reconciler.reconcile();

  assert.equal(result.checked, 1);
  assert.equal(result.confirmed, 1);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "confirmed");
  assert.ok(updated?.completedAt);
});

test("Reconciler: submitted + failed → failed", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "submitted", txHash: "tx-2" });
  await store.record(execution);

  const provider = {
    getStatus: async () => "failed" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });
  const result = await reconciler.reconcile();

  assert.equal(result.checked, 1);
  assert.equal(result.failed, 1);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "failed");
});

test("Reconciler: submitted + not_found → remains submitted", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "submitted", txHash: "tx-3" });
  await store.record(execution);

  const provider = {
    getStatus: async () => "not_found" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });
  const result = await reconciler.reconcile();

  assert.equal(result.checked, 1);
  assert.equal(result.confirmed, 0);
  assert.equal(result.failed, 0);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
});

test("Reconciler: submitted + network_error → remains submitted", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "submitted", txHash: "tx-4" });
  await store.record(execution);

  const provider = {
    getStatus: async () => "network_error" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });
  const result = await reconciler.reconcile();

  assert.equal(result.checked, 1);
  assert.equal(result.confirmed, 0);
  assert.equal(result.failed, 0);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
});

test("Reconciler: txHash missing → safely skipped", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "submitted", txHash: null });
  await store.record(execution);

  const provider = {
    getStatus: async () => "confirmed" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });
  const result = await reconciler.reconcile();

  assert.equal(result.checked, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.confirmed, 0);
});

test("Reconciler: confirmed execution is not reprocessed", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "confirmed", txHash: "tx-5" });
  await store.record(execution);

  const provider = {
    getStatus: async () => "confirmed" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });
  const result = await reconciler.reconcile();

  assert.equal(result.checked, 0);
  assert.equal(result.confirmed, 0);
});

test("Reconciler: concurrency — execution changes from submitted before update → conditional update prevents stale mutation", async () => {
  const store = new InMemoryExecutionStore();
  const execution = makeExecution({ status: "submitted", txHash: "tx-6" });
  await store.record(execution);

  const provider = {
    getStatus: async () => "confirmed" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });

  // Simulate concurrent state change: another actor moves execution to failed
  await store.update(execution.id, { status: "failed" });

  const result = await reconciler.reconcile();

  // Should not update because status changed from submitted to failed
  assert.equal(result.confirmed, 0);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "failed");
});

test("Reconciler: start/stop lifecycle", async () => {
  const store = new InMemoryExecutionStore();
  const provider = {
    getStatus: async () => "confirmed" as const,
  };

  const reconciler = new TransactionStatusReconciler(store, provider, { intervalMs: 60000 });

  assert.equal(reconciler.isRunning(), false);
  reconciler.start();
  assert.equal(reconciler.isRunning(), true);
  reconciler.stop();
  assert.equal(reconciler.isRunning(), false);
});

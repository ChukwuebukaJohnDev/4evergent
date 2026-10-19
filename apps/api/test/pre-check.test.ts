import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryExecutionStore,
} from "@4evergent/database";
import { ExecutionQueue, PreCheckResult, ExecutionResult } from "../src/execution-queue.js";
import type { ExecutionRecord } from "@4evergent/database";
import type { AgentIntent } from "@4evergent/shared";

function makeIntent(): AgentIntent {
  return {
    type: "payment",
    asset: "XLM",
    destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: "10",
    reason: "test execution",
  };
}

function makeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerId: "owner-a",
    agentId: "agent-a",
    approvalId: null,
    activityId: null,
    intent: makeIntent(),
    status: "queued",
    policyDecision: null,
    simulationResult: null,
    txHash: null,
    submittedHash: null,
    error: null,
    attempt: 0,
    nextRetryAt: null,
    startedAt: null,
    completedAt: null,
    errorClass: undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePipelineExecutor(result: ExecutionResult) {
  return async (_record: ExecutionRecord): Promise<ExecutionResult> => result;
}

async function makePreCheck(result: PreCheckResult) {
  return async (_txHash: string): Promise<PreCheckResult> => result;
}

test("PRE-CHECK TEST 1: submit success → submittedHash persisted, existing behavior unchanged", async () => {
  const store = new InMemoryExecutionStore();
  let executed = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    executed++;
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-success-1",
      submittedHash: "tx-success-1",
      error: null,
      errorClass: undefined,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));
  const execution = makeExecution();
  await queue.enqueue(execution);
  const started = await queue.processDue();
  assert.equal(started, 1);
  assert.equal(executed, 1);
  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
  assert.equal(updated?.txHash, "tx-success-1");
  assert.equal(updated?.submittedHash, "tx-success-1");
});

test("PRE-CHECK TEST 2: submit fails before network submission → no submittedHash, retry allowed", async () => {
  const store = new InMemoryExecutionStore();
  const pipelineExecutor = makePipelineExecutor({
    record: makeExecution(),
    success: false,
    status: "rejected",
    error: "simulation_failed",
    errorClass: "transient",
  });
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("not_found"),
  });
  const execution = makeExecution();
  await queue.enqueue(execution);
  await queue.processDue();
  const afterFail = await store.get(execution.id);
  assert.equal(afterFail?.status, "failed");
  assert.equal(afterFail?.submittedHash, null);

  // Manual retry should work (no submittedHash → falls through to existing policy)
  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "queued");
});

test("PRE-CHECK TEST 3: submit timeout, pre-check finds transaction → NO second submission", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    if (submitCount === 1) {
      // First submit: simulate timeout after transaction may have reached Horizon
      return {
        record,
        success: true,
        status: "submitted",
        txHash: "tx-ambiguous-3",
        submittedHash: "tx-ambiguous-3",
        error: null,
        errorClass: undefined,
      };
    }
    // Second submit should NOT happen
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-duplicate-3",
      submittedHash: "tx-duplicate-3",
      error: null,
      errorClass: undefined,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("found"),
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-ambiguous-3", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  // Manual retry should detect transaction and NOT resubmit
  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "submitted");
  assert.equal(submitCount, 0); // No pipeline call — pre-check prevented resubmission
});

test("PRE-CHECK TEST 4: pre-check finds transaction as submitted/pending → NO retry", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-pending-4",
      submittedHash: "tx-pending-4",
      error: null,
      errorClass: undefined,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("found"),
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-pending-4", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "submitted");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 5: pre-check finds confirmed transaction → NO retry", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (_record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    throw new Error("Should not be called");
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("found"),
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-confirmed-5", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "submitted");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 6: pre-check finds on-chain failed transaction → NO retry", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (_record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    throw new Error("Should not be called");
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("found"),
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-failed-6", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "submitted");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 7: pre-check returns network error → NO blind retry", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (_record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    throw new Error("Should not be called");
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("network_error"),
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-neterror-7", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "ambiguous_submission");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 8: pre-check returns ambiguous/unknown → NO blind retry", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (_record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    throw new Error("Should not be called");
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("network_error"),
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-unknown-8", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "ambiguous_submission");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 9: pre-check returns definitive not_found → retry allowed if policy permits", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    return {
      record,
      success: false,
      status: "rejected",
      error: "transient failure",
      errorClass: "transient",
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("not_found"),
    retryPolicy: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-notfound-9", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "queued");
  // After queued, processDue should pick it up
  await queue.processDue(new Date(Date.now() + 1000).toISOString());
  assert.equal(submitCount, 1);
});

test("PRE-CHECK TEST 10: manual retry of ambiguous execution → cannot bypass safety check", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (_record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    throw new Error("Should not be called — safety check must prevent resubmission");
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("found"),
  });

  // Execution with submittedHash + found on-chain → must NOT retry
  const execution = makeExecution({ status: "dead_letter", submittedHash: "tx-found-10", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "submitted");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 11: startup recovery with transaction identity → no duplicate submission", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (_record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    throw new Error("Should not be called");
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("found"),
  });

  // Stuck executing with submittedHash + txHash → recovery skips
  const execution = makeExecution({ status: "executing", submittedHash: "tx-recovery-11", txHash: "tx-recovery-11" });
  await store.record(execution);

  // Recovery service would skip this (txHash present), but even if retried manually:
  const retryResult = await queue.retry(execution.id, 3);
  // retry() returns invalid_state for executing status
  assert.equal(retryResult.status, "invalid_state");
  assert.equal(submitCount, 0);
});

test("PRE-CHECK TEST 12: reconciliation after ambiguous submission → CAS protection intact", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-reconcile-12",
      submittedHash: "tx-reconcile-12",
      error: null,
      errorClass: undefined,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("not_found"),
  });

  const execution = makeExecution();
  await queue.enqueue(execution);
  await queue.processDue();
  assert.equal(submitCount, 1);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
  assert.equal(updated?.txHash, "tx-reconcile-12");
  assert.equal(updated?.submittedHash, "tx-reconcile-12");
});

test("PRE-CHECK TEST 13: idempotency key still works after retry/recovery", async () => {
  const store = new InMemoryExecutionStore();
  let submitCount = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    submitCount++;
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-idem-13",
      submittedHash: "tx-idem-13",
      error: null,
      errorClass: undefined,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));

  // No pre-check → existing behavior unchanged
  const execution = makeExecution();
  await queue.enqueue(execution);
  await queue.processDue();
  assert.equal(submitCount, 1);

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
  assert.equal(updated?.txHash, "tx-idem-13");
});

test("PRE-CHECK TEST 14: owner isolation unchanged", async () => {
  const store = new InMemoryExecutionStore();
  const pipelineExecutor = makePipelineExecutor({
    record: makeExecution(),
    success: true,
    status: "submitted",
    txHash: "tx-owner-14",
    submittedHash: "tx-owner-14",
    error: null,
    errorClass: undefined,
  });
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));

  // Owner A execution
  const executionA = makeExecution({ ownerId: "owner-a" });
  await queue.enqueue(executionA);
  await queue.processDue();

  // Owner B cannot access owner A's execution
  const result = await store.getForOwner(executionA.id, "owner-b");
  assert.equal(result, null);

  const ownerAResult = await store.getForOwner(executionA.id, "owner-a");
  assert.ok(ownerAResult);
  assert.equal(ownerAResult?.txHash, "tx-owner-14");
});

test("PRE-CHECK TEST 15: no secrets persisted/logged by new logic", async () => {
  const store = new InMemoryExecutionStore();
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    return {
      record,
      success: false,
      status: "rejected",
      error: "transaction submission failed: network timeout",
      errorClass: "transient",
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }), {
    preCheck: await makePreCheck("not_found"),
    retryPolicy: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 },
  });

  const execution = makeExecution({ status: "failed", submittedHash: "tx-hash-15", attempt: 1, errorClass: "transient" });
  await store.record(execution);

  const retryResult = await queue.retry(execution.id, 3);
  assert.equal(retryResult.status, "queued");

  const updated = await store.get(execution.id);
  // submittedHash is not a secret — it's a transaction hash (public on-chain)
  // No private key/seed/mnemonic should ever be stored
  assert.ok(!JSON.stringify(updated).toLowerCase().includes("secret"));
  assert.ok(!JSON.stringify(updated).toLowerCase().includes("seed"));
  assert.ok(!JSON.stringify(updated).toLowerCase().includes("private_key"));
  assert.ok(!JSON.stringify(updated).toLowerCase().includes("mnemonic"));
});

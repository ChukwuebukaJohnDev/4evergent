/**
 * Integration test: transaction status reconciler + execution queue lifecycle
 * on the same execution record.
 *
 * Ownership contract (the contract this test enforces):
 *   - The execution queue (`apps/api/src/execution-queue.ts`) owns the claim and
 *     attempt lifecycle: queued -> executing -> submitted, and failed ->
 *     queued/executing -> ... -> dead_letter once attempts are exhausted.
 *   - The transaction status reconciler (`packages/stellar/src/reconciler.ts`)
 *     owns the network-status transitions for a submitted record: submitted ->
 *     confirmed / failed, and leaves the record submitted for not_found /
 *     network_error.
 *
 * The two mechanisms meet on the same record, so the test drives the *real*
 * `ExecutionQueue` and the *real* `TransactionStatusReconciler` over one
 * `InMemoryExecutionStore`, with a scripted pipeline executor and a
 * deterministic status provider. No HTTP server and no real timers are
 * involved: every pass is an explicit `processDue()` / `reconcile()` call, so
 * the assertions are not timing-dependent.
 *
 * This mirrors the established harness in `execution-queue-integration.test.ts`
 * (direct construction of the queue over an in-memory store) rather than the
 * application server, because executions are created by the approval and
 * schedule paths — there is no `POST /executions` route to drive.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryExecutionStore } from "@4evergent/database";
import type { ExecutionRecord } from "@4evergent/database";
import type { AgentIntent } from "@4evergent/shared";
import {
  TransactionStatusReconciler,
  type TransactionStatus,
  type TransactionStatusProvider,
} from "@4evergent/stellar";
import { ExecutionQueue } from "../src/execution-queue.js";

// -----------------------------------------------------------------------------
// Fake status provider: deterministic, no network.
// -----------------------------------------------------------------------------

class FakeStatusProvider implements TransactionStatusProvider {
  /** Every tx hash the reconciler asked about, in order. */
  public readonly calls: string[] = [];
  private readonly responses = new Map<string, TransactionStatus>();
  private defaultResponse: TransactionStatus = "not_found";

  /**
   * Optional hook run *inside* `getStatus`, before it resolves. Tests use it to
   * simulate a concurrent writer landing between the reconciler's read and its
   * write.
   */
  public onStatus?: (txHash: string) => Promise<void> | void;

  set(hash: string, result: TransactionStatus): void {
    this.responses.set(hash, result);
  }

  setDefault(result: TransactionStatus): void {
    this.defaultResponse = result;
  }

  async getStatus(txHash: string): Promise<TransactionStatus> {
    this.calls.push(txHash);
    if (this.onStatus) await this.onStatus(txHash);
    return this.responses.get(txHash) ?? this.defaultResponse;
  }
}

// -----------------------------------------------------------------------------
// Harness — one isolated store / queue / reconciler per test.
// -----------------------------------------------------------------------------

/** What the scripted pipeline executor does on one pass. */
type PipelineStep = "submitted" | "transient_failure";

interface Harness {
  store: InMemoryExecutionStore;
  queue: ExecutionQueue;
  reconciler: TransactionStatusReconciler;
  provider: FakeStatusProvider;
  /** Number of times the pipeline executor ran. */
  executions: () => number;
  /** Close everything this harness opened. */
  stop: () => void;
}

const RETRY_POLICY = { maxRetries: 2, baseDelayMs: 5_000, maxDelayMs: 5_000 };

/**
 * Build a fresh harness. The queue and reconciler are never `start()`ed: their
 * timer loops would race the explicit passes this suite makes, and starting
 * them would leave workers behind if an assertion failed mid-test. `stop()` is
 * still called after every test so the resources are released deterministically.
 */
function makeHarness(steps: PipelineStep[] = []): Harness {
  const store = new InMemoryExecutionStore();
  const provider = new FakeStatusProvider();
  let executed = 0;

  const pipelineExecutor = async (
    record: ExecutionRecord,
  ): Promise<{
    record: ExecutionRecord;
    success: boolean;
    status: string;
    txHash?: string;
    submittedHash?: string | null;
    error?: string;
    errorClass?: string;
  }> => {
    const step = steps[executed] ?? "submitted";
    executed += 1;
    if (step === "transient_failure") {
      // "timeout" is one of the queue's TRANSIENT_PATTERNS, so this failure is
      // retryable rather than immediately permanent.
      throw new Error("horizon timeout while submitting");
    }
    const txHash = `tx-${executed}`;
    return {
      record,
      success: true,
      status: "submitted",
      txHash,
      submittedHash: txHash,
      error: undefined,
    };
  };

  const queue = new ExecutionQueue(
    store,
    pipelineExecutor,
    async () => ({
      accountId: () => "GACCOUNT",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    }),
    { intervalMs: 60_000, retryPolicy: RETRY_POLICY },
  );

  const reconciler = new TransactionStatusReconciler(store, provider, {
    intervalMs: 60_000,
  });

  return {
    store,
    queue,
    reconciler,
    provider,
    executions: () => executed,
    stop: () => {
      queue.stop();
      reconciler.stop();
    },
  };
}

function makeIntent(): AgentIntent {
  return {
    type: "payment",
    asset: "XLM",
    destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: "10",
    reason: "reconciler/queue lifecycle test",
  };
}

function makeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerId: "owner-a",
    agentId: "agent-a",
    approvalId: "approval-a",
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
    errorClass: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function getRecord(
  harness: Harness,
  id: string,
): Promise<ExecutionRecord> {
  const record = await harness.store.get(id);
  assert.ok(record, `execution ${id} must exist`);
  return record;
}

/** Enqueue one execution and drive the queue once; returns the submitted record. */
async function submitOnce(harness: Harness): Promise<ExecutionRecord> {
  const execution = makeExecution();
  await harness.queue.enqueue(execution);
  await harness.queue.processDue();
  const submitted = await getRecord(harness, execution.id);
  assert.equal(submitted.status, "submitted");
  assert.ok(submitted.txHash, "a submitted record must carry a tx hash");
  return submitted;
}

// -----------------------------------------------------------------------------
// Tests.
// -----------------------------------------------------------------------------

test("confirmed path: queue submits, then the reconciler confirms the same hash", async (t) => {
  const harness = makeHarness();
  t.after(() => harness.stop());

  const submitted = await submitOnce(harness);
  assert.equal(harness.executions(), 1);

  harness.provider.set(submitted.txHash!, "confirmed");
  const result = await harness.reconciler.reconcile();

  assert.deepEqual(result, {
    checked: 1,
    confirmed: 1,
    failed: 0,
    skipped: 0,
    errors: 0,
  });

  const final = await getRecord(harness, submitted.id);
  assert.equal(final.status, "confirmed");
  assert.equal(final.txHash, submitted.txHash, "confirmation must preserve the tx hash");
  assert.equal(final.error, null);
  assert.ok(final.completedAt, "a confirmed record must be completed");
});

test("failed path: reconciler fails the record, retries exhaust, then dead_letter", async (t) => {
  const harness = makeHarness(["submitted", "transient_failure", "transient_failure"]);
  t.after(() => harness.stop());

  const submitted = await submitOnce(harness);

  // Reconciler observes the on-chain failure and marks the record failed.
  harness.provider.set(submitted.txHash!, "failed");
  const reconciled = await harness.reconciler.reconcile();
  assert.equal(reconciled.failed, 1);
  const failed = await getRecord(harness, submitted.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Transaction failed on-chain");

  // Retry attempt 1: the queue claims the failed record. The pipeline fails
  // transiently, so the record stays failed with a backoff timestamp.
  await harness.queue.processDue();
  const retried = await getRecord(harness, submitted.id);
  assert.equal(retried.status, "failed");
  assert.equal(retried.attempt, 1);
  assert.ok(retried.nextRetryAt, "a retryable failure must schedule a retry");
  assert.notEqual(retried.status, "dead_letter");

  // The backoff must gate the next attempt: not due at the current clock.
  assert.equal(await harness.queue.processDue(), 0, "record must not be due yet");

  // Past the backoff, attempt 2 exhausts maxRetries=2 -> dead_letter.
  const afterBackoff = new Date(Date.now() + 60_000).toISOString();
  assert.equal(await harness.queue.processDue(afterBackoff), 1);

  const dead = await getRecord(harness, submitted.id);
  assert.equal(dead.status, "dead_letter");
  assert.equal(dead.attempt, 2);
  assert.equal(dead.nextRetryAt, null);
  assert.equal(harness.executions(), 3, "one submit + two failed retries");
});

test("not_found: record stays submitted and the queue never blind-retries it", async (t) => {
  const harness = makeHarness();
  t.after(() => harness.stop());

  const submitted = await submitOnce(harness);

  harness.provider.set(submitted.txHash!, "not_found");
  const result = await harness.reconciler.reconcile();
  assert.equal(result.checked, 1);
  assert.equal(result.confirmed + result.failed, 0);

  const after = await getRecord(harness, submitted.id);
  assert.equal(after.status, "submitted");
  assert.equal(after.txHash, submitted.txHash);

  // Driving the queue again (even far past any backoff) must not re-submit.
  const later = new Date(Date.now() + 60_000).toISOString();
  assert.equal(await harness.queue.processDue(later), 0);
  const afterQueue = await getRecord(harness, submitted.id);
  assert.equal(afterQueue.status, "submitted");
  assert.equal(afterQueue.txHash, submitted.txHash);
  assert.equal(harness.executions(), 1);
});

test("network_error: record stays submitted and is not retried", async (t) => {
  const harness = makeHarness();
  t.after(() => harness.stop());

  const submitted = await submitOnce(harness);

  harness.provider.set(submitted.txHash!, "network_error");
  const result = await harness.reconciler.reconcile();
  assert.equal(result.checked, 1);
  assert.equal(result.failed, 0);

  const after = await getRecord(harness, submitted.id);
  assert.equal(after.status, "submitted");
  assert.equal(after.txHash, submitted.txHash);
  assert.equal(after.error, null);
});

test("concurrent write: the reconciler does not overwrite a newer state (stale-write guard)", async (t) => {
  const harness = makeHarness();
  t.after(() => harness.stop());

  const submitted = await submitOnce(harness);

  // Synchronization seam: while the reconciler is awaiting the status provider
  // for this record, another writer moves it submitted -> confirmed. The
  // reconciler then reports "failed" and tries to write failed over the
  // record it read as submitted. That conditional write must lose.
  let concurrentWriteApplied = false;
  harness.provider.set(submitted.txHash!, "failed");
  harness.provider.onStatus = async (txHash) => {
    if (txHash !== submitted.txHash || concurrentWriteApplied) return;
    concurrentWriteApplied = true;
    const updated = await harness.store.updateIfStatus(submitted.id, "submitted", {
      status: "confirmed",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.ok(updated, "the concurrent write must win the race it starts first");
  };

  const result = await harness.reconciler.reconcile();
  assert.ok(concurrentWriteApplied, "the concurrent write must have happened");
  assert.equal(result.checked, 1);
  assert.equal(result.failed, 0, "the stale failed-write must not be counted as applied");

  const after = await getRecord(harness, submitted.id);
  assert.equal(after.status, "confirmed", "the newer state must be preserved");
  assert.equal(after.txHash, submitted.txHash);
  assert.equal(after.error, null, "no stale error may be written over the newer state");
});

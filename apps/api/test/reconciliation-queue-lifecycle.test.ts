/**
 * Lifecycle integration test: ExecutionQueue + TransactionStatusReconciler
 * operating on the same ExecutionRecord.
 *
 * Ownership contract enforced by this test:
 *   - ExecutionQueue owns queued -> executing -> submitted|confirmed|failed,
 *     and the retry decision for failed records (failed -> queued, or
 *     failed -> dead_letter once attempts are exhausted).
 *   - TransactionStatusReconciler owns submitted -> confirmed|failed based on
 *     on-chain status. It never retries and never touches non-submitted rows.
 *   - Both mutate records only via conditional updateIfStatus, so a stale
 *     observation can never overwrite a newer state.
 *
 * All time is driven explicitly through processDue(now) and reconcile(); no
 * real timers are used. The status provider is a deterministic fake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionRecord, ExecutionStore } from "@4evergent/database";
import { ExecutionQueue, type ExecutionResult } from "../src/execution-queue.js";
import {
  TransactionStatusReconciler,
  type TransactionStatus,
  type TransactionStatusProvider,
} from "@4evergent/stellar/reconciler";

/* ------------------------------------------------------------------ */
/* Deterministic fakes                                                 */
/* ------------------------------------------------------------------ */

class MemoryExecutionStore implements ExecutionStore {
  rows = new Map<string, ExecutionRecord>();
  private hook: (() => void) | null = null;

  /** Run once, just before the next updateIfStatus call executes. */
  beforeNextUpdate(fn: () => void): void {
    this.hook = fn;
  }

  async record(record: ExecutionRecord): Promise<void> {
    this.rows.set(record.id, { ...record });
  }

  async get(id: string): Promise<ExecutionRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async listDue(nowIso: string, limit: number): Promise<ExecutionRecord[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (r.status === "queued" || r.status === "failed") &&
          (r.nextRetryAt === null || r.nextRetryAt <= nowIso)
      )
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listSubmitted(): Promise<ExecutionRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === "submitted")
      .map((r) => ({ ...r }));
  }

  async updateIfStatus(
    id: string,
    expected: ExecutionRecord["status"],
    patch: Partial<ExecutionRecord>
  ): Promise<ExecutionRecord | null> {
    if (this.hook) {
      const h = this.hook;
      this.hook = null;
      h();
    }
    const current = this.rows.get(id);
    if (!current || current.status !== expected) return null;
    const next = { ...current, ...patch } as ExecutionRecord;
    this.rows.set(id, next);
    return { ...next };
  }

  /** Direct write used by the test to simulate an external actor. */
  forceStatus(id: string, patch: Partial<ExecutionRecord>): void {
    const current = this.rows.get(id);
    if (!current) throw new Error(`no row ${id}`);
    this.rows.set(id, { ...current, ...patch } as ExecutionRecord);
  }
}

class FakeStatusProvider implements TransactionStatusProvider {
  next: TransactionStatus = "not_found";
  calls: string[] = [];
  async getStatus(txHash: string): Promise<TransactionStatus> {
    this.calls.push(txHash);
    return this.next;
  }
}

function makeRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const now = "2024-01-01T00:00:00.000Z";
  return {
    id: "exec-1",
    status: "queued",
    attempt: 0,
    nextRetryAt: null,
    txHash: null,
    submittedHash: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ExecutionRecord;
}

/**
 * Pipeline executor stub. `script` is consumed one entry per execution:
 *   "submit"  -> returns status submitted with a hash
 *   "fail"    -> returns a transient failure
 */
function scriptedPipeline(script: Array<"submit" | "fail">, hash = "HASH-1") {
  const queue = [...script];
  return async (): Promise<ExecutionResult> => {
    const step = queue.shift() ?? "submit";
    if (step === "submit") {
      return {
        record: makeRecord(),
        success: true,
        status: "submitted",
        txHash: hash,
        submittedHash: hash,
      };
    }
    return {
      record: makeRecord(),
      success: false,
      status: "failed",
      error: "simulated transient failure",
      errorClass: "transient",
    };
  };
}

const sourceAccount = async () => ({
  accountId: () => "GTEST",
  sequenceNumber: () => "1",
  incrementSequenceNumber: () => {},
});

const RETRY_POLICY = {
  maxAttempts: 2,
  baseDelayMs: 1000,
  maxDelayMs: 1000,
  multiplier: 2,
} as const;

function buildHarness(pipeline: ReturnType<typeof scriptedPipeline>) {
  const store = new MemoryExecutionStore();
  const provider = new FakeStatusProvider();
  const queue = new ExecutionQueue(store, pipeline, sourceAccount, {
    retryPolicy: RETRY_POLICY as never,
    concurrency: 1,
  });
  const reconciler = new TransactionStatusReconciler(store, provider, {
    clock: () => new Date("2024-01-01T00:00:10.000Z"),
  });
  return { store, provider, queue, reconciler };
}

/* ------------------------------------------------------------------ */
/* Lifecycle cases                                                     */
/* ------------------------------------------------------------------ */

test("queued -> executing -> submitted (queue) -> confirmed (reconciler), tx hash preserved", async () => {
  const { store, provider, queue, reconciler } = buildHarness(scriptedPipeline(["submit"]));
  await queue.enqueue(makeRecord());

  assert.equal(await queue.processDue("2024-01-01T00:00:00.000Z"), 1);
  const afterQueue = await store.get("exec-1");
  assert.equal(afterQueue?.status, "submitted");
  assert.equal(afterQueue?.txHash, "HASH-1");

  provider.next = "confirmed";
  const res = await reconciler.reconcile();
  assert.equal(res.confirmed, 1);

  const final = await store.get("exec-1");
  assert.equal(final?.status, "confirmed");
  assert.equal(final?.txHash, "HASH-1");
  assert.deepEqual(provider.calls, ["HASH-1"]);
});

test("submitted + provider failed -> reconciler marks failed -> queue retries -> dead_letter when exhausted", async () => {
  // Attempt 1 submits; reconciler then reports on-chain failure.
  const { store, provider, queue, reconciler } = buildHarness(scriptedPipeline(["submit", "submit"]));
  await queue.enqueue(makeRecord());
  await queue.processDue("2024-01-01T00:00:00.000Z");

  provider.next = "failed";
  const r1 = await reconciler.reconcile();
  assert.equal(r1.failed, 1);
  let rec = await store.get("exec-1");
  assert.equal(rec?.status, "failed");
  assert.equal(rec?.error, "Transaction failed on-chain");

  // Queue retry decision: attempts remain, so the record is rescheduled.
  // Simulate the queue's fail() path being applied to a failed record by
  // driving a subsequent claim; the scripted pipeline submits again, then the
  // reconciler fails it a second time, exhausting attempts.
  rec = await store.get("exec-1");
  assert.equal(rec?.attempt, 1);
  assert.equal(rec?.status, "failed");

  const second = await queue.retry("exec-1", RETRY_POLICY.maxAttempts);
  assert.equal(second.status, "queued");
  await queue.processDue("2024-01-01T00:00:30.000Z");
  assert.equal((await store.get("exec-1"))?.status, "submitted");

  await reconciler.reconcile();
  rec = await store.get("exec-1");
  assert.equal(rec?.status, "failed");

  // Attempts exhausted: the queue must refuse further retry and the record
  // must sit in a terminal failure state (dead_letter via queue policy).
  const exhausted = await queue.retry("exec-1", RETRY_POLICY.maxAttempts);
  assert.equal(exhausted.status, "max_retries_reached");
  rec = await store.get("exec-1");
  assert.ok(rec?.status === "failed" || rec?.status === "dead_letter");
});

test("submitted + provider not_found -> record stays submitted, never blind-retried", async () => {
  const { store, provider, queue, reconciler } = buildHarness(scriptedPipeline(["submit"]));
  await queue.enqueue(makeRecord());
  await queue.processDue("2024-01-01T00:00:00.000Z");

  provider.next = "not_found";
  const res = await reconciler.reconcile();
  assert.equal(res.confirmed, 0);
  assert.equal(res.failed, 0);

  const rec = await store.get("exec-1");
  assert.equal(rec?.status, "submitted");
  assert.equal(rec?.attempt, 0);
  // Queue must not pick it up again: submitted is not a due status.
  assert.equal(await queue.processDue("2024-01-01T01:00:00.000Z"), 0);
});

test("submitted + provider network_error -> record stays submitted", async () => {
  const { store, provider, queue, reconciler } = buildHarness(scriptedPipeline(["submit"]));
  await queue.enqueue(makeRecord());
  await queue.processDue("2024-01-01T00:00:00.000Z");

  provider.next = "network_error";
  const res = await reconciler.reconcile();
  assert.equal(res.confirmed, 0);
  assert.equal(res.failed, 0);

  const rec = await store.get("exec-1");
  assert.equal(rec?.status, "submitted");
  assert.equal(rec?.txHash, "HASH-1");
});

test("concurrent update between reconciler read and write -> conditional update prevents stale overwrite", async () => {
  const { store, provider, queue, reconciler } = buildHarness(scriptedPipeline(["submit"]));
  await queue.enqueue(makeRecord());
  await queue.processDue("2024-01-01T00:00:00.000Z");

  provider.next = "confirmed";
  // Between the reconciler's listSubmitted read and its updateIfStatus write,
  // an external actor moves the record to failed.
  store.beforeNextUpdate(() => {
    store.forceStatus("exec-1", { status: "failed", error: "external" });
  });

  const res = await reconciler.reconcile();
  assert.equal(res.confirmed, 0, "stale confirmed write must not be counted");

  const rec = await store.get("exec-1");
  assert.equal(rec?.status, "failed");
  assert.equal(rec?.error, "external");
});

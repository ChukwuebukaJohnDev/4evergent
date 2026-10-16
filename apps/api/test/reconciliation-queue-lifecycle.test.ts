/**
 * Integration test: reconciler + execution queue lifecycle together.
 *
 * Ownership contract (the contract this test enforces):
 *   - The execution queue (apps/api/src/execution-queue.ts) owns the claim and
 *     the attempt/retry lifecycle: queued -> executing -> submitted, and the
 *     transition from failed -> queued -> ... -> dead_letter once attempts
 *     are exhausted.
 *   - The transaction status reconciler (packages/stellar/src/reconciler.ts)
 *     owns the network-status transitions for a submitted record:
 *     submitted -> confirmed / failed, and leaves the record submitted for
 *     not_found / network_error.
 *
 * The two mechanisms meet on the same record. This test drives both together,
 * with a deterministic fake status provider and explicit `processDue()`
 * calls (no real timers).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createApp } from '../src/index.js';
import type { AppOptions } from '../src/index.js';
import type { ExecutionQueue } from '../src/execution-queue.js';
import type { TransactionStatusReconciler } from '@4evergent/stellar/reconciler';
import type {
  TransactionStatusProvider,
  TransactionStatusResult,
} from '@4evergent/stellar/reconciler';
import type { ExecutionRecord } from '@4evergent/database/execution-types';

// -----------------------------------------------------------------------------
// Fake status provider: deterministic, no network.
// -----------------------------------------------------------------------------

class FakeStatusProvider implements TransactionStatusProvider {
  public calls: string[] = [];
  private responses = new Map<string, TransactionStatusResult>();
  private defaultResponse: TransactionStatusResult = { status: 'not_found' };

  set(hash: string, result: TransactionStatusResult): void {
    this.responses.set(hash, result);
  }

  setDefault(result: TransactionStatusResult): void {
    this.defaultResponse = result;
  }

  async getStatus(txHash: string): Promise<TransactionStatusResult> {
    this.calls.push(txHash);
    return this.responses.get(txHash) ?? this.defaultResponse;
  }
}

// -----------------------------------------------------------------------------
// HTTP test harness (local to this file).
// -----------------------------------------------------------------------------

interface TestHarness {
  baseUrl: string;
  close: () => Promise<void>;
  server: AppOptions['server'];
}

async function startServer(options: AppOptions): Promise<TestHarness> {
  const app = await createApp(options);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    server: options.server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

async function getExecution(
  baseUrl: string,
  id: string,
): Promise<ExecutionRecord | undefined> {
  const res = await fetch(`${baseUrl}/executions/${id}`);
  if (res.status === 404) return undefined;
  assert.strictEqual(res.status, 200, `unexpected status ${res.status}`);
  const body = (await res.json()) as { execution: ExecutionRecord };
  return body.execution;
}

async function submitExecution(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<ExecutionRecord> {
  const res = await fetch(`${baseUrl}/executions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.strictEqual(res.status, 201, `body: ${await res.text()}`);
  const json = (await res.json()) as { execution: ExecutionRecord };
  return json.execution;
}

// -----------------------------------------------------------------------------
// Tests.
// -----------------------------------------------------------------------------

let tmpDir: string;
let harness: TestHarness | undefined;
let queue: ExecutionQueue | undefined;
let reconciler: TransactionStatusReconciler | undefined;
let provider: FakeStatusProvider;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'reconciler-queue-'));
});

after(async () => {
  if (harness) {
    await harness.close();
    harness = undefined;
  }
  if (queue) {
    queue.stop();
    queue = undefined;
  }
  if (reconciler) {
    reconciler.stop();
    reconciler = undefined;
  }
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function bootstrap(): Promise<void> {
  provider = new FakeStatusProvider();
  const options: AppOptions = {
    server: {
      dataDir: tmpDir,
      port: 0,
    },
    executionQueue: {
      enabled: true,
      intervalMs: 60000,
      maxAttempts: 2,
    },
    reconciliation: {
      enabled: true,
      intervalMs: 60000,
      instance: provider,
    },
  };
  harness = await startServer(options);
  queue = harness.server.executionQueue;
  reconciler = harness.server.reconciler;
  assert.ok(queue, 'execution queue must be constructed');
  assert.ok(reconciler, 'reconciler must be constructed');
}

test('confirmed path: queue submits, then reconciler confirms', async () => {
  await bootstrap();
  const created = await submitExecution(harness!.baseUrl, {
    agentId: 'agent-101',
    type: 'transfer',
    params: { to: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '1' },
  });
  assert.strictEqual(created.status, 'queued');

  // Drive the queue explicitly -- no real timers.
  await queue!.processDue();
  const afterQueue = await getExecution(harness!.baseUrl, created.id);
  assert.ok(afterQueue);
  assert.strictEqual(afterQueue!.status, 'submitted');
  const txHash = afterQueue!.txHash;
  assert.ok(txHash, 'submitted record must have a tx hash');

  // Reconciler confirms.
  provider.set(txHash!, { status: 'confirmed', ledger: 12345 });
  await reconciler!.processDue();

  const final = await getExecution(harness!.baseUrl, created.id);
  assert.ok(final);
  assert.strictEqual(final!.status, 'confirmed');
  assert.strictEqual(final!.txHash, txHash);
});

test('failed path: reconciler marks failed, queue retries, then dead_letter', async () => {
  await bootstrap();
  const created = await submitExecution(harness!.baseUrl, {
    agentId: 'agent-202',
    type: 'transfer',
    params: { to: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '1' },
  });

  await queue!.processDue();
  const submitted = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(submitted!.status, 'submitted');
  const txHash = submitted!.txHash!;

  // Reconciler observes failure.
  provider.set(txHash, { status: 'failed', reason: 'tx_failed' });
  await reconciler!.processDue();
  const failed = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(failed!.status, 'failed');

  // Queue retry policy applies: failed -> queued -> executing -> submitted.
  await queue!.processDue();
  const retried = await getExecution(harness!.baseUrl, created.id);
  assert.ok(retried);
  assert.notStrictEqual(retried!.status, 'dead_letter');

  // Exhaust attempts: fail again and drive to dead_letter.
  if (retried!.status === 'submitted') {
    const newHash = retried!.txHash!;
    provider.set(newHash, { status: 'failed', reason: 'tx_failed' });
    await reconciler!.processDue();
  }
  await queue!.processDue();

  const dead = await getExecution(harness!.baseUrl, created.id);
  assert.ok(dead);
  assert.strictEqual(dead!.status, 'dead_letter');
});

test('not_found: record stays submitted and is never blind-retried', async () => {
  await bootstrap();
  const created = await submitExecution(harness!.baseUrl, {
    agentId: 'agent-303',
    type: 'transfer',
    params: { to: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '1' },
  });
  await queue!.processDue();
  const submitted = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(submitted!.status, 'submitted');
  const txHash = submitted!.txHash!;

  provider.set(txHash, { status: 'not_found' });
  await reconciler!.processDue();
  const after = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(after!.status, 'submitted');
  assert.strictEqual(after!.txHash, txHash);

  // Driving the queue again must not blind-retry a submitted record.
  await queue!.processDue();
  const afterQueue = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(afterQueue!.status, 'submitted');
  assert.strictEqual(afterQueue!.txHash, txHash);
});

test('network_error: record stays submitted', async () => {
  await bootstrap();
  const created = await submitExecution(harness!.baseUrl, {
    agentId: 'agent-404',
    type: 'transfer',
    params: { to: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '1' },
  });
  await queue!.processDue();
  const submitted = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(submitted!.status, 'submitted');
  const txHash = submitted!.txHash!;

  provider.set(txHash, { status: 'network_error', message: 'timeout' });
  await reconciler!.processDue();
  const after = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(after!.status, 'submitted');
  assert.strictEqual(after!.txHash, txHash);
});

test('concurrent update: conditional write prevents a stale overwrite', async () => {
  await bootstrap();
  const created = await submitExecution(harness!.baseUrl, {
    agentId: 'agent-505',
    type: 'transfer',
    params: { to: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', amount: '1' },
  });
  await queue!.processDue();
  const submitted = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(submitted!.status, 'submitted');
  const txHash = submitted!.txHash!;

  // Simulate a concurrent write between the reconciler's read and its write.
  // The record is moved to a newer state and the reconciler must not
  // overwrite it with a stale 'confirmed'.
  const store = harness!.server.executionStore;
  const before = await store.getExecution(created.id);
  assert.ok(before);
  await store.updateExecution(created.id, {
    status: 'confirmed',
    txHash,
    completedAt: new Date().toISOString(),
  });

  // Now a concurrent update attempts to move the record back to 'failed'.
  // The conditional update must reject the stale write.
  const ok = await store.updateExecutionIfMatches(created.id, {
    status: 'submitted',
  }, {
    status: 'failed',
    error: 'stale_write',
  });
  assert.strictEqual(ok, false, 'stale conditional write must be rejected');

  const after = await getExecution(harness!.baseUrl, created.id);
  assert.strictEqual(after!.status, 'confirmed');
  assert.strictEqual(after!.txHash, txHash);
});

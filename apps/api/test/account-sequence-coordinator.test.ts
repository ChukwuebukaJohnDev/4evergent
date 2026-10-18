import { test } from "node:test";
import assert from "node:assert/strict";
import { AccountSequenceCoordinator } from "../src/account-sequence-coordinator.js";

test("COORDINATOR: same account serialized, different accounts concurrent", async () => {
  const coordinator = new AccountSequenceCoordinator();
  const events: string[] = [];

  // Same account: should be serialized
  const taskA = async () => {
    events.push("A-start");
    await new Promise((r) => setTimeout(r, 20));
    events.push("A-end");
  };
  const taskB = async () => {
    events.push("B-start");
    await new Promise((r) => setTimeout(r, 5));
    events.push("B-end");
  };

  // Different accounts: should overlap
  const taskC = async () => {
    events.push("C-start");
    await new Promise((r) => setTimeout(r, 5));
    events.push("C-end");
  };

  const promiseA = coordinator.runExclusive("G_ACCOUNT_SAME", taskA);
  const promiseB = coordinator.runExclusive("G_ACCOUNT_SAME", taskB);
  const promiseC = coordinator.runExclusive("G_ACCOUNT_DIFFERENT", taskC);

  // C should be able to run concurrently with A
  await Promise.all([promiseA, promiseB, promiseC]);

  // A must complete before B starts (same account)
  const aEndIdx = events.indexOf("A-end");
  const bStartIdx = events.indexOf("B-start");
  assert.ok(aEndIdx < bStartIdx, `A must end before B starts, got: ${events.join(",")}`);

  // C should overlap with A (different account)
  const cStartIdx = events.indexOf("C-start");
  assert.ok(cStartIdx < aEndIdx, `C must start before A ends, got: ${events.join(",")}`);
});

test("COORDINATOR: max concurrent for same account is 1", async () => {
  const coordinator = new AccountSequenceCoordinator();
  let activeCount = 0;
  let maxConcurrent = 0;

  const makeTask = () => async () => {
    activeCount++;
    maxConcurrent = Math.max(maxConcurrent, activeCount);
    await new Promise((r) => setTimeout(r, 10));
    activeCount--;
  };

  // 5 concurrent tasks for the same account
  const tasks = Array.from({ length: 5 }, () =>
    coordinator.runExclusive("G_SAME", makeTask())
  );

  await Promise.all(tasks);
  assert.equal(maxConcurrent, 1, `Expected max concurrent = 1, got ${maxConcurrent}`);
});

test("COORDINATOR: failure releases lock", async () => {
  const coordinator = new AccountSequenceCoordinator();

  // First task throws
  await assert.rejects(
    () => coordinator.runExclusive("G_FAIL", async () => {
      throw new Error("simulated failure");
    }),
    /simulated failure/
  );

  // Second task for same account should still succeed
  const result = await coordinator.runExclusive("G_FAIL", async () => {
    return "success";
  });
  assert.equal(result, "success");
});

test("COORDINATOR: different accounts run concurrently", async () => {
  const coordinator = new AccountSequenceCoordinator();
  const startTimes: Record<string, number> = {};

  const makeTask = (account: string) => async () => {
    startTimes[account] = Date.now();
    await new Promise((r) => setTimeout(r, 20));
  };

  const _start = Date.now();
  await Promise.all([
    coordinator.runExclusive("G_ACC_1", makeTask("G_ACC_1")),
    coordinator.runExclusive("G_ACC_2", makeTask("G_ACC_2")),
    coordinator.runExclusive("G_ACC_3", makeTask("G_ACC_3")),
  ]);

  // All should have started within a small window (concurrent)
  const times = Object.values(startTimes);
  const maxDiff = Math.max(...times) - Math.min(...times);
  assert.ok(maxDiff < 10, `Expected concurrent start, got diff ${maxDiff}ms`);
});

test("COORDINATOR: FIFO order for same account", async () => {
  const coordinator = new AccountSequenceCoordinator();
  const order: number[] = [];

  const makeTask = (n: number) => async () => {
    order.push(n);
    await new Promise((r) => setTimeout(r, 1));
  };

  // Launch 5 tasks for same account
  await Promise.all([
    coordinator.runExclusive("G_FIFO", makeTask(1)),
    coordinator.runExclusive("G_FIFO", makeTask(2)),
    coordinator.runExclusive("G_FIFO", makeTask(3)),
    coordinator.runExclusive("G_FIFO", makeTask(4)),
    coordinator.runExclusive("G_FIFO", makeTask(5)),
  ]);

  // FIFO order should be preserved
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

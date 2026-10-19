import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import { InMemoryScheduleStore, InMemoryActivityStore, InMemoryExecutionStore } from "@4evergent/database";
import type { ScheduleRecord, ActivityStore, ExecutionStore, ExecutionRecord } from "@4evergent/database";
import type { Signer } from "@4evergent/stellar";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";

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

const TEST_AGENT = {
  id: "test-agent",
  displayName: "Test Agent",
  description: "test agent",
  ownerId: "test",
  stellarAddress: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  capabilities: ["payment"],
  status: "active" as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  active: true,
  metadata: {},
};

function makeSchedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: "test-agent",
    ownerId: "test",
    status: "active",
    intent: {
      type: "payment",
      asset: "XLM",
      destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: "10",
      reason: "scheduled payment test",
    },
    scheduleExpression: "0 * * * *",
    timezone: "UTC",
    nextRunAt: new Date(Date.now() - 60000).toISOString(),
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
  activityStore: ActivityStore;
  executionStore: ExecutionStore;
  scheduleStore: InMemoryScheduleStore;
}

/** Start a server with scheduler + execution queue enabled at a low interval. */
async function startServer(intervalMs = 100): Promise<TestServer> {
  const activityStore = new InMemoryActivityStore();
  const executionStore = new InMemoryExecutionStore();
  const scheduleStore = new InMemoryScheduleStore();

  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner("test-agent"),
    policyRules: { maxTxAmount: { XLM: "1000" } },
    deferExecution: true,
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
    activityStore,
    executionStore,
    scheduleStore,
    executionQueue: { enabled: true, intervalMs },
    scheduler: { enabled: true, intervalMs },
  });

  server.registerAgent(TEST_AGENT);

  return new Promise<TestServer>((resolve) => {
    const http = server.server.listen(0, "127.0.0.1", () => {
      const addr = http.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
        activityStore,
        executionStore,
        scheduleStore,
      });
    });
  });
}

/** Sleep for n ms on the event loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll an async predicate until it returns a truthy value or timeout.
 */
async function waitFor<T>(fn: () => Promise<T | undefined> | T | undefined, timeoutMs = 2000, intervalMs = 20): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await sleep(intervalMs);
  }
  return await fn();
}

/** Find the first execution record for an agent with a given status (or any). */
function findExecution(records: ExecutionRecord[], status?: string): ExecutionRecord | undefined {
  if (status) return records.find((r) => r.status === status);
  return records.find((r) => r.activityId != null);
}

test("SCHEDULE ACTIVITY TEST 1: scheduler enqueues execution with linked ActivityRecord", async () => {
  const { close, _activityStore, executionStore, scheduleStore } = await startServer(50);

  try {
    const schedule = makeSchedule();
    await scheduleStore.create(schedule);

    // Wait for the scheduler to fire and enqueue
    const execution = await waitFor(async () =>
      findExecution([...(await executionStore.listByAgent(schedule.agentId))])
    , 1000);

    assert.ok(execution, "ExecutionRecord with activityId should be enqueued by scheduler");
    assert.equal(execution!.agentId, "test-agent");
    assert.equal(execution!.ownerId, "test");
    assert.deepEqual(execution!.intent, schedule.intent);
    assert.ok(execution!.activityId, "ExecutionRecord.activityId must be non-null");
  } finally {
    await close();
  }
});

test("SCHEDULE ACTIVITY TEST 2: scheduler creates ActivityRecord before pipeline runs", async () => {
  const { close, activityStore, executionStore, scheduleStore } = await startServer(50);

  try {
    const schedule = makeSchedule();
    await scheduleStore.create(schedule);

    // Wait for an execution record to appear (any status)
    await waitFor(async () => {
      const recs = await executionStore.listByAgent(schedule.agentId);
      return recs.length > 0 ? recs[0] : undefined;
    }, 1000);

    // The ActivityRecord should exist immediately after scheduler fires
    const activities = await activityStore.listByAgent(schedule.agentId);
    assert.ok(activities.length > 0, "At least one ActivityRecord should exist");

    const activity = activities[0];
    assert.equal(activity.agentId, "test-agent");
    assert.equal(activity.ownerId, "test");
    assert.deepEqual(activity.intent, schedule.intent);
    assert.equal(activity.status, "pending", "ActivityRecord should be pending before execution completes");
    assert.equal(activity.authorizationStatus, "not_required", "Scheduled execution bypasses approval");
  } finally {
    await close();
  }
});

test("SCHEDULE ACTIVITY TEST 3: ExecutionRecord.activityId links to ActivityRecord", async () => {
  const { close, activityStore, executionStore, scheduleStore } = await startServer(50);

  try {
    const schedule = makeSchedule();
    await scheduleStore.create(schedule);

    // Wait for execution to be enqueued
    const execution = await waitFor(async () =>
      findExecution([...(await executionStore.listByAgent(schedule.agentId))])
    , 1000);

    assert.ok(execution, "ExecutionRecord should exist");
    assert.ok(execution!.activityId, "ExecutionRecord.activityId must be non-null");

    // Fetch the ActivityRecord by the linked ID
    const activity = await activityStore.get(execution!.activityId!);
    assert.ok(activity, "ActivityRecord referenced by execution must exist");
    assert.equal(activity!.id, execution!.activityId);
    assert.equal(activity!.agentId, schedule.agentId);
    assert.equal(activity!.ownerId, schedule.ownerId);
    assert.deepEqual(activity!.intent, schedule.intent);
  } finally {
    await close();
  }
});

test("SCHEDULE ACTIVITY TEST 4: no duplicate ActivityRecord after pipeline runs", async () => {
  const { close, activityStore, executionStore, scheduleStore } = await startServer(50);

  try {
    const schedule = makeSchedule();
    await scheduleStore.create(schedule);

    // Wait for execution to reach a terminal state
    await waitFor(async () => {
      const recs = await executionStore.listByAgent(schedule.agentId);
      return findExecution(recs, "submitted") ?? findExecution(recs, "dead_letter") ?? findExecution(recs, "failed");
    }, 2000);

    // There should be exactly ONE ActivityRecord for this schedule's execution
    const allActivities = await activityStore.listByAgent(schedule.agentId);
    assert.equal(allActivities.length, 1, "Exactly one ActivityRecord should exist for the scheduled execution");

    // The activity should have been updated from "pending" to a terminal state
    const activity = allActivities[0];
    assert.notEqual(activity.status, "pending", "ActivityRecord should be updated to terminal state after pipeline runs");
  } finally {
    await close();
  }
});

test("SCHEDULE ACTIVITY TEST 5: owner isolation — activity belongs to schedule owner", async () => {
  const { close, activityStore, executionStore, scheduleStore } = await startServer(50);

  try {
    const schedule = makeSchedule();
    await scheduleStore.create(schedule);

    // Wait for execution
    await waitFor(async () => {
      const recs = await executionStore.listByAgent(schedule.agentId);
      return findExecution(recs);
    }, 1000);

    // The ActivityRecord must belong to the same owner as the schedule
    const activities = await activityStore.listByAgent(schedule.agentId);
    assert.ok(activities.length > 0, "ActivityRecord should exist");
    for (const activity of activities) {
      assert.equal(activity.ownerId, schedule.ownerId, "ActivityRecord ownerId must match schedule ownerId");
    }

    // getForOwner should work for the legitimate owner
    const activity = await activityStore.getForOwner(activities[0]!.id, schedule.ownerId);
    assert.ok(activity, "Owner should be able to read their activity");

    // getForOwner should return null for a different owner
    const otherOwnerAccess = await activityStore.getForOwner(activities[0]!.id, "other-owner");
    assert.equal(otherOwnerAccess, null, "Cross-owner should not be able to read the activity");
  } finally {
    await close();
  }
});

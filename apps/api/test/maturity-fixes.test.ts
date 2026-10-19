/**
 * Regression tests for scheduler persistence fallback and InMemory
 * daily spending atomicity (P2 #1 and P2 #2 fixes).
 *
 * These tests prove the bugs that were fixed:
 * - P2 #1: scheduler skips schedules for persistent agents when the in-memory
 *   agent map is empty (restart condition). The fix adds a fallback to
 *   agentStore.get() mirroring ResourceAuthorizationService.resolveAgent.
 * - P2 #2: concurrent daily spending reservations on InMemoryActivityStore
 *   could both pass a read-then-write race and exceed the daily limit.
 *   The fix serializes check+commit via a per-instance promise chain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryScheduleStore, InMemoryActivityStore } from "@4evergent/database";
import { AgentScheduler } from "../src/scheduler.js";
import type { ScheduleRecord, ActivityRecord } from "@4evergent/database";
import type { AgentIntent } from "@4evergent/shared";

type AgentInfo = { id: string; status: string; ownerId: string };

function makeIntent(): AgentIntent {
  return {
    type: "payment",
    asset: "XLM",
    destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: "10",
    reason: "scheduled test",
  };
}

function makeSchedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: "agent-persist",
    ownerId: "owner-a",
    status: "active",
    intent: makeIntent(),
    scheduleExpression: "0 * * * *",
    timezone: "UTC",
    nextRunAt: new Date(Date.now() - 60000).toISOString(),
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Mirrors the fixed index.ts agentStatusStore logic: in-memory Map first,
 * then persistent agentStore fallback. Tests exercise ONLY the fallback path
 * by passing an empty in-memory map, which is exactly the post-restart state.
 */
function makeStatusStore(
  memory: Map<string, AgentInfo>,
  persistent: { get(id: string): Promise<AgentInfo | null> }
) {
  return {
    get: async (id: string): Promise<AgentInfo | null> => {
      const agent = memory.get(id);
      if (agent) return agent;
      const dbAgent = await persistent.get(id);
      if (dbAgent) return dbAgent;
      return null;
    },
  };
}

function persistentStore(records: Record<string, AgentInfo>) {
  return {
    get: async (id: string): Promise<AgentInfo | null> => records[id] ?? null,
  };
}

async function runScheduler(statusStore: { get(id: string): Promise<AgentInfo | null> }) {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule();
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, statusStore, async () => {
    executed++;
    return { status: "submitted" };
  });

  const count = await scheduler.runDue(new Date().toISOString());
  return { count, executed };
}

// --- FIX #1: Scheduler persistent agent fallback ---

test("Scheduler: persistent active agent (empty in-memory map) → eligible", async () => {
  const statusStore = makeStatusStore(
    new Map(),
    persistentStore({ "agent-persist": { id: "agent-persist", status: "active", ownerId: "owner-a" } })
  );

  const { count, executed } = await runScheduler(statusStore);

  assert.equal(count, 1);
  assert.equal(executed, 1);
});

test("Scheduler: persistent paused agent (empty in-memory map) → skipped", async () => {
  const statusStore = makeStatusStore(
    new Map(),
    persistentStore({ "agent-persist": { id: "agent-persist", status: "paused", ownerId: "owner-a" } })
  );

  const { count, executed } = await runScheduler(statusStore);

  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: persistent disabled agent (empty in-memory map) → skipped", async () => {
  const statusStore = makeStatusStore(
    new Map(),
    persistentStore({ "agent-persist": { id: "agent-persist", status: "disabled", ownerId: "owner-a" } })
  );

  const { count, executed } = await runScheduler(statusStore);

  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: agent absent from both sources → skipped without crash", async () => {
  const statusStore = makeStatusStore(new Map(), persistentStore({}));

  const { count, executed } = await runScheduler(statusStore);

  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: in-memory entry wins over stale persistent entry", async () => {
  const statusStore = makeStatusStore(
    new Map([["agent-persist", { id: "agent-persist", status: "paused", ownerId: "owner-a" }]]),
    persistentStore({ "agent-persist": { id: "agent-persist", status: "active", ownerId: "owner-a" } })
  );

  const { count, executed } = await runScheduler(statusStore);

  assert.equal(count, 0);
  assert.equal(executed, 0);
});

// --- FIX #2: InMemory daily spending atomicity ---

test("InMemoryActivityStore: single reservation under limit → PASS", async () => {
  const store = new InMemoryActivityStore();
  assert.equal(await store.reserveDailySpending("a1", "XLM", "10", "100"), true);
});

test("InMemoryActivityStore: reservation exactly at limit → PASS", async () => {
  const store = new InMemoryActivityStore();
  assert.equal(await store.reserveDailySpending("a1", "XLM", "100", "100"), true);
});

test("InMemoryActivityStore: reservation exceeding limit → REJECT", async () => {
  const store = new InMemoryActivityStore();
  assert.equal(await store.reserveDailySpending("a1", "XLM", "101", "100"), false);
});

test("InMemoryActivityStore: concurrent reservations exceeding limit → cap held", async () => {
  // Limit 50, 10 concurrent requests of 10 each (combined 100). Exactly 5 must
  // succeed; the old read-then-write implementation let all 10 through.
  const store = new InMemoryActivityStore();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.reserveDailySpending("a1", "XLM", "10", "50"))
  );

  assert.equal(results.filter((r) => r === true).length, 5);
  assert.equal(results.filter((r) => r === false).length, 5);
});

test("InMemoryActivityStore: concurrent reservations equal to limit → all succeed", async () => {
  const store = new InMemoryActivityStore();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.reserveDailySpending("a1", "XLM", "10", "100"))
  );

  assert.equal(results.filter((r) => r === false).length, 0);
});

test("InMemoryActivityStore: concurrent mixed amounts never exceed limit", async () => {
  // Limit 100: 30 concurrent requests of 10 each. At most 10 may succeed.
  const store = new InMemoryActivityStore();
  const results = await Promise.all(
    Array.from({ length: 30 }, () => store.reserveDailySpending("a1", "XLM", "10", "100"))
  );

  const successes = results.filter((r) => r === true).length;
  assert.equal(successes, 10);
  assert.ok(successes * 10 <= 100);
});

test("InMemoryActivityStore: different agent/asset keys remain independent", async () => {
  const store = new InMemoryActivityStore();
  assert.equal(await store.reserveDailySpending("a1", "XLM", "50", "50"), true);
  assert.equal(await store.reserveDailySpending("a1", "USDC", "50", "50"), true);
  assert.equal(await store.reserveDailySpending("a2", "XLM", "50", "50"), true);
});

test("InMemoryActivityStore: invalid amount/limit still rejected", async () => {
  const store = new InMemoryActivityStore();
  assert.equal(await store.reserveDailySpending("a1", "XLM", "abc", "100"), false);
  assert.equal(await store.reserveDailySpending("a1", "XLM", "10", "abc"), false);
});

test("InMemoryActivityStore: record/get unaffected by reservation change", async () => {
  const store = new InMemoryActivityStore();
  const now = "2026-01-01T00:00:00Z";
  const rec: ActivityRecord = {
    id: "act-1",
    agentId: "a1",
    ownerId: "o1",
    intent: makeIntent(),
    policyDecision: { result: "allow", reason: "test", rule: "test", intent: makeIntent() },
    authorizationStatus: null,
    simulationResult: null,
    txHash: null,
    status: "pending",
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  await store.record(rec);
  const got = await store.get("act-1");

  assert.ok(got);
  assert.equal(got!.status, "pending");
  assert.equal(got!.agentId, "a1");
});

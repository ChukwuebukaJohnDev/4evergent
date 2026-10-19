import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryScheduleStore } from "@4evergent/database";
import { AgentScheduler } from "../src/scheduler.js";
import type { ScheduleRecord } from "@4evergent/database";
import type { AgentIntent } from "@4evergent/shared";

function makeIntent(): AgentIntent {
  return {
    type: "payment",
    asset: "XLM",
    destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: "10",
    reason: "test schedule",
  };
}

function makeSchedule(overrides: any = {}): ScheduleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: "agent-a",
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

const agents = new Map<string, { id: string; status: string; ownerId: string }>([
  ["agent-a", { id: "agent-a", status: "active", ownerId: "owner-a" }],
  ["agent-b", { id: "agent-b", status: "active", ownerId: "owner-b" }],
  ["agent-paused", { id: "agent-paused", status: "paused", ownerId: "owner-a" }],
  ["agent-disabled", { id: "agent-disabled", status: "disabled", ownerId: "owner-a" }],
]);

const agentStore = {
  get: async (id: string) => agents.get(id) ?? null,
};

test("Scheduler: due active schedule executes", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule();
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 1);
  assert.equal(executed, 1);
});

test("Scheduler: future schedule does not execute", async () => {
  const store = new InMemoryScheduleStore();
  const future = new Date(Date.now() + 3600000).toISOString();
  const schedule = makeSchedule({ nextRunAt: future });
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: paused schedule does not execute", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule({ status: "paused" });
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: disabled schedule does not execute", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule({ status: "disabled" });
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: paused agent does not execute", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule({ agentId: "agent-paused" });
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: disabled agent does not execute", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule({ agentId: "agent-disabled" });
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: duplicate trigger protection", async () => {
  const store = new InMemoryScheduleStore();
  const now = new Date().toISOString();
  const schedule = makeSchedule({ lastRunAt: now });
  await store.create(schedule);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async () => {
    executed++;
  });

  const count = await scheduler.runDue(now);
  assert.equal(count, 0);
  assert.equal(executed, 0);
});

test("Scheduler: failed job does not stop other schedules", async () => {
  const store = new InMemoryScheduleStore();
  const s1 = makeSchedule({ id: "s1" });
  const s2 = makeSchedule({ id: "s2" });
  await store.create(s1);
  await store.create(s2);

  let executed = 0;
  const scheduler = new AgentScheduler(store, agentStore, async (schedule) => {
    executed++;
    if (schedule.id === "s1") throw new Error("intentional failure");
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 1);
  assert.equal(executed, 2);
});

test("Scheduler: start/stop lifecycle", async () => {
  const store = new InMemoryScheduleStore();
  const scheduler = new AgentScheduler(store, agentStore, async () => {});

  assert.equal(scheduler.isRunning(), false);
  scheduler.start();
  assert.equal(scheduler.isRunning(), true);
  scheduler.stop();
  assert.equal(scheduler.isRunning(), false);
});

test("Scheduler: updates lastRunAt after execution", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule();
  await store.create(schedule);

  const scheduler = new AgentScheduler(store, agentStore, async () => {});
  await scheduler.runDue(new Date().toISOString());

  const updated = await store.get(schedule.id);
  assert.ok(updated!.lastRunAt);
  assert.notEqual(updated!.lastRunAt, schedule.lastRunAt);
});

test("Scheduler: updates nextRunAt after execution", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule({ scheduleExpression: "0 * * * *" });
  await store.create(schedule);

  const scheduler = new AgentScheduler(store, agentStore, async () => {});
  const before = await store.get(schedule.id);
  await scheduler.runDue(new Date().toISOString());
  const after = await store.get(schedule.id);

  assert.notEqual(after!.nextRunAt, before!.nextRunAt);
  assert.ok(new Date(after!.nextRunAt) > new Date(before!.nextRunAt));
});

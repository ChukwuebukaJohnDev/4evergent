import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryScheduleStore, InMemoryActivityStore, InMemoryApprovalStore } from "@4evergent/database";
import { ScheduleExecutionService } from "../src/schedule-execution.js";
import { AgentScheduler } from "../src/scheduler.js";
import type { ScheduleRecord } from "@4evergent/database";
import type { AgentIntent } from "@4evergent/shared";

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
]);

const agentStore = {
  get: async (id: string) => agents.get(id) ?? null,
};

test("ScheduleExecutionService: executes due schedule through pipeline", async () => {
  const activityStore = new InMemoryActivityStore();
  const approvalStore = new InMemoryApprovalStore();
  const schedule = makeSchedule();

  let executedWith: any = null;
  const pipelineExecutor = async (input: any) => {
    executedWith = input;
    return {
      status: "submitted",
      activityId: "act-1",
    };
  };

  const service = new ScheduleExecutionService({
    activityStore,
    approvalStore,
    getSourceAccount: async () => ({
      accountId: () => "GACCOUNT",
      sequenceNumber: () => "1",
      incrementSequenceNumber: () => {},
    }),
    pipelineExecutor,
  });

  const outcome = await service.executeSchedule(schedule);

  assert.equal(outcome.status, "submitted");
  assert.ok(executedWith);
  assert.equal(executedWith.intent.type, "payment");
  assert.equal(executedWith.sourceAccount.agentId, "agent-a");
  assert.equal(executedWith.sourceAccount.ownerId, "owner-a");
});

test("ScheduleExecutionService: rejects when source account cannot be loaded", async () => {
  const activityStore = new InMemoryActivityStore();
  const approvalStore = new InMemoryApprovalStore();
  const schedule = makeSchedule();

  const pipelineExecutor = async () => ({ status: "submitted" });

  const service = new ScheduleExecutionService({
    activityStore,
    approvalStore,
    getSourceAccount: async () => {
      throw new Error("Horizon unavailable");
    },
    pipelineExecutor,
  });

  const outcome = await service.executeSchedule(schedule);

  assert.equal(outcome.status, "rejected");
  assert.match(outcome.message!, /Horizon unavailable/);
});

test("AgentScheduler: executes due active schedule via callback", async () => {
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

  const updated = await store.get(schedule.id);
  assert.ok(updated!.lastRunAt);
});

test("AgentScheduler: skips schedule for paused agent", async () => {
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

test("AgentScheduler: updates lastRunAt even on failure", async () => {
  const store = new InMemoryScheduleStore();
  const schedule = makeSchedule();
  await store.create(schedule);

  const scheduler = new AgentScheduler(store, agentStore, async () => {
    throw new Error("execution failed");
  });

  const count = await scheduler.runDue(new Date().toISOString());
  assert.equal(count, 0);

  const updated = await store.get(schedule.id);
  assert.ok(updated!.lastRunAt);
});

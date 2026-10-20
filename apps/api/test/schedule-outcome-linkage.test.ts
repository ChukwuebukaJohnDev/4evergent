import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarAdapter } from "@4evergent/agent-core";
import { StellarSimulator } from "@4evergent/stellar";
import type { ScheduleRecord } from "@4evergent/database";
import { clearAgents } from "../src/index.js";
import { startServer, DEFAULT_TEST_AGENT, MockSigner } from "./helpers.js";

const SOURCE_PUBLIC_KEY = Keypair.random().publicKey();
const DEST_PUBLIC_KEY = Keypair.random().publicKey();

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
      destination: DEST_PUBLIC_KEY,
      amount: "10",
      reason: "schedule outcome linkage test",
    },
    scheduleExpression: "0 * * * *",
    timezone: "UTC",
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Stubs StellarAdapter.getAccount and StellarSimulator.simulate so scheduled
 * executions traverse the full scheduler -> executionQueue -> TransactionPipeline
 * path completely offline without touching Horizon.
 */
async function withOfflinePipeline<T>(
  opts: {
    simulateResult?: {
      success: boolean;
      fee: string;
      operations: number;
      warnings: string[];
      error?: string;
    };
  },
  fn: () => Promise<T>
): Promise<T> {
  const originalGetAccount = StellarAdapter.prototype.getAccount;
  const originalSimulate = StellarSimulator.prototype.simulate;

  StellarAdapter.prototype.getAccount = async (address: string) => ({
    address,
    sequence: "100",
    balances: [{ asset: "XLM", balance: "1000.0000000" }],
    subentryCount: 0,
  });

  if (opts.simulateResult) {
    const simResult = opts.simulateResult;
    StellarSimulator.prototype.simulate = async () => simResult;
  }

  try {
    return await fn();
  } finally {
    StellarAdapter.prototype.getAccount = originalGetAccount;
    StellarSimulator.prototype.simulate = originalSimulate;
  }
}

beforeEach(() => {
  clearAgents();
});

test("SCHEDULE OUTCOME LINKAGE 1: policy-denied schedule updates pre-created activity to rejected with denied_by_policy", async () => {
  await withOfflinePipeline({}, async () => {
    const { close, activityStore, executionStore, scheduleStore, server } = await startServer({
      schedulerEnabled: true,
      intervalMs: 60_000,
      signer: new MockSigner(SOURCE_PUBLIC_KEY),
      policyRules: {
        maxTxAmount: { XLM: "5" },
      },
      deferExecution: true,
    });

    try {
      server.scheduler?.stop();
      server.executionQueue?.stop();

      const schedule = makeSchedule({
        intent: {
          type: "payment",
          asset: "XLM",
          destination: DEST_PUBLIC_KEY,
          amount: "10",
          reason: "exceeds maxTxAmount",
        },
      });
      await scheduleStore.create(schedule);

      const nowIso = new Date().toISOString();
      const dueCount = await server.scheduler!.runDue(nowIso);
      assert.equal(dueCount, 1, "scheduler should fire the due schedule once");

      // Pre-created activity exists in pending state before queue processing
      const preActivities = await activityStore.listByAgent(schedule.agentId);
      assert.equal(preActivities.length, 1, "scheduler must pre-create exactly one activity record");
      const preActivityId = preActivities[0]!.id;
      assert.equal(preActivities[0]!.status, "pending");

      // Process the queued execution through the pipeline
      const started = await server.executionQueue!.processDue(nowIso);
      assert.equal(started, 1, "execution queue should process the enqueued execution");

      // Assert no duplicate activity was created and the pre-created activity was updated
      const activities = await activityStore.listByAgent(schedule.agentId);
      const allActivities = await activityStore.listAll();
      assert.equal(activities.length, 1, "must not create a duplicate activity for policy-denied schedule");
      assert.equal(allActivities.length, 1, "total activity count in store must remain 1");

      const activity = activities[0]!;
      assert.equal(activity.id, preActivityId, "pipeline must update the pre-created activity record in place");
      assert.equal(activity.status, "rejected");
      assert.equal(activity.authorizationStatus, "denied_by_policy");

      const executions = await executionStore.listByAgent(schedule.agentId);
      assert.equal(executions.length, 1);
      assert.equal(executions[0]!.activityId, preActivityId);
    } finally {
      await close();
    }
  });
});

test("SCHEDULE OUTCOME LINKAGE 2: schedule requiring approval links approval record to pre-created activity without duplicate", async () => {
  await withOfflinePipeline({}, async () => {
    const { close, activityStore, approvalStore, executionStore, scheduleStore, server } = await startServer({
      schedulerEnabled: true,
      intervalMs: 60_000,
      signer: new MockSigner(SOURCE_PUBLIC_KEY),
      policyRules: {
        maxTxAmount: { XLM: "1000" },
        requireHumanApprovalForAmountAbove: "10",
      },
      deferExecution: true,
    });

    try {
      server.scheduler?.stop();
      server.executionQueue?.stop();

      const schedule = makeSchedule({
        intent: {
          type: "payment",
          asset: "XLM",
          destination: DEST_PUBLIC_KEY,
          amount: "50",
          reason: "requires human approval",
        },
      });
      await scheduleStore.create(schedule);

      const nowIso = new Date().toISOString();
      const dueCount = await server.scheduler!.runDue(nowIso);
      assert.equal(dueCount, 1);

      const preActivities = await activityStore.listByAgent(schedule.agentId);
      assert.equal(preActivities.length, 1, "scheduler must pre-create exactly one activity record");
      const preActivityId = preActivities[0]!.id;

      const started = await server.executionQueue!.processDue(nowIso);
      assert.equal(started, 1);

      // Verify activity count is still 1 (no second activity created)
      const activities = await activityStore.listByAgent(schedule.agentId);
      const allActivities = await activityStore.listAll();
      assert.equal(activities.length, 1, "must not create a second activity when approval is required");
      assert.equal(allActivities.length, 1, "total activity count in store must remain 1");

      const activity = activities[0]!;
      assert.equal(activity.id, preActivityId);
      assert.equal(activity.status, "requires_approval");
      assert.equal(activity.authorizationStatus, "pending_approval");

      // Verify approval record links to the exact same pre-created activity ID
      const allApprovals = await approvalStore.listAll();
      assert.equal(allApprovals.length, 1, "exactly one approval record should be created");
      const approval = allApprovals[0]!;
      assert.equal(approval.activityId, preActivityId, "approval.activityId must match pre-created activity.id");
      assert.equal(approval.status, "pending_approval");

      const executions = await executionStore.listByAgent(schedule.agentId);
      assert.equal(executions.length, 1);
      assert.equal(executions[0]!.activityId, preActivityId);
    } finally {
      await close();
    }
  });
});

test("SCHEDULE OUTCOME LINKAGE 3: schedule failing simulation leaves pre-created activity in failed with denied_by_simulation", async () => {
  await withOfflinePipeline(
    {
      simulateResult: {
        success: false,
        fee: "100000",
        operations: 1,
        warnings: [],
        error: "Insufficient balance: payment 10 XLM + fee exceeds available 0.5000000 XLM",
      },
    },
    async () => {
      const { close, activityStore, executionStore, scheduleStore, server } = await startServer({
        schedulerEnabled: true,
        intervalMs: 60_000,
        signer: new MockSigner(SOURCE_PUBLIC_KEY),
        policyRules: {
          maxTxAmount: { XLM: "1000" },
          requireHumanApprovalForAmountAbove: "100",
        },
        deferExecution: true,
      });

      try {
        server.scheduler?.stop();
        server.executionQueue?.stop();

        const schedule = makeSchedule({
          intent: {
            type: "payment",
            asset: "XLM",
            destination: DEST_PUBLIC_KEY,
            amount: "10",
            reason: "fails at simulation",
          },
        });
        await scheduleStore.create(schedule);

        const nowIso = new Date().toISOString();
        const dueCount = await server.scheduler!.runDue(nowIso);
        assert.equal(dueCount, 1);

        const preActivities = await activityStore.listByAgent(schedule.agentId);
        assert.equal(preActivities.length, 1, "scheduler must pre-create exactly one activity record");
        const preActivityId = preActivities[0]!.id;

        const started = await server.executionQueue!.processDue(nowIso);
        assert.equal(started, 1);

        const activities = await activityStore.listByAgent(schedule.agentId);
        const allActivities = await activityStore.listAll();
        assert.equal(activities.length, 1, "must not create a duplicate activity when simulation fails");
        assert.equal(allActivities.length, 1, "total activity count in store must remain 1");

        const activity = activities[0]!;
        assert.equal(activity.id, preActivityId);
        assert.equal(activity.status, "failed");
        assert.equal(activity.authorizationStatus, "denied_by_simulation");
        assert.match(activity.error ?? "", /Insufficient balance/);

        const executions = await executionStore.listByAgent(schedule.agentId);
        assert.equal(executions.length, 1);
        assert.equal(executions[0]!.activityId, preActivityId);
      } finally {
        await close();
      }
    }
  );
});

test("SCHEDULE OUTCOME LINKAGE 4: schedule firing twice within the same minute is suppressed by lastRunAt guard and activity count does not increase", async () => {
  await withOfflinePipeline({}, async () => {
    const { close, activityStore, executionStore, scheduleStore, server } = await startServer({
      schedulerEnabled: true,
      intervalMs: 60_000,
      signer: new MockSigner(SOURCE_PUBLIC_KEY),
      policyRules: {
        maxTxAmount: { XLM: "5" },
      },
      deferExecution: true,
    });

    try {
      server.scheduler?.stop();
      server.executionQueue?.stop();

      // Use a schedule expression and firing timestamp within the same minute window
      // so the schedule remains in listDue(fireIso) after the first run and exercises
      // the scheduler.ts lastRunAt === now duplicate trigger guard directly.
      const fireTime = new Date(Date.now() + 90_000);
      const fireIso = fireTime.toISOString();
      const dueRunAt = new Date(fireTime.getTime() - 30_000).toISOString();

      const schedule = makeSchedule({
        scheduleExpression: "* * * * *",
        nextRunAt: dueRunAt,
        intent: {
          type: "payment",
          asset: "XLM",
          destination: DEST_PUBLIC_KEY,
          amount: "10",
          reason: "duplicate trigger guard test",
        },
      });
      await scheduleStore.create(schedule);

      // First trigger at fireIso -> executes and sets lastRunAt = fireIso
      const firstRun = await server.scheduler!.runDue(fireIso);
      assert.equal(firstRun, 1, "first runDue at fireIso should execute the schedule");

      const afterFirstSchedule = await scheduleStore.get(schedule.id);
      assert.equal(afterFirstSchedule?.lastRunAt, fireIso, "lastRunAt must be recorded as fireIso");

      const activitiesAfterFirst = await activityStore.listByAgent(schedule.agentId);
      assert.equal(activitiesAfterFirst.length, 1, "exactly one activity record after first fire");

      // Second trigger at the same timestamp (and even if nextRunAt is still <= fireIso)
      // must be suppressed by the lastRunAt guard in scheduler.ts.
      await scheduleStore.update(schedule.id, { nextRunAt: dueRunAt });
      const secondRun = await server.scheduler!.runDue(fireIso);
      assert.equal(secondRun, 0, "second runDue at same timestamp must be suppressed by lastRunAt guard");

      // Activity and execution counts must not increase
      const activitiesAfterSecond = await activityStore.listByAgent(schedule.agentId);
      const allActivities = await activityStore.listAll();
      assert.equal(activitiesAfterSecond.length, 1, "activity count must not increase on suppressed second fire");
      assert.equal(allActivities.length, 1, "total activity count in store must remain 1");

      const executions = await executionStore.listByAgent(schedule.agentId);
      assert.equal(executions.length, 1, "execution count must not increase on suppressed second fire");

      // Process the single queued execution and verify linkage remains consistent
      await server.executionQueue!.processDue(fireIso);
      const finalActivities = await activityStore.listByAgent(schedule.agentId);
      assert.equal(finalActivities.length, 1, "activity count remains 1 after pipeline execution");
      assert.equal(finalActivities[0]!.id, executions[0]!.activityId);
      assert.equal(finalActivities[0]!.status, "rejected");
      assert.equal(finalActivities[0]!.authorizationStatus, "denied_by_policy");
    } finally {
      await close();
    }
  });
});

test("SCHEDULE OUTCOME LINKAGE 5: schedule whose agent is paused at fire time is skipped and nextRunAt is left unchanged", async () => {
  const { close, activityStore, executionStore, scheduleStore, server } = await startServer({
    schedulerEnabled: true,
    intervalMs: 60_000,
    signer: new MockSigner(SOURCE_PUBLIC_KEY),
    agent: { ...DEFAULT_TEST_AGENT, status: "active" },
    deferExecution: true,
  });

  try {
    server.scheduler?.stop();
    server.executionQueue?.stop();

    const originalNextRunAt = new Date(Date.now() - 60_000).toISOString();
    const schedule = makeSchedule({ nextRunAt: originalNextRunAt });
    await scheduleStore.create(schedule);

    // Agent is paused between schedule creation and fire time
    server.registerAgent({ ...DEFAULT_TEST_AGENT, status: "paused" });
    await server.agentStore.update(schedule.agentId, { status: "paused" });

    const nowIso = new Date().toISOString();
    const executed = await server.scheduler!.runDue(nowIso);
    assert.equal(executed, 0, "scheduler must skip due schedule when agent is paused");

    // Current behavior: scheduler.ts:51-52 continues before updating the schedule,
    // so nextRunAt is left unchanged and lastRunAt remains null.
    const afterSchedule = await scheduleStore.get(schedule.id);
    assert.ok(afterSchedule);
    assert.equal(
      afterSchedule!.nextRunAt,
      originalNextRunAt,
      "nextRunAt is left unchanged when schedule is skipped due to paused agent"
    );
    assert.equal(afterSchedule!.lastRunAt, null, "lastRunAt remains null when skipped");

    // Assert activity and execution record counts are 0
    const activities = await activityStore.listByAgent(schedule.agentId);
    const allActivities = await activityStore.listAll();
    const executions = await executionStore.listByAgent(schedule.agentId);
    assert.equal(activities.length, 0, "no activity record should be created for paused agent");
    assert.equal(allActivities.length, 0, "total activity count in store must be 0");
    assert.equal(executions.length, 0, "no execution record should be created for paused agent");
  } finally {
    await close();
  }
});

test("SCHEDULE OUTCOME LINKAGE 6: schedule whose agent is disabled at fire time is skipped", async () => {
  const { close, activityStore, executionStore, scheduleStore, server } = await startServer({
    schedulerEnabled: true,
    intervalMs: 60_000,
    signer: new MockSigner(SOURCE_PUBLIC_KEY),
    agent: { ...DEFAULT_TEST_AGENT, status: "active" },
    deferExecution: true,
  });

  try {
    server.scheduler?.stop();
    server.executionQueue?.stop();

    const originalNextRunAt = new Date(Date.now() - 60_000).toISOString();
    const schedule = makeSchedule({ nextRunAt: originalNextRunAt });
    await scheduleStore.create(schedule);

    // Agent is disabled between schedule creation and fire time
    server.registerAgent({ ...DEFAULT_TEST_AGENT, status: "disabled" });
    await server.agentStore.update(schedule.agentId, { status: "disabled" });

    const nowIso = new Date().toISOString();
    const executed = await server.scheduler!.runDue(nowIso);
    assert.equal(executed, 0, "scheduler must skip due schedule when agent is disabled");

    const afterSchedule = await scheduleStore.get(schedule.id);
    assert.ok(afterSchedule);
    assert.equal(
      afterSchedule!.nextRunAt,
      originalNextRunAt,
      "nextRunAt is left unchanged when schedule is skipped due to disabled agent"
    );
    assert.equal(afterSchedule!.lastRunAt, null, "lastRunAt remains null when skipped");

    // Assert activity and execution record counts are 0
    const activities = await activityStore.listByAgent(schedule.agentId);
    const allActivities = await activityStore.listAll();
    const executions = await executionStore.listByAgent(schedule.agentId);
    assert.equal(activities.length, 0, "no activity record should be created for disabled agent");
    assert.equal(allActivities.length, 0, "total activity count in store must be 0");
    assert.equal(executions.length, 0, "no execution record should be created for disabled agent");
  } finally {
    await close();
  }
});

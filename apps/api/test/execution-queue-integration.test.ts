import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryExecutionStore } from "@4evergent/database";
import { ExecutionQueue } from "../src/execution-queue.js";
import type { ExecutionRecord, ExecutionResult } from "@4evergent/database";
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

test("ExecutionQueue: approval boundary — execution record requires approvalId", async () => {
  const store = new InMemoryExecutionStore();
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    // Verify that the execution record has an approvalId (approval boundary)
    assert.ok(record.approvalId, "execution record must have approvalId");
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-123",
      error: null,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));

  const execution = makeExecution({ approvalId: "approval-123" });
  await queue.enqueue(execution);
  await queue.processDue();

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
});

test("ExecutionQueue: owner isolation — executions are owner-scoped", async () => {
  const store = new InMemoryExecutionStore();
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-123",
      error: null,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));

  const executionA = makeExecution({ ownerId: "owner-a", agentId: "agent-a" });
  const executionB = makeExecution({ ownerId: "owner-b", agentId: "agent-b" });
  await queue.enqueue(executionA);
  await queue.enqueue(executionB);
  await queue.processDue();

  const all = await store.listByOwner("owner-a", 10);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.ownerId, "owner-a");
});

test("ExecutionQueue: scheduler integration — scheduled execution enqueued and processed", async () => {
  const store = new InMemoryExecutionStore();
  let executed = 0;
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    executed++;
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-scheduled",
      error: null,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));

  // Simulate scheduler enqueueing a scheduled execution
  const execution = makeExecution({
    ownerId: "owner-a",
    agentId: "agent-a",
    approvalId: null,
    activityId: "activity-123",
  });
  await queue.enqueue(execution);
  await queue.processDue();

  assert.equal(executed, 1);
  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
  assert.equal(updated?.txHash, "tx-scheduled");
});

test("ExecutionQueue: manual execution regression — direct pipeline execution still works", async () => {
  const store = new InMemoryExecutionStore();
  const pipelineExecutor = async (record: ExecutionRecord): Promise<ExecutionResult> => {
    return {
      record,
      success: true,
      status: "submitted",
      txHash: "tx-manual",
      error: null,
    };
  };
  const queue = new ExecutionQueue(store, pipelineExecutor, async () => ({
    accountId: () => "GACCOUNT",
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));

  const execution = makeExecution();
  await queue.enqueue(execution);
  await queue.processDue();

  const updated = await store.get(execution.id);
  assert.equal(updated?.status, "submitted");
  assert.equal(updated?.txHash, "tx-manual");
});

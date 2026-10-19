import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import {
  SQLiteActivityStore,
  SQLiteApprovalStore,
  InMemoryActivityStore,
  InMemoryApprovalStore,
  createActivity,
  createApproval,
} from "../src/index.js";
import type { AgentIntent, PolicyDecision } from "@4evergent/shared";

function makeIntent(amount: string): AgentIntent {
  return {
    type: "payment",
    asset: "XLM",
    destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount,
    reason: "test",
  };
}

function makeDecision(result: "allow" | "deny" | "requires_approval" = "allow"): PolicyDecision {
  return { result, reason: "test", rule: "test", intent: makeIntent("1") };
}

function makeStores() {
  const dir = mkdtempSync(join(tmpdir(), "4evergent-owner-"));
  const path = join(dir, "test.db");
  return {
    activity: new SQLiteActivityStore(path),
    approval: new SQLiteApprovalStore(path),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const memoryStores = () => ({
  activity: new InMemoryActivityStore(),
  approval: new InMemoryApprovalStore(),
});

// ===== Activity ownership =====

test("InMemory: listByOwner returns only own records", async () => {
  const { activity } = memoryStores();
  const a1 = createActivity("agent-a", "owner-a", makeIntent("1"), makeDecision());
  const a2 = createActivity("agent-b", "owner-b", makeIntent("2"), makeDecision());
  const a3 = createActivity("agent-c", "owner-a", makeIntent("3"), makeDecision());
  await activity.record(a1);
  await activity.record(a2);
  await activity.record(a3);

  const ownerARecords = await activity.listByOwner("owner-a");
  assert.equal(ownerARecords.length, 2);
  assert.ok(ownerARecords.every((r) => r.ownerId === "owner-a"));

  const ownerBRecords = await activity.listByOwner("owner-b");
  assert.equal(ownerBRecords.length, 1);
  assert.equal(ownerBRecords[0]!.id, a2.id);
});

test("SQLite: listByOwner returns only own records", async () => {
  const { activity, cleanup } = makeStores();
  try {
    const a1 = createActivity("agent-a", "owner-a", makeIntent("1"), makeDecision());
    const a2 = createActivity("agent-b", "owner-b", makeIntent("2"), makeDecision());
    await activity.record(a1);
    await activity.record(a2);

    const ownerARecords = await activity.listByOwner("owner-a");
    assert.equal(ownerARecords.length, 1);
    assert.equal(ownerARecords[0]!.id, a1.id);
  } finally {
    cleanup();
  }
});

test("InMemory: getForOwner returns null for non-owner", async () => {
  const { activity } = memoryStores();
  const a1 = createActivity("agent-a", "owner-a", makeIntent("1"), makeDecision());
  await activity.record(a1);

  const result = await activity.getForOwner(a1.id, "owner-b");
  assert.equal(result, null);

  const own = await activity.getForOwner(a1.id, "owner-a");
  assert.ok(own);
  assert.equal(own!.id, a1.id);
});

test("SQLite: getForOwner returns null for non-owner", async () => {
  const { activity, cleanup } = makeStores();
  try {
    const a1 = createActivity("agent-a", "owner-a", makeIntent("1"), makeDecision());
    await activity.record(a1);

    const result = await activity.getForOwner(a1.id, "owner-b");
    assert.equal(result, null);

    const own = await activity.getForOwner(a1.id, "owner-a");
    assert.ok(own);
    assert.equal(own!.id, a1.id);
  } finally {
    cleanup();
  }
});

// ===== Approval ownership =====

test("InMemory: listByOwner returns only own approvals", async () => {
  const { approval } = memoryStores();
  const a1 = createApproval("act-1", "agent-a", "owner-a", makeIntent("1"), makeDecision(), null);
  const a2 = createApproval("act-2", "agent-b", "owner-b", makeIntent("2"), makeDecision(), null);
  await approval.record(a1);
  await approval.record(a2);

  const ownerARecords = await approval.listByOwner("owner-a");
  assert.equal(ownerARecords.length, 1);
  assert.equal(ownerARecords[0]!.id, a1.id);
});

test("SQLite: listByOwner returns only own approvals", async () => {
  const { approval, cleanup } = makeStores();
  try {
    const a1 = createApproval("act-1", "agent-a", "owner-a", makeIntent("1"), makeDecision(), null);
    const a2 = createApproval("act-2", "agent-b", "owner-b", makeIntent("2"), makeDecision(), null);
    await approval.record(a1);
    await approval.record(a2);

    const ownerARecords = await approval.listByOwner("owner-a");
    assert.equal(ownerARecords.length, 1);
    assert.equal(ownerARecords[0]!.id, a1.id);
  } finally {
    cleanup();
  }
});

test("InMemory: getForOwner returns null for non-owner approval", async () => {
  const { approval } = memoryStores();
  const a1 = createApproval("act-1", "agent-a", "owner-a", makeIntent("1"), makeDecision(), null);
  await approval.record(a1);

  const result = await approval.getForOwner(a1.id, "owner-b");
  assert.equal(result, null);

  const own = await approval.getForOwner(a1.id, "owner-a");
  assert.ok(own);
  assert.equal(own!.id, a1.id);
});

test("SQLite: getForOwner returns null for non-owner approval", async () => {
  const { approval, cleanup } = makeStores();
  try {
    const a1 = createApproval("act-1", "agent-a", "owner-a", makeIntent("1"), makeDecision(), null);
    await approval.record(a1);

    const result = await approval.getForOwner(a1.id, "owner-b");
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

// ===== Cross-owner isolation: listAll vs listByOwner =====

test("InMemory: listAll returns all records; listByOwner filters", async () => {
  const { activity } = memoryStores();
  await activity.record(createActivity("a1", "owner-a", makeIntent("1"), makeDecision()));
  await activity.record(createActivity("a2", "owner-b", makeIntent("2"), makeDecision()));
  await activity.record(createActivity("a3", "owner-a", makeIntent("3"), makeDecision()));

  const all = await activity.listAll(100);
  assert.equal(all.length, 3);

  const ownerA = await activity.listByOwner("owner-a", 100);
  assert.equal(ownerA.length, 2);
  assert.ok(ownerA.every((r) => r.ownerId === "owner-a"));
});

test("SQLite: listAll returns all records; listByOwner filters", async () => {
  const { activity, cleanup } = makeStores();
  try {
    await activity.record(createActivity("a1", "owner-a", makeIntent("1"), makeDecision()));
    await activity.record(createActivity("a2", "owner-b", makeIntent("2"), makeDecision()));
    await activity.record(createActivity("a3", "owner-a", makeIntent("3"), makeDecision()));

    const all = await activity.listAll(100);
    assert.equal(all.length, 3);

    const ownerA = await activity.listByOwner("owner-a", 100);
    assert.equal(ownerA.length, 2);
  } finally {
    cleanup();
  }
});

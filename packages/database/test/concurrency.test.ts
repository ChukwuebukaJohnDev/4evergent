import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryActivityStore } from "../src/index.js";
import type { ActivityRecord } from "@4evergent/shared";

function makeRecord(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: "agent-a",
    ownerId: "owner-a",
    intent: { type: "payment", asset: "XLM", destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amount: "10", reason: "test" },
    policyDecision: { result: "allow", reason: "test", rule: "test", intent: null as any },
    authorizationStatus: null,
    simulationResult: null,
    txHash: null,
    status: "pending",
    error: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("CONCURRENCY: identical idempotency key → only one created", async () => {
  const store = new InMemoryActivityStore();
  const record1 = makeRecord({ id: "r1" });
  const record2 = makeRecord({ id: "r2" });

  const result1 = await store.recordIdempotent("idem-key-1", record1);
  const result2 = await store.recordIdempotent("idem-key-1", record2);

  assert.equal(result1.created, true);
  assert.equal(result2.created, false);
  assert.equal(result2.record.id, "r1"); // Returns the first record
});

test("CONCURRENCY: concurrent identical idempotency keys → same record returned", async () => {
  const store = new InMemoryActivityStore();
  const record1 = makeRecord({ id: "r1" });
  const record2 = makeRecord({ id: "r2" });

  // Simulate concurrent calls
  const [result1, result2] = await Promise.all([
    store.recordIdempotent("idem-key-concurrent", record1),
    store.recordIdempotent("idem-key-concurrent", record2),
  ]);

  // One created, one returned existing
  const created = [result1.created, result2.created].filter(Boolean).length;
  assert.equal(created, 1, "Only one should be created");
  assert.equal(result1.record.id, result2.record.id, "Both should reference the same record");
});

test("CONCURRENCY: different idempotency keys → different records", async () => {
  const store = new InMemoryActivityStore();
  const record1 = makeRecord({ id: "r1" });
  const record2 = makeRecord({ id: "r2" });

  const result1 = await store.recordIdempotent("idem-key-a", record1);
  const result2 = await store.recordIdempotent("idem-key-b", record2);

  assert.equal(result1.created, true);
  assert.equal(result2.created, true);
  assert.notEqual(result1.record.id, result2.record.id);
});

test("CONCURRENCY: idempotency key scoped to owner+agent", async () => {
  const store = new InMemoryActivityStore();
  const recordOwnerA = makeRecord({ id: "r1", ownerId: "owner-a", agentId: "agent-a" });
  const recordOwnerB = makeRecord({ id: "r2", ownerId: "owner-b", agentId: "agent-a" });

  const result1 = await store.recordIdempotent("idem-key-scope", recordOwnerA);
  const result2 = await store.recordIdempotent("idem-key-scope", recordOwnerB);

  // Different owner → different records
  assert.equal(result1.created, true);
  assert.equal(result2.created, true);
  assert.notEqual(result1.record.id, result2.record.id);
});

test("DAILY SPENDING: concurrent reservations within limit → all succeed", async () => {
  const store = new InMemoryActivityStore();

  const results = await Promise.all([
    store.reserveDailySpending("agent-a", "XLM", "30", "100"),
    store.reserveDailySpending("agent-a", "XLM", "30", "100"),
    store.reserveDailySpending("agent-a", "XLM", "30", "100"),
  ]);

  assert.deepEqual(results, [true, true, true]);
});

test("DAILY SPENDING: concurrent reservations exceeding limit → only safe subset", async () => {
  const store = new InMemoryActivityStore();

  // Two requests of 60 each with limit 100 → only one should succeed
  const results = await Promise.all([
    store.reserveDailySpending("agent-a", "XLM", "60", "100"),
    store.reserveDailySpending("agent-a", "XLM", "60", "100"),
  ]);

  const succeeded = results.filter(Boolean).length;
  assert.ok(succeeded <= 1, `Expected at most 1 to succeed, got ${succeeded}`);
});

test("DAILY SPENDING: exact limit boundary", async () => {
  const store = new InMemoryActivityStore();

  const result1 = await store.reserveDailySpending("agent-a", "XLM", "100", "100");
  assert.equal(result1, true);

  // Second request should fail (limit reached)
  const result2 = await store.reserveDailySpending("agent-a", "XLM", "1", "100");
  assert.equal(result2, false);
});

test("DAILY SPENDING: below limit always succeeds", async () => {
  const store = new InMemoryActivityStore();

  const result = await store.reserveDailySpending("agent-a", "XLM", "50", "100");
  assert.equal(result, true);
});

test("DAILY SPENDING: different agents independent", async () => {
  const store = new InMemoryActivityStore();

  const resultA = await store.reserveDailySpending("agent-a", "XLM", "100", "100");
  const resultB = await store.reserveDailySpending("agent-b", "XLM", "100", "100");

  assert.equal(resultA, true);
  assert.equal(resultB, true);
});

test("DAILY SPENDING: invalid amount rejected", async () => {
  const store = new InMemoryActivityStore();

  const result = await store.reserveDailySpending("agent-a", "XLM", "abc", "100");
  assert.equal(result, false);
});

test("DAILY SPENDING: invalid limit rejected", async () => {
  const store = new InMemoryActivityStore();

  const result = await store.reserveDailySpending("agent-a", "XLM", "10", "xyz");
  assert.equal(result, false);
});

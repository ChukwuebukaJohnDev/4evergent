import { test } from "node:test";
import assert from "node:assert/strict";
import { SQLiteActivityStore } from "../src/sqlite-store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "4evergent-test-"));
  const path = join(dir, "test.db");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("SQLITE CONCURRENCY: identical idempotency key → only one created", async () => {
  const { path, cleanup } = makeTempDb();
  try {
    const store = new SQLiteActivityStore(path);
    const now = new Date().toISOString();
    const record1 = {
      id: "r1",
      agentId: "agent-a",
      ownerId: "owner-a",
      intent: { type: "payment" as const, asset: "XLM", destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amount: "10", reason: "test" },
      policyDecision: { result: "allow" as const, reason: "test", rule: "test", intent: null as any },
      authorizationStatus: null,
      simulationResult: null,
      txHash: null,
      status: "pending" as const,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const record2 = { ...record1, id: "r2" };

    const result1 = await store.recordIdempotent("idem-key-1", record1);
    const result2 = await store.recordIdempotent("idem-key-1", record2);

    assert.equal(result1.created, true);
    assert.equal(result2.created, false);
    assert.equal(result2.record.id, "r1");
    store.close();
  } finally {
    cleanup();
  }
});

test("SQLITE CONCURRENCY: concurrent identical idempotency keys → same record", async () => {
  const { path, cleanup } = makeTempDb();
  try {
    const store = new SQLiteActivityStore(path);
    const now = new Date().toISOString();
    const record1 = {
      id: "r1",
      agentId: "agent-a",
      ownerId: "owner-a",
      intent: { type: "payment" as const, asset: "XLM", destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", amount: "10", reason: "test" },
      policyDecision: { result: "allow" as const, reason: "test", rule: "test", intent: null as any },
      authorizationStatus: null,
      simulationResult: null,
      txHash: null,
      status: "pending" as const,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const record2 = { ...record1, id: "r2" };

    const [result1, result2] = await Promise.all([
      store.recordIdempotent("idem-key-conc", record1),
      store.recordIdempotent("idem-key-conc", record2),
    ]);

    const created = [result1.created, result2.created].filter(Boolean).length;
    assert.equal(created, 1, "Only one should be created");
    assert.equal(result1.record.id, result2.record.id, "Both should reference same record");
    store.close();
  } finally {
    cleanup();
  }
});

test("SQLITE CONCURRENCY: concurrent daily spending → limit respected", async () => {
  const { path, cleanup } = makeTempDb();
  try {
    const store = new SQLiteActivityStore(path);

    // Two concurrent requests of 60 each with limit 100
    const results = await Promise.all([
      store.reserveDailySpending("agent-a", "XLM", "60", "100"),
      store.reserveDailySpending("agent-a", "XLM", "60", "100"),
    ]);

    const succeeded = results.filter(Boolean).length;
    assert.ok(succeeded <= 1, `Expected at most 1 to succeed, got ${succeeded}`);
    store.close();
  } finally {
    cleanup();
  }
});

test("SQLITE CONCURRENCY: daily spending exact limit boundary", async () => {
  const { path, cleanup } = makeTempDb();
  try {
    const store = new SQLiteActivityStore(path);

    const result1 = await store.reserveDailySpending("agent-a", "XLM", "100", "100");
    assert.equal(result1, true);

    // Second request should fail (limit reached)
    const result2 = await store.reserveDailySpending("agent-a", "XLM", "1", "100");
    assert.equal(result2, false);
    store.close();
  } finally {
    cleanup();
  }
});

test("SQLITE CONCURRENCY: daily spending different agents independent", async () => {
  const { path, cleanup } = makeTempDb();
  try {
    const store = new SQLiteActivityStore(path);

    const resultA = await store.reserveDailySpending("agent-a", "XLM", "100", "100");
    const resultB = await store.reserveDailySpending("agent-b", "XLM", "100", "100");

    assert.equal(resultA, true);
    assert.equal(resultB, true);
    store.close();
  } finally {
    cleanup();
  }
});

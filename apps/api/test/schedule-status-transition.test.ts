import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { clearAgents } from "../src/index.js";
import { InMemoryScheduleStore } from "@4evergent/database";
import type { ScheduleRecord } from "@4evergent/database";
import { startServer, apiFetch } from "./helpers.js";

type Status = "active" | "paused" | "disabled";
type Action = "pause" | "resume" | "disable";

function makeSchedule(status: Status): ScheduleRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: "test-agent",
    ownerId: "test",
    status,
    intent: {
      type: "payment",
      asset: "XLM",
      destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      amount: "10",
      reason: "transition test",
    },
    scheduleExpression: "0 * * * *",
    timezone: "UTC",
    nextRunAt: "2099-01-01T00:00:00Z",
    lastRunAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  clearAgents();
});

// Explicit expectation per cell: the resulting status on 200, or null for 409.
const MATRIX: Array<[Status, Action, Status | null]> = [
  ["active", "pause", "paused"],
  ["active", "resume", null],
  ["active", "disable", "disabled"],
  ["paused", "pause", null],
  ["paused", "resume", "active"],
  ["paused", "disable", "disabled"],
  ["disabled", "pause", null],
  ["disabled", "resume", "active"],
  ["disabled", "disable", null],
];

for (const [from, action, expected] of MATRIX) {
  test(`schedule ${action} from ${from}: ${expected ? `200 -> ${expected}` : "409, unchanged"}`, async () => {
    const store = new InMemoryScheduleStore();
    const schedule = makeSchedule(from);
    await store.create(schedule);
    const { baseUrl, close } = await startServer({ scheduleStore: store });
    try {
      const res = await apiFetch(`${baseUrl}/agents/test-agent/schedules/${schedule.id}/${action}`, { method: "POST" });
      const body = await res.json();
      if (expected) {
        assert.equal(res.status, 200);
        assert.equal(body.schedule.status, expected);
        assert.equal((await store.get(schedule.id))?.status, expected);
      } else {
        assert.equal(res.status, 409);
        assert.equal(body.error, `cannot ${action} schedule in status '${from}'`);
        assert.equal((await store.get(schedule.id))?.status, from);
      }
    } finally {
      await close();
    }
  });
}

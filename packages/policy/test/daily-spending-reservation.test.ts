import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { PolicyEngine } from "../src/engine.js";
import type { AgentIntent } from "@4evergent/shared";
import {
  InMemoryActivityStore,
  SQLiteActivityStore,
  type ActivityStore,
} from "../../database/src/index.js";

function makePaymentIntent(amount: string, asset = "XLM"): AgentIntent {
  return {
    type: "payment",
    asset,
    destination: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount,
    reason: "test",
  };
}

function makeApprovalRequiredPolicy() {
  return {
    maxTxAmount: { XLM: "10000" },
    dailySpendingLimit: { XLM: "5000" },
    allowedAssets: ["XLM"],
    allowedDestinations: [] as string[],
    allowedContractIds: [] as string[],
    txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
    approvalThreshold: "100",
    requireHumanApprovalForAmountAbove: "100",
  };
}

function makeStrictPolicy() {
  return {
    maxTxAmount: { XLM: "5" },
    dailySpendingLimit: { XLM: "1000" },
    allowedAssets: ["XLM"],
    allowedDestinations: [] as string[],
    allowedContractIds: [] as string[],
    txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
    approvalThreshold: "1000",
    requireHumanApprovalForAmountAbove: "1000",
  };
}

// Valid 56-char Stellar public key
const VALID_ISSUER = "GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA";

async function getDailySpent(store: ActivityStore, agentId: string, asset: string): Promise<number> {
  if (store instanceof InMemoryActivityStore) {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    const mapKey = `${agentId}:${asset}:${day}`;
    const dailySpending = (store as any).dailySpending as Map<string, number>;
    return dailySpending?.get(mapKey) ?? 0;
  }
  if (store instanceof SQLiteActivityStore) {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    const db = (store as any).db;
    const row = db.prepare("SELECT total FROM daily_spending WHERE agent_id = ? AND asset = ? AND day = ?").get(agentId, asset, day) as { total: number } | undefined;
    return row?.total ?? 0;
  }
  return 0;
}

// ===== DAILY SPENDING RESERVATION TESTS =====
// Invariant: ONE INTENT = ONE DAILY-SPENDING RESERVATION
// The approve path re-evaluates current policy WITHOUT re-reserving.

test("RESERVATION: direct execution reserves daily spending exactly once", async () => {
  const store = new InMemoryActivityStore();
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store);
  const decision = await engine.evaluate(makePaymentIntent("50"), "agent-1");
  assert.equal(decision.result, "allow");
  assert.equal(await getDailySpent(store, "agent-1", "XLM"), 50);
});

test("RESERVATION: skipReservation does NOT reserve daily spending", async () => {
  const store = new InMemoryActivityStore();
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store);
  const decision = await engine.evaluate(makePaymentIntent("50"), "agent-1", { skipReservation: true });
  assert.equal(decision.result, "allow");
  assert.equal(await getDailySpent(store, "agent-1", "XLM"), 0);
});

test("RESERVATION: approve path reserves once at creation, re-eval checks policy without re-reserving", async () => {
  const store = new InMemoryActivityStore();
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store);
  // Intent creation: reserves daily spending (200 >= threshold 100 → requires_approval)
  const decision1 = await engine.evaluate(makePaymentIntent("200"), "agent-1");
  assert.equal(decision1.result, "requires_approval");
  const spent1 = await getDailySpent(store, "agent-1", "XLM");
  assert.equal(spent1, 200);
  // Approval execution: re-evaluate current policy WITHOUT reserving again.
  // executeApproved ignores non-deny results; key invariant is NO second reservation.
  const decision2 = await engine.evaluate(makePaymentIntent("200"), "agent-1", { skipReservation: true });
  assert.notEqual(decision2.result, "deny", "Same policy should not deny already-approved intent");
  const spent2 = await getDailySpent(store, "agent-1", "XLM");
  assert.equal(spent2, 200, "Approval execution must NOT double-reserve");
});

test("RESERVATION: tightened policy at approval execution time denies", async () => {
  const store = new InMemoryActivityStore();
  const engineLenient = new PolicyEngine(makeApprovalRequiredPolicy(), store);
  const d1 = await engineLenient.evaluate(makePaymentIntent("500"), "agent-1");
  assert.equal(d1.result, "requires_approval");
  const spent1 = await getDailySpent(store, "agent-1", "XLM");
  assert.equal(spent1, 500);
  // Policy tightened: maxTxAmount=5 (was 10000)
  const engineStrict = new PolicyEngine(makeStrictPolicy(), store);
  const d2 = await engineStrict.evaluate(makePaymentIntent("500"), "agent-1", { skipReservation: true });
  assert.equal(d2.result, "deny");
  assert.match(d2.reason, /max_tx_amount/);
  assert.equal(await getDailySpent(store, "agent-1", "XLM"), 500);
});

test("RESERVATION: skipReservation does not increase daily spending total", async () => {
  // After an initial reservation, skipReservation evaluation should NOT change the total.
  const store = new InMemoryActivityStore();
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store);
  // Initial reservation: 90 XLM
  await engine.evaluate(makePaymentIntent("90"), "agent-1");
  const spentAfterReserve = await getDailySpent(store, "agent-1", "XLM");
  assert.equal(spentAfterReserve, 90);
  // Re-evaluate with skipReservation: total should remain 90 (not 90+90=180)
  await engine.evaluate(makePaymentIntent("90"), "agent-1", { skipReservation: true });
  const spentAfterSkip = await getDailySpent(store, "agent-1", "XLM");
  assert.equal(spentAfterSkip, 90, "skipReservation must not increase daily spending");
});

test("RESERVATION: SQLite direct execution reserves exactly once", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "res-test-"));
  const store = new SQLiteActivityStore(join(tmp, "test.db"));
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store as any);
  const d = await engine.evaluate(makePaymentIntent("75"), "agent-sqlite-1");
  assert.equal(d.result, "allow");
  assert.equal(await getDailySpent(store, "agent-sqlite-1", "XLM"), 75);
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("RESERVATION: SQLite approve path reserves once, not twice", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "res-test-"));
  const store = new SQLiteActivityStore(join(tmp, "test.db"));
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store as any);
  const d1 = await engine.evaluate(makePaymentIntent("200"), "agent-sqlite-1");
  assert.equal(d1.result, "requires_approval");
  assert.equal(await getDailySpent(store, "agent-sqlite-1", "XLM"), 200);
  const d2 = await engine.evaluate(makePaymentIntent("200"), "agent-sqlite-1", { skipReservation: true });
  assert.notEqual(d2.result, "deny");
  assert.equal(await getDailySpent(store, "agent-sqlite-1", "XLM"), 200, "SQLite: no double-reserve");
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("RESERVATION: SQLite tightened policy denies at approval time", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "res-test-"));
  const store = new SQLiteActivityStore(join(tmp, "test.db"));
  const engineLenient = new PolicyEngine({ ...makeApprovalRequiredPolicy(), maxTxAmount: { XLM: "10000" }, dailySpendingLimit: { XLM: "5000" } }, store as any);
  const d1 = await engineLenient.evaluate(makePaymentIntent("500"), "agent-sqlite-1");
  assert.equal(d1.result, "requires_approval");
  assert.equal(await getDailySpent(store, "agent-sqlite-1", "XLM"), 500);
  const engineStrict = new PolicyEngine({ ...makeStrictPolicy(), maxTxAmount: { XLM: "10" } }, store as any);
  const d2 = await engineStrict.evaluate(makePaymentIntent("500"), "agent-sqlite-1", { skipReservation: true });
  assert.equal(d2.result, "deny");
  assert.equal(await getDailySpent(store, "agent-sqlite-1", "XLM"), 500);
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

test("RESERVATION: zero amount does not affect daily spending", async () => {
  const store = new InMemoryActivityStore();
  const engine = new PolicyEngine(makeApprovalRequiredPolicy(), store);
  const d = await engine.evaluate(makePaymentIntent("0"), "agent-1");
  assert.equal(d.result, "deny");
  assert.equal(await getDailySpent(store, "agent-1", "XLM"), 0);
});

test("RESERVATION: trustline intent does not consume XLM daily spending", async () => {
  const store = new InMemoryActivityStore();
  const engine = new PolicyEngine({
    ...makeApprovalRequiredPolicy(),
    txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
    requireHumanApprovalForAmountAbove: "5000",
    allowedAssets: [],
  }, store);
  const d = await engine.evaluate(
    { type: "trustline", assetCode: "USDC", issuer: VALID_ISSUER, limit: "100", reason: "test" },
    "agent-1"
  );
  assert.equal(d.result, "allow");
  assert.equal(await getDailySpent(store, "agent-1", "XLM"), 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import {
  SQLitePolicyConfigStore,
  InMemoryPolicyConfigStore,
} from "../src/index.js";
import type { PolicyRules } from "@4evergent/shared";

function makePolicy(maxTx = "100", dailyLimit = "500"): PolicyRules {
  return {
    maxTxAmount: { XLM: maxTx },
    dailySpendingLimit: { XLM: dailyLimit },
    allowedAssets: ["XLM"],
    allowedDestinations: [],
    allowedContractIds: [],
    txTypeRestrictions: { payment: true, trustline: true, contract_call: false, account_settings: false },
    approvalThreshold: "50",
    requireHumanApprovalForAmountAbove: "50",
  };
}

// ===== SQLite Policy Config Store Tests =====

test("POLICY STORE (SQLite): initial get returns null for unknown agent", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    const result = await store.get("unknown-agent");
    assert.equal(result, null);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): upsert returns version=1 for new agent", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    const result = await store.upsert("agent-1", "owner-a", makePolicy());
    assert.equal(result.version, 1);
    assert.deepEqual(result.rules.maxTxAmount, { XLM: "100" });
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): version increments on each upsert", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    const r1 = await store.upsert("agent-1", "owner-a", makePolicy("100"));
    assert.equal(r1.version, 1);

    const r2 = await store.upsert("agent-1", "owner-a", makePolicy("200"));
    assert.equal(r2.version, 2);

    const r3 = await store.upsert("agent-1", "owner-a", makePolicy("300"));
    assert.equal(r3.version, 3);

    // Verify latest version is stored
    const metadata = await store.getWithMetadata("agent-1");
    assert.equal(metadata?.version, 3);
    assert.equal(metadata?.rules.maxTxAmount.XLM, "300");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): upsert cannot transfer an agent policy to another owner", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    await store.upsert("agent-1", "owner-a", makePolicy("100"));

    await assert.rejects(
      store.upsert("agent-1", "owner-b", makePolicy("999")),
      /owned by another user/
    );

    assert.equal((await store.getForOwner("agent-1", "owner-a"))?.maxTxAmount.XLM, "100");
    assert.equal(await store.getForOwner("agent-1", "owner-b"), null);
    assert.equal((await store.getWithMetadata("agent-1"))?.version, 1);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): persistence survives store restart", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const dbPath = join(tmp, "test.db");
  const store1 = new SQLitePolicyConfigStore(dbPath);
  try {
    const result = await store1.upsert("agent-1", "owner-a", makePolicy("75"));
    assert.equal(result.version, 1);
  } finally {
    store1.close();
  }

  // Restart store (new instance, same DB)
  const store2 = new SQLitePolicyConfigStore(dbPath);
  try {
    const metadata = await store2.getWithMetadata("agent-1");
    assert.equal(metadata?.rules.maxTxAmount.XLM, "75");
    assert.equal(metadata?.version, 1);
  } finally {
    store2.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): different agents have independent versions", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    const r1 = await store.upsert("agent-a", "owner-1", makePolicy("100"));
    assert.equal(r1.version, 1);

    const r2 = await store.upsert("agent-b", "owner-1", makePolicy("200"));
    assert.equal(r2.version, 1);

    // Upsert agent-a again
    const r3 = await store.upsert("agent-a", "owner-1", makePolicy("150"));
    assert.equal(r3.version, 2);

    // Agent-b should still be version 1
    const metaB = await store.getWithMetadata("agent-b");
    assert.equal(metaB?.version, 1);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): getForOwner enforces ownership", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    await store.upsert("agent-1", "owner-a", makePolicy("100"));

    const ownerAPolicy = await store.getForOwner("agent-1", "owner-a");
    assert.ok(ownerAPolicy);
    assert.equal(ownerAPolicy.maxTxAmount.XLM, "100");

    // Owner B should not see this policy
    const ownerBPolicy = await store.getForOwner("agent-1", "owner-b");
    assert.equal(ownerBPolicy, null);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): delete removes policy", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    await store.upsert("agent-1", "owner-a", makePolicy());
    const deleted = await store.delete("agent-1");
    assert.equal(deleted, true);
    const result = await store.get("agent-1");
    assert.equal(result, null);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("POLICY STORE (SQLite): listByOwner returns only owned policies", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "policy-test-"));
  const store = new SQLitePolicyConfigStore(join(tmp, "test.db"));
  try {
    await store.upsert("agent-a", "owner-1", makePolicy("100"));
    await store.upsert("agent-b", "owner-1", makePolicy("200"));
    await store.upsert("agent-c", "owner-2", makePolicy("300"));

    const list = await store.listByOwner("owner-1");
    assert.equal(list.length, 2);
    const agentIds = list.map((e) => e.agentId).sort();
    assert.deepEqual(agentIds, ["agent-a", "agent-b"]);
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ===== InMemory Policy Config Store Tests =====

test("POLICY STORE (InMemory): initial get returns null for unknown agent", async () => {
  const store = new InMemoryPolicyConfigStore();
  const result = await store.get("unknown-agent");
  assert.equal(result, null);
});

test("POLICY STORE (InMemory): upsert returns version=1 for new agent", async () => {
  const store = new InMemoryPolicyConfigStore();
  const result = await store.upsert("agent-1", "owner-a", makePolicy());
  assert.equal(result.version, 1);
});

test("POLICY STORE (InMemory): version increments on each upsert", async () => {
  const store = new InMemoryPolicyConfigStore();
  const r1 = await store.upsert("agent-1", "owner-a", makePolicy("100"));
  assert.equal(r1.version, 1);

  const r2 = await store.upsert("agent-1", "owner-a", makePolicy("200"));
  assert.equal(r2.version, 2);

  const metadata = await store.getWithMetadata("agent-1");
  assert.equal(metadata?.version, 2);
});

test("POLICY STORE (InMemory): upsert cannot transfer an agent policy to another owner", async () => {
  const store = new InMemoryPolicyConfigStore();
  await store.upsert("agent-1", "owner-a", makePolicy("100"));

  await assert.rejects(
    store.upsert("agent-1", "owner-b", makePolicy("999")),
    /owned by another user/
  );

  assert.equal((await store.getForOwner("agent-1", "owner-a"))?.maxTxAmount.XLM, "100");
  assert.equal(await store.getForOwner("agent-1", "owner-b"), null);
  assert.equal((await store.getWithMetadata("agent-1"))?.version, 1);
});

test("POLICY STORE (InMemory): getForOwner enforces ownership", async () => {
  const store = new InMemoryPolicyConfigStore();
  await store.upsert("agent-1", "owner-a", makePolicy("100"));

  const ownerAPolicy = await store.getForOwner("agent-1", "owner-a");
  assert.ok(ownerAPolicy);

  const ownerBPolicy = await store.getForOwner("agent-1", "owner-b");
  assert.equal(ownerBPolicy, null);
});

test("POLICY STORE (InMemory): concurrent updates do not corrupt state", async () => {
  const store = new InMemoryPolicyConfigStore();
  // Multiple rapid upserts should each increment version
  const promises: Promise<any>[] = [];
  for (let i = 0; i < 10; i++) {
    promises.push(store.upsert("agent-1", "owner-a", makePolicy(String(i * 10))));
  }
  await Promise.all(promises);

  const metadata = await store.getWithMetadata("agent-1");
  // Version should be exactly 10 (started from 0, 10 increments)
  assert.equal(metadata?.version, 10);
});

test("POLICY STORE (InMemory): delete removes policy", async () => {
  const store = new InMemoryPolicyConfigStore();
  await store.upsert("agent-1", "owner-a", makePolicy());
  const deleted = await store.delete("agent-1");
  assert.equal(deleted, true);
  const result = await store.get("agent-1");
  assert.equal(result, null);
});

test("POLICY STORE (InMemory): listByOwner returns only owned policies", async () => {
  const store = new InMemoryPolicyConfigStore();
  await store.upsert("agent-a", "owner-1", makePolicy("100"));
  await store.upsert("agent-b", "owner-2", makePolicy("200"));

  const list = await store.listByOwner("owner-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].agentId, "agent-a");
});

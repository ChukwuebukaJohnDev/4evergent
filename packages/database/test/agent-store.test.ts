import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { InMemoryAgentStore, SQLiteAgentStore, MAX_LIMIT } from "../src/agent-store.js";
import { closeSharedConnection } from "../src/shared-connection.js";
import type { CreateAgentInput, AgentStore } from "../src/agent-types.js";

interface StoreFactoryResult {
  store: AgentStore;
  cleanup?: () => void;
}

function testStores(name: string, makeStore: () => StoreFactoryResult) {
  test(`${name}: create and get`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const input: CreateAgentInput = { displayName: "Agent A", ownerId: "owner-a" };
      const agent = await store.create(input);
      assert.equal(agent.displayName, "Agent A");
      assert.equal(agent.status, "active");
      assert.equal(agent.active, true);
      assert.deepEqual(agent.capabilities, []);
      assert.equal(agent.description, "");
      assert.equal(agent.stellarAddress, "");
      assert.ok(agent.id);

      const fetched = await store.get(agent.id);
      assert.equal(fetched?.id, agent.id);
      assert.equal(fetched?.ownerId, "owner-a");
      assert.equal(fetched?.metadata !== undefined, true);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: create with full fields`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const agent = await store.create({
        displayName: "Full",
        description: "desc",
        capabilities: ["payment"],
        ownerId: "owner-b",
        stellarAddress: "GADDR",
        status: "paused",
      });
      assert.equal(agent.status, "paused");
      assert.equal(agent.active, false);
      assert.deepEqual(agent.capabilities, ["payment"]);
      assert.equal(agent.stellarAddress, "GADDR");
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: create preserves explicit id`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const agent = await store.create({ id: "fixed-id", displayName: "Fixed", ownerId: "owner-a" });
      assert.equal(agent.id, "fixed-id");
      const fetched = await store.get("fixed-id");
      assert.equal(fetched?.displayName, "Fixed");
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: getForOwner enforces owner`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const agent = await store.create({ displayName: "X", ownerId: "owner-a" });
      assert.ok(await store.getForOwner(agent.id, "owner-a"));
      assert.equal(await store.getForOwner(agent.id, "owner-b"), null);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByOwner only returns owner records`, async () => {
    const { store, cleanup } = makeStore();
    try {
      await store.create({ displayName: "A", ownerId: "owner-a" });
      await store.create({ displayName: "B", ownerId: "owner-b" });
      const list = await store.listByOwner("owner-a");
      assert.equal(list.length, 1);
      assert.equal(list[0]?.displayName, "A");
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: update status`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const agent = await store.create({ displayName: "A", ownerId: "owner-a" });
      const updated = await store.update(agent.id, { status: "paused" });
      assert.equal(updated?.status, "paused");
      assert.equal(updated?.active, false);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: delete removes record`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const agent = await store.create({ displayName: "A", ownerId: "owner-a" });
      assert.equal(await store.delete(agent.id), true);
      assert.equal(await store.get(agent.id), null);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability returns matching agents with full capability array`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const a1 = await store.create({
        displayName: "Payment and Trustline",
        ownerId: "owner-a",
        capabilities: ["payment", "trustline"],
      });
      await store.create({
        displayName: "Trustline only",
        ownerId: "owner-a",
        capabilities: ["trustline"],
      });
      const a3 = await store.create({
        displayName: "Payment only",
        ownerId: "owner-a",
        capabilities: ["payment"],
      });

      const matched = await store.listByCapability("owner-a", "payment");
      assert.equal(matched.length, 2);
      const ids = matched.map((a) => a.id);
      assert.ok(ids.includes(a1.id));
      assert.ok(ids.includes(a3.id));

      const foundA1 = matched.find((a) => a.id === a1.id);
      assert.deepEqual(foundA1?.capabilities, ["payment", "trustline"]);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability exact match semantics (no substring or prefix)`, async () => {
    const { store, cleanup } = makeStore();
    try {
      await store.create({
        displayName: "Payment Agent",
        ownerId: "owner-a",
        capabilities: ["payment"],
      });

      // Substring/prefix "pay" must NOT match "payment"
      const prefixMatch = await store.listByCapability("owner-a", "pay");
      assert.deepEqual(prefixMatch, []);

      // Superstring "payment_batching" must NOT match "payment"
      const superMatch = await store.listByCapability("owner-a", "payment_batching");
      assert.deepEqual(superMatch, []);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability case sensitivity`, async () => {
    const { store, cleanup } = makeStore();
    try {
      await store.create({
        displayName: "Payment Agent",
        ownerId: "owner-a",
        capabilities: ["payment"],
      });

      const titleMatch = await store.listByCapability("owner-a", "Payment");
      assert.deepEqual(titleMatch, []);

      const upperMatch = await store.listByCapability("owner-a", "PAYMENT");
      assert.deepEqual(upperMatch, []);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability returns empty array on no-match (never null or error)`, async () => {
    const { store, cleanup } = makeStore();
    try {
      await store.create({
        displayName: "Payment Agent",
        ownerId: "owner-a",
        capabilities: ["payment"],
      });

      const res = await store.listByCapability("owner-a", "nonexistent");
      assert.ok(Array.isArray(res));
      assert.equal(res.length, 0);

      const emptyRes = await store.listByCapability("owner-a", "");
      assert.ok(Array.isArray(emptyRes));
      assert.equal(emptyRes.length, 0);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability enforces owner isolation`, async () => {
    const { store, cleanup } = makeStore();
    try {
      const a1 = await store.create({
        displayName: "Owner A Payment Agent",
        ownerId: "owner-a",
        capabilities: ["payment"],
      });
      await store.create({
        displayName: "Owner B Payment Agent",
        ownerId: "owner-b",
        capabilities: ["payment"],
      });

      const ownerARes = await store.listByCapability("owner-a", "payment");
      assert.equal(ownerARes.length, 1);
      assert.equal(ownerARes[0].id, a1.id);
      assert.equal(ownerARes[0].ownerId, "owner-a");

      const ownerBRes = await store.listByCapability("owner-b", "payment");
      assert.equal(ownerBRes.length, 1);
      assert.equal(ownerBRes[0].ownerId, "owner-b");
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability respects limit parameter`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({
          displayName: `Agent ${i}`,
          ownerId: "owner-a",
          capabilities: ["payment"],
        });
      }

      const res = await store.listByCapability("owner-a", "payment", 2);
      assert.equal(res.length, 2);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability executes in store beyond MAX_LIMIT (${MAX_LIMIT})`, async () => {
    const { store, cleanup } = makeStore();
    try {
      // Create 1 matching agent first (so it's the oldest)
      const target = await store.create({
        displayName: "Oldest Payment Agent",
        ownerId: "owner-a",
        capabilities: ["payment"],
      });

      // Create MAX_LIMIT + 5 agents without payment capability
      for (let i = 0; i < MAX_LIMIT + 5; i++) {
        await store.create({
          displayName: `Filler Agent ${i}`,
          ownerId: "owner-a",
          capabilities: ["unrelated"],
        });
      }

      // If the query was executed by post-filtering a list capped at MAX_LIMIT,
      // the target agent would have been truncated before filtering.
      // Store-level filtering ensures target is found and returned.
      const res = await store.listByCapability("owner-a", "payment");
      assert.equal(res.length, 1);
      assert.equal(res[0].id, target.id);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByOwner default limit is MAX_LIMIT (${MAX_LIMIT})`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({ displayName: `Agent ${i}`, ownerId: "owner-a" });
      }
      // Omitted limit → default MAX_LIMIT (200), so all 5 returned
      const list = await store.listByOwner("owner-a");
      assert.equal(list.length, 5);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByOwner limit=0 clamps to 1`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({ displayName: `Agent ${i}`, ownerId: "owner-a" });
      }
      const list = await store.listByOwner("owner-a", 0);
      assert.equal(list.length, 1);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByOwner limit exceeding MAX_LIMIT clamps to MAX_LIMIT`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({ displayName: `Agent ${i}`, ownerId: "owner-a" });
      }
      const list = await store.listByOwner("owner-a", 999);
      assert.equal(list.length, 5); // only 5 exist, all returned
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByOwner negative limit clamps to 1`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({ displayName: `Agent ${i}`, ownerId: "owner-a" });
      }
      const list = await store.listByOwner("owner-a", -10);
      assert.equal(list.length, 1);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability limit=0 clamps to 1`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({
          displayName: `Agent ${i}`,
          ownerId: "owner-a",
          capabilities: ["payment"],
        });
      }
      const list = await store.listByCapability("owner-a", "payment", 0);
      assert.equal(list.length, 1);
    } finally {
      cleanup?.();
    }
  });

  test(`${name}: listByCapability negative limit clamps to 1`, async () => {
    const { store, cleanup } = makeStore();
    try {
      for (let i = 0; i < 5; i++) {
        await store.create({
          displayName: `Agent ${i}`,
          ownerId: "owner-a",
          capabilities: ["payment"],
        });
      }
      const list = await store.listByCapability("owner-a", "payment", -5);
      assert.equal(list.length, 1);
    } finally {
      cleanup?.();
    }
  });
}

testStores("InMemoryAgentStore", () => ({
  store: new InMemoryAgentStore(),
}));

testStores("SQLiteAgentStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "4evergent-agent-test-"));
  const path = join(dir, "agent-test.db");
  const store = new SQLiteAgentStore(path);
  return {
    store,
    cleanup: () => {
      closeSharedConnection(path);
      rmSync(dir, { recursive: true, force: true });
    },
  };
});

test("SQLiteAgentStore: persistence across instances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "4evergent-agent-store-persist-"));
  const dbPath = join(dir, "persist.db");
  try {
    const store1 = new SQLiteAgentStore(dbPath);
    const created = await store1.create({ displayName: "Persisted", ownerId: "owner-a", capabilities: ["payment"] });
    store1.close();

    const store2 = new SQLiteAgentStore(dbPath);
    const fetched = await store2.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.displayName, "Persisted");
    assert.equal(fetched.ownerId, "owner-a");
    assert.equal(fetched.status, "active");
    assert.deepEqual(fetched.capabilities, ["payment"]);

    const byCap = await store2.listByCapability("owner-a", "payment");
    assert.equal(byCap.length, 1);
    assert.equal(byCap[0].id, created.id);
    store2.close();
  } finally {
    closeSharedConnection(dbPath);
    rmSync(dir, { recursive: true, force: true });
  }
});

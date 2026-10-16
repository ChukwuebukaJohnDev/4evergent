import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { InMemoryAgentStore, SQLiteAgentStore } from "../src/agent-store.js";
import type { CreateAgentInput } from "../src/agent-types.js";

function testStores(name: string, makeStore: () => InMemoryAgentStore | SQLiteAgentStore) {
  test(`${name}: create and get`, async () => {
    const store = makeStore();
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
  });

  test(`${name}: create with full fields`, async () => {
    const store = makeStore();
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
  });

  test(`${name}: create preserves explicit id`, async () => {
    const store = makeStore();
    const agent = await store.create({ id: "fixed-id", displayName: "Fixed", ownerId: "owner-a" });
    assert.equal(agent.id, "fixed-id");
    const fetched = await store.get("fixed-id");
    assert.equal(fetched?.displayName, "Fixed");
  });

  test(`${name}: getForOwner enforces owner`, async () => {
    const store = makeStore();
    const agent = await store.create({ displayName: "X", ownerId: "owner-a" });
    assert.ok(await store.getForOwner(agent.id, "owner-a"));
    assert.equal(await store.getForOwner(agent.id, "owner-b"), null);
  });

  test(`${name}: listByOwner only returns owner records`, async () => {
    const store = makeStore();
    await store.create({ displayName: "A", ownerId: "owner-a" });
    await store.create({ displayName: "B", ownerId: "owner-b" });
    const list = await store.listByOwner("owner-a");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.displayName, "A");
  });

  test(`${name}: update status`, async () => {
    const store = makeStore();
    const agent = await store.create({ displayName: "A", ownerId: "owner-a" });
    const updated = await store.update(agent.id, { status: "paused" });
    assert.equal(updated?.status, "paused");
    assert.equal(updated?.active, false);
  });

  test(`${name}: delete removes record`, async () => {
    const store = makeStore();
    const agent = await store.create({ displayName: "A", ownerId: "owner-a" });
    assert.equal(await store.delete(agent.id), true);
    assert.equal(await store.get(agent.id), null);
  });
}

testStores("InMemoryAgentStore", () => new InMemoryAgentStore());

test("SQLiteAgentStore: persistence across instances", async () => {
  const dbPath = `/tmp/4evergent-agent-store-${crypto.randomUUID()}.db`;
  try {
    const store1 = new SQLiteAgentStore(dbPath);
    const created = await store1.create({ displayName: "Persisted", ownerId: "owner-a" });
    store1.close();

    const store2 = new SQLiteAgentStore(dbPath);
    const fetched = await store2.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.displayName, "Persisted");
    assert.equal(fetched.ownerId, "owner-a");
    assert.equal(fetched.status, "active");
    store2.close();
  } finally {
    try { new DatabaseSync(dbPath).close(); } catch { /* ignore */ }
  }
});

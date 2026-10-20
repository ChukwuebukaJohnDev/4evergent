import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import type { Signer } from "@4evergent/stellar";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import { InMemoryApprovalStore, createApproval } from "@4evergent/database";
import type { ApprovalRecord, ApprovalStatus } from "@4evergent/database";

// Offline tests: in-process HTTP server + in-memory approval store.
// Regression coverage for issue #82 — status-filtered approval list endpoints
// must query the store (listByStatus / owner-scoped status filter) instead of
// filtering a capped in-memory window, and must reject unknown status values.

class MockSigner implements Signer {
  private id: string;
  constructor(id: string) {
    this.id = id.startsWith("G") ? id : `G${id.padEnd(55, "A").slice(0, 55)}`;
  }
  getAccountId(): string {
    return this.id;
  }
  getNetworkPassphrase(): string {
    return "Test SDF Network ; September 2015";
  }
  async sign(transaction: any): Promise<any> {
    transaction.signatures = [
      { hint: Buffer.from("mock"), signature: Buffer.from("sig") },
    ];
    return transaction;
  }
}

class RecordingApprovalStore extends InMemoryApprovalStore {
  listByStatusCalls: Array<{ agentId: string; status: string; limit: number; offset: number }> = [];
  listByAgentCalls: Array<{ agentId: string; limit: number; offset: number; status?: string }> = [];
  listByOwnerCalls: Array<{ ownerId: string; limit: number; offset: number; status?: string }> = [];
  countByOwnerCalls: Array<{ ownerId: string; status?: string }> = [];

  async listByStatus(agentId: string, status: string, limit = 50, offset = 0): Promise<ApprovalRecord[]> {
    this.listByStatusCalls.push({ agentId, status, limit, offset });
    return super.listByStatus(agentId, status, limit, offset);
  }

  async listByAgent(agentId: string, limit = 50, offset = 0, status?: string): Promise<ApprovalRecord[]> {
    this.listByAgentCalls.push({ agentId, limit, offset, status });
    return super.listByAgent(agentId, limit, offset, status);
  }

  async listByOwner(ownerId: string, limit = 50, offset = 0, status?: string): Promise<ApprovalRecord[]> {
    this.listByOwnerCalls.push({ ownerId, limit, offset, status });
    return super.listByOwner(ownerId, limit, offset, status);
  }

  async countByOwner(ownerId: string, status?: string): Promise<number> {
    this.countByOwnerCalls.push({ ownerId, status });
    return super.countByOwner(ownerId, status);
  }
}

const intent = {
  type: "payment" as const,
  asset: "XLM",
  destination: Keypair.random().publicKey(),
  amount: "1",
  reason: "status filter test",
};
const decision = {
  result: "requires_approval",
  reason: "status filter test",
  rule: "status filter test",
  intent,
} as any;

function makeApproval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    ...createApproval(crypto.randomUUID(), "test-agent", "test", intent, decision),
    ...overrides,
  };
}

async function seedApprovals(
  store: InMemoryApprovalStore,
  opts: {
    ownerId: string;
    agentId: string;
    status: ApprovalStatus;
    count: number;
    baseMs: number;
  }
) {
  for (let i = 0; i < opts.count; i++) {
    const createdAt = new Date(opts.baseMs + i).toISOString();
    await store.record(
      makeApproval({
        agentId: opts.agentId,
        ownerId: opts.ownerId,
        status: opts.status,
        createdAt,
        updatedAt: createdAt,
      })
    );
  }
}

async function startServer(approvalStore: RecordingApprovalStore) {
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner("test-agent"),
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
    approvalStore,
  });
  server.registerAgent({
    id: "test-agent",
    displayName: "Test Agent",
    description: "test agent",
    ownerId: "test",
    stellarAddress: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    capabilities: ["payment"],
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
    metadata: {},
  });

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const http = server.server.listen(0, "127.0.0.1", () => {
      const addr = http.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

async function get(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`, { keepalive: false });
  return { status: res.status, body: await res.json() };
}

const VALID_APPROVAL_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "expired",
  "executing",
  "submitted",
  "confirmed",
  "failed",
];

test("GET /agents/:id/approvals?status= routes the filtered path through listByStatus", async () => {
  const store = new RecordingApprovalStore();
  const { baseUrl, close } = await startServer(store);
  try {
    const base = Date.now();
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "pending_approval", count: 3, baseMs: base });
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "approved", count: 2, baseMs: base + 1000 });

    const filtered = await get(baseUrl, "/agents/test-agent/approvals?status=pending_approval&limit=50&offset=0");
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.approvals.length, 3);
    for (const a of filtered.body.approvals) assert.equal(a.status, "pending_approval");
    assert.deepEqual(store.listByStatusCalls, [
      { agentId: "test-agent", status: "pending_approval", limit: 51, offset: 0 },
    ]);
    assert.equal(store.listByAgentCalls.length, 0, "filtered path must not call listByAgent");

    const unfiltered = await get(baseUrl, "/agents/test-agent/approvals");
    assert.equal(unfiltered.status, 200);
    assert.equal(unfiltered.body.approvals.length, 5);
    assert.deepEqual(store.listByAgentCalls, [
      { agentId: "test-agent", limit: 51, offset: 0, status: undefined },
    ]);
    assert.equal(store.listByStatusCalls.length, 1, "unfiltered path must not call listByStatus");
  } finally {
    await close();
  }
});

test("unknown approval status returns 400 naming the valid values", async () => {
  const store = new RecordingApprovalStore();
  const { baseUrl, close } = await startServer(store);
  try {
    for (const path of [
      "/agents/test-agent/approvals?status=not_a_real_status",
      "/approvals?status=not_a_real_status",
    ]) {
      const res = await get(baseUrl, path);
      assert.equal(res.status, 400, `${path} must reject unknown statuses`);
      assert.match(res.body.error, /invalid status 'not_a_real_status'/);
      for (const valid of VALID_APPROVAL_STATUSES) {
        assert.ok(res.body.error.includes(valid), `${path} error must name valid value ${valid}`);
      }
      assert.equal(res.body.approvals, undefined, `${path} must not return a list`);
    }

    const empty = await get(baseUrl, "/approvals?status=");
    assert.equal(empty.status, 400, "an explicitly empty status must not be treated as absent");

    const noMatches = await get(baseUrl, "/approvals?status=confirmed");
    assert.equal(noMatches.status, 200);
    assert.deepEqual(noMatches.body.approvals, []);
  } finally {
    await close();
  }
});

test("GET /approvals?status= returns matching rows beyond the old 200-cap-then-filter window", async () => {
  const store = new RecordingApprovalStore();
  const { baseUrl, close } = await startServer(store);
  try {
    const base = Date.now();
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "rejected", count: 220, baseMs: base });
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "pending_approval", count: 30, baseMs: base - 1_000_000 });

    const capThenFilter = (await store.listByOwner("test", 200)).filter(
      (r) => r.status === "pending_approval"
    );
    assert.equal(capThenFilter.length, 0, "precondition: the old cap-then-filter returned nothing");

    const res = await get(baseUrl, "/approvals?status=pending_approval&limit=200&offset=0");
    assert.equal(res.status, 200);
    assert.equal(res.body.approvals.length, 30);
    for (const a of res.body.approvals) assert.equal(a.status, "pending_approval");
    assert.equal(res.body.total, 30);
    assert.equal(res.body.truncated, false);
    assert.equal(res.body.hasMore, false);
  } finally {
    await close();
  }
});

test("GET /approvals?status= passes the status to the store-level owner query", async () => {
  const store = new RecordingApprovalStore();
  const { baseUrl, close } = await startServer(store);
  try {
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "approved", count: 2, baseMs: Date.now() });

    const res = await get(baseUrl, "/approvals?status=approved");
    assert.equal(res.status, 200);
    assert.deepEqual(store.listByOwnerCalls, [
      { ownerId: "test", limit: 50, offset: 0, status: "approved" },
    ]);
    assert.deepEqual(store.countByOwnerCalls, [{ ownerId: "test", status: "approved" }]);
    assert.equal(res.body.total, 2);
  } finally {
    await close();
  }
});

test("GET /approvals?status= keeps owner isolation", async () => {
  const store = new RecordingApprovalStore();
  const { baseUrl, close } = await startServer(store);
  try {
    const base = Date.now();
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "pending_approval", count: 2, baseMs: base });
    await seedApprovals(store, { ownerId: "someone-else", agentId: "other-agent", status: "pending_approval", count: 5, baseMs: base + 1000 });
    await seedApprovals(store, { ownerId: "someone-else", agentId: "other-agent", status: "approved", count: 4, baseMs: base + 2000 });

    const res = await get(baseUrl, "/approvals?status=pending_approval");
    assert.equal(res.status, 200);
    assert.equal(res.body.approvals.length, 2);
    assert.equal(res.body.total, 2);
    for (const a of res.body.approvals) assert.equal(a.ownerId, "test");
  } finally {
    await close();
  }
});

test("agent status filter pages over the filtered set with exact hasMore", async () => {
  const store = new RecordingApprovalStore();
  const { baseUrl, close } = await startServer(store);
  try {
    const base = Date.now();
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "pending_approval", count: 60, baseMs: base });
    await seedApprovals(store, { ownerId: "test", agentId: "test-agent", status: "approved", count: 120, baseMs: base + 10_000 });

    const page1 = await get(baseUrl, "/agents/test-agent/approvals?status=pending_approval&limit=50&offset=0");
    assert.equal(page1.status, 200);
    assert.equal(page1.body.approvals.length, 50);
    assert.equal(page1.body.hasMore, true);
    for (const a of page1.body.approvals) assert.equal(a.status, "pending_approval");

    const page2 = await get(baseUrl, "/agents/test-agent/approvals?status=pending_approval&limit=50&offset=50");
    assert.equal(page2.status, 200);
    assert.equal(page2.body.approvals.length, 10);
    assert.equal(page2.body.hasMore, false);
    for (const a of page2.body.approvals) assert.equal(a.status, "pending_approval");
  } finally {
    await close();
  }
});

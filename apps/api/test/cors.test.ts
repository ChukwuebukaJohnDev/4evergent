import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../src/index.js";
import { DevAuthProvider } from "@4evergent/shared";
import type { Signer } from "@4evergent/stellar";
import type { AddressInfo } from "node:net";

declare const fetch: typeof globalThis.fetch;

async function apiFetch(url: string, init?: RequestInit) {
  return fetch(url, { ...init, keepalive: false });
}

class MockSigner implements Signer {
  private id: string;
  constructor(id: string) {
    this.id = id.startsWith("G") ? id : `G${id.padEnd(55, "A").slice(0, 55)}`;
  }
  getAccountId(): string { return this.id; }
  getNetworkPassphrase(): string { return "Test SDF Network ; September 2015"; }
  async sign(transaction: any): Promise<any> {
    transaction.signatures = [{ hint: Buffer.from("mock"), signature: Buffer.from("sig") }];
    return transaction;
  }
}

const TEST_AGENT = {
  id: "test-agent",
  displayName: "Test Agent",
  description: "test agent",
  ownerId: "test",
  stellarAddress: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  capabilities: ["payment"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  active: true,
  status: "active" as const,
  metadata: {},
};

const ALLOWED_ORIGIN = "https://preview-4evergent.vercel.app";
const DISALLOWED_ORIGIN = "https://evil.example.com";

async function startServer() {
  process.env.CORS_ORIGIN = ALLOWED_ORIGIN;

  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner("test-agent"),
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
  });
  server.registerAgent(TEST_AGENT);

  return new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    const http = server.server.listen(0, "127.0.0.1", () => {
      const addr = http.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

function header(res: Response, name: string): string | null {
  return res.headers.get(name);
}

test("CORS: allowed origin receives Access-Control-Allow-Origin header", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await apiFetch(`${baseUrl}/health`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(res.status, 200);
    assert.equal(header(res, "access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(header(res, "vary"), "Origin");
  } finally {
    await close();
    delete process.env.CORS_ORIGIN;
  }
});

test("CORS: disallowed origin does not receive Access-Control-Allow-Origin header", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await apiFetch(`${baseUrl}/health`, {
      headers: { Origin: DISALLOWED_ORIGIN },
    });
    assert.equal(res.status, 200);
    assert.equal(header(res, "access-control-allow-origin"), null);
  } finally {
    await close();
    delete process.env.CORS_ORIGIN;
  }
});

test("CORS: OPTIONS preflight returns 204 with allowed methods and headers", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await apiFetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(res.status, 204);
    assert.equal(header(res, "access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(header(res, "access-control-allow-methods"), "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    assert.equal(header(res, "access-control-allow-headers"), "Authorization, Content-Type, Idempotency-Key, X-Requested-With");
    assert.equal(header(res, "vary"), "Origin");
  } finally {
    await close();
    delete process.env.CORS_ORIGIN;
  }
});

test("CORS: OPTIONS preflight for disallowed origin returns 204 without ACAO", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await apiFetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: { Origin: DISALLOWED_ORIGIN },
    });
    assert.equal(res.status, 204);
    assert.equal(header(res, "access-control-allow-origin"), null);
  } finally {
    await close();
    delete process.env.CORS_ORIGIN;
  }
});

test("CORS: Authorization header on actual request still authenticates", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // DevAuthProvider auto-authenticates, so listAgents should work
    const res = await apiFetch(`${baseUrl}/agents`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(res.status, 200);
    assert.equal(header(res, "access-control-allow-origin"), ALLOWED_ORIGIN);
    const body = await res.json();
    assert.ok(Array.isArray(body.agents));
  } finally {
    await close();
    delete process.env.CORS_ORIGIN;
  }
});

test("CORS: Idempotency-Key header is in allow-list", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await apiFetch(`${baseUrl}/agents`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        "Idempotency-Key": "test-key-123",
      },
      body: JSON.stringify({
        id: "new-agent",
        displayName: "New Agent",
        description: "test",
        stellarAddress: "GDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        capabilities: ["payment"],
      }),
    });
    assert.equal(header(res, "access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(res.status, 201);
  } finally {
    await close();
    delete process.env.CORS_ORIGIN;
  }
});

test("CORS: server without CORS_ORIGIN does not set ACAO header", async () => {
  delete process.env.CORS_ORIGIN;
  const server = await createApiServer({
    port: 0,
    horizonUrl: "https://horizon-testnet.stellar.org",
    signer: new MockSigner("no-cors"),
    authProvider: new DevAuthProvider({ defaultOwnerId: "test" }),
  });

  await new Promise<void>((resolve) => {
    server.server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.server.address() as AddressInfo;
  try {
    const res = await apiFetch(`http://127.0.0.1:${addr.port}/health`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(res.status, 200);
    assert.equal(header(res, "access-control-allow-origin"), null);
  } finally {
    await server.close();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ProductionApiKeyAuthProvider } from "../src/production-auth.js";

test("ProductionApiKeyAuthProvider: valid API key returns authenticated principal", async () => {
  const provider = new ProductionApiKeyAuthProvider({
    apiKeys: {
      "test-key-123": { ownerId: "owner-a", subject: "user-a" },
    },
  });

  const result = await provider.authenticate({
    headers: { authorization: "Bearer test-key-123" },
  });

  assert.ok(result);
  assert.equal(result!.ownerId, "owner-a");
  assert.equal(result!.subject, "user-a");
});

test("ProductionApiKeyAuthProvider: invalid API key returns null", async () => {
  const provider = new ProductionApiKeyAuthProvider({
    apiKeys: {
      "test-key-123": { ownerId: "owner-a", subject: "user-a" },
    },
  });

  const result = await provider.authenticate({
    headers: { authorization: "Bearer wrong-key" },
  });

  assert.equal(result, null);
});

test("ProductionApiKeyAuthProvider: missing Authorization header returns null", async () => {
  const provider = new ProductionApiKeyAuthProvider({
    apiKeys: {
      "test-key-123": { ownerId: "owner-a", subject: "user-a" },
    },
  });

  const result = await provider.authenticate({ headers: {} });

  assert.equal(result, null);
});

test("ProductionApiKeyAuthProvider: malformed Authorization header returns null", async () => {
  const provider = new ProductionApiKeyAuthProvider({
    apiKeys: {
      "test-key-123": { ownerId: "owner-a", subject: "user-a" },
    },
  });

  const result1 = await provider.authenticate({
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  });
  assert.equal(result1, null);

  const result2 = await provider.authenticate({
    headers: { authorization: "InvalidFormat test-key-123" },
  });
  assert.equal(result2, null);
});

test("ProductionApiKeyAuthProvider: multiple keys map to different owners", async () => {
  const provider = new ProductionApiKeyAuthProvider({
    apiKeys: {
      "key-a": { ownerId: "owner-a", subject: "user-a" },
      "key-b": { ownerId: "owner-b", subject: "user-b" },
    },
  });

  const resultA = await provider.authenticate({
    headers: { authorization: "Bearer key-a" },
  });
  const resultB = await provider.authenticate({
    headers: { authorization: "Bearer key-b" },
  });

  assert.equal(resultA!.ownerId, "owner-a");
  assert.equal(resultB!.ownerId, "owner-b");
});

test("ProductionApiKeyAuthProvider: client cannot override ownerId", async () => {
  const provider = new ProductionApiKeyAuthProvider({
    apiKeys: {
      "test-key": { ownerId: "real-owner", subject: "real-subject" },
    },
  });

  // Even if client sends extra headers, identity comes from validated key only
  const result = await provider.authenticate({
    headers: {
      authorization: "Bearer test-key",
      "x-owner-id": "fake-owner",
      "x-subject": "fake-subject",
    },
  });

  assert.equal(result!.ownerId, "real-owner");
  assert.equal(result!.subject, "real-subject");
});

test("ProductionApiKeyAuthProvider: empty API keys config returns null for all", async () => {
  const provider = new ProductionApiKeyAuthProvider({ apiKeys: {} });

  const result = await provider.authenticate({
    headers: { authorization: "Bearer any-key" },
  });

  assert.equal(result, null);
});

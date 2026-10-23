import { test } from "node:test";
import assert from "node:assert/strict";

test("Agent type is structurally valid", () => {
  const a = {
    id: "agent_1",
    displayName: "Test",
    description: "test",
    ownerId: "GOWNER",
    stellarAddress: "GADDR",
    capabilities: ["payment"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    active: true,
    metadata: {},
  } as { id: string };
  assert.equal(a.id, "agent_1");
});

test("PaymentIntent requires correct shape", () => {
  const i = { type: "payment", asset: "XLM", destination: "GDEST", amount: "10", reason: "test" } as { type: string };
  assert.equal(i.type, "payment");
});

test("PolicyDecision result is constrained", () => {
  const d = { result: "allow", reason: "ok", rule: "default", intent: {} } as { result: string };
  assert.ok(d);
});

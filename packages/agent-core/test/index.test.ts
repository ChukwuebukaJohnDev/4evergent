import { test } from "node:test";
import assert from "node:assert/strict";
import { IntentValidator } from "../src/index.js";
import type { AgentIntent } from "@4evergent/shared";

const mkPayment = (over: Partial<AgentIntent> = {}): AgentIntent =>
  ({ type: "payment", asset: "XLM", destination: "GABCDEF", amount: "10", reason: "test payment", ...over }) as AgentIntent;

test("valid payment passes validation", () => {
  const r = IntentValidator.validate(mkPayment());
  assert.equal(r.valid, true);
});

test("missing amount fails", () => {
  const r = IntentValidator.validate(mkPayment({ amount: "" }));
  assert.equal(r.valid, false);
  assert.match(r.error!, /amount/);
});

test("negative amount fails", () => {
  const r = IntentValidator.validate(mkPayment({ amount: "-1" }));
  assert.equal(r.valid, false);
});

test("zero amount fails", () => {
  const r = IntentValidator.validate(mkPayment({ amount: "0" }));
  assert.equal(r.valid, false);
});

test("invalid destination fails", () => {
  const r = IntentValidator.validate(mkPayment({ destination: "INVALID" }));
  assert.equal(r.valid, false);
  assert.match(r.error!, /Stellar/);
});

test("amount over global maximum fails", () => {
  const r = IntentValidator.validate(mkPayment({ amount: "9999999" }));
  assert.equal(r.valid, false);
  assert.match(r.error!, /maximum/);
});

test("unknown asset fails", () => {
  const r = IntentValidator.validate(mkPayment({ asset: "BTC" }));
  assert.equal(r.valid, false);
  assert.match(r.error!, /asset/);
});

test("empty reason fails", () => {
  const r = IntentValidator.validate(mkPayment({ reason: "ab" }));
  assert.equal(r.valid, false);
  assert.match(r.error!, /reason/);
});

test("valid trustline passes", () => {
  const r = IntentValidator.validate({
    type: "trustline",
    assetCode: "USDC",
    issuer: "GUSDC",
    limit: "100",
    reason: "need USDC",
  });
  assert.equal(r.valid, true);
});

test("contract_call requires contractId and function", () => {
  const r = IntentValidator.validate({
    type: "contract_call",
    contractId: "",
    function: "x",
    args: [],
    reason: "test",
  });
  assert.equal(r.valid, false);
  assert.match(r.error!, /contractId/);
});

test("unknown intent type fails", () => {
  const r = IntentValidator.validate({ type: "unknown" } as AgentIntent);
  assert.equal(r.valid, false);
  assert.match(r.error!, /Unknown/);
});

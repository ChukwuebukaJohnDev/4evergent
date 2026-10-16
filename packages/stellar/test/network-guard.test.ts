import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateStellarNetwork,
  isLiveSubmitEnabled,
  TESTNET_HORIZON_URL,
  TESTNET_PASSPHRASE,
} from "../src/network-guard.js";

const MAINNET_HORIZON_URL = "https://horizon.stellar.org";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

test("NETWORK GUARD: valid Testnet config accepted", () => {
  const result = validateStellarNetwork(TESTNET_HORIZON_URL, TESTNET_PASSPHRASE);
  assert.equal(result.valid, true);
  assert.equal((result as any).network, "testnet");
});

test("NETWORK GUARD: mainnet URL rejected", () => {
  const result = validateStellarNetwork(MAINNET_HORIZON_URL, MAINNET_PASSPHRASE);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /Mainnet execution is not supported/);
});

test("NETWORK GUARD: testnet URL + mainnet passphrase rejected", () => {
  const result = validateStellarNetwork(TESTNET_HORIZON_URL, MAINNET_PASSPHRASE);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /mismatch/i);
});

test("NETWORK GUARD: mainnet URL + testnet passphrase rejected", () => {
  const result = validateStellarNetwork(MAINNET_HORIZON_URL, TESTNET_PASSPHRASE);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /mismatch/i);
});

test("NETWORK GUARD: unknown URL rejected", () => {
  const result = validateStellarNetwork("https://horizon-custom.example.com", TESTNET_PASSPHRASE);
  assert.equal(result.valid, false);
  assert.match((result as any).reason, /Unknown or unsupported/);
});

test("NETWORK GUARD: trailing slash normalized", () => {
  const result = validateStellarNetwork(TESTNET_HORIZON_URL + "/", TESTNET_PASSPHRASE);
  assert.equal(result.valid, true);
});

test("LIVE_SUBMIT: disabled by default", () => {
  delete process.env.LIVE_SUBMIT;
  assert.equal(isLiveSubmitEnabled(), false);
});

test("LIVE_SUBMIT: disabled when set to 0", () => {
  process.env.LIVE_SUBMIT = "0";
  assert.equal(isLiveSubmitEnabled(), false);
});

test("LIVE_SUBMIT: enabled only when set to 1", () => {
  process.env.LIVE_SUBMIT = "1";
  assert.equal(isLiveSubmitEnabled(), true);
  delete process.env.LIVE_SUBMIT;
});

test("LIVE_SUBMIT: arbitrary value not enabled", () => {
  process.env.LIVE_SUBMIT = "true";
  assert.equal(isLiveSubmitEnabled(), false);
  delete process.env.LIVE_SUBMIT;
});

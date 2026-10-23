import { test } from "node:test";
import assert from "node:assert/strict";
import { StellarSubmitter } from "../src/submitter.js";
import type { Transaction } from "@stellar/stellar-sdk";

// Mock transaction with signature
function MockSignedTx(passphrase: string): Transaction {
  return {
    toEnvelope: () => ({
      v1: () => ({
        signatures: [{ hint: Buffer.from("mock"), signature: Buffer.from("sig") }],
      }),
    }),
    networkPassphrase: passphrase,
  } as unknown as Transaction;
}

// Mock transaction without signature
function MockUnsignedTx(passphrase: string): Transaction {
  return {
    toEnvelope: () => ({
      v1: () => ({
        signatures: [],
      }),
    }),
    networkPassphrase: passphrase,
  } as unknown as Transaction;
}

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";

test("LIVE_SUBMIT GATE: submission blocked without LIVE_SUBMIT=1", async () => {
  delete process.env.LIVE_SUBMIT;
  const submitter = new StellarSubmitter(TESTNET_HORIZON);
  const tx = MockSignedTx(TESTNET_PASSPHRASE);

  await assert.rejects(
    () => submitter.submit(tx, TESTNET_PASSPHRASE),
    /live submission is disabled/
  );
});

test("LIVE_SUBMIT GATE: submission blocked for mainnet", async () => {
  process.env.LIVE_SUBMIT = "1";
  const submitter = new StellarSubmitter("https://horizon.stellar.org");
  const tx = MockSignedTx("Public Global Stellar Network ; September 2015");

  await assert.rejects(
    () => submitter.submit(tx, "Public Global Stellar Network ; September 2015"),
    /Mainnet execution is not supported/
  );
  delete process.env.LIVE_SUBMIT;
});

test("LIVE_SUBMIT GATE: submission blocked for mismatched passphrase", async () => {
  process.env.LIVE_SUBMIT = "1";
  const submitter = new StellarSubmitter(TESTNET_HORIZON);
  const tx = MockSignedTx(TESTNET_PASSPHRASE);

  await assert.rejects(
    () => submitter.submit(tx, "Public Global Stellar Network ; September 2015"),
    /mismatch/
  );
  delete process.env.LIVE_SUBMIT;
});

test("LIVE_SUBMIT GATE: unsigned transaction blocked", async () => {
  process.env.LIVE_SUBMIT = "1";
  const submitter = new StellarSubmitter(TESTNET_HORIZON);
  const tx = MockUnsignedTx(TESTNET_PASSPHRASE);

  await assert.rejects(
    () => submitter.submit(tx, TESTNET_PASSPHRASE),
    /no signatures/
  );
  delete process.env.LIVE_SUBMIT;
});

test("NETWORK GUARD: submitter validates Testnet before submission", async () => {
  delete process.env.LIVE_SUBMIT;
  const submitter = new StellarSubmitter(TESTNET_HORIZON);
  const tx = MockSignedTx(TESTNET_PASSPHRASE);

  // Should fail at LIVE_SUBMIT gate before any network call
  await assert.rejects(
    () => submitter.submit(tx, TESTNET_PASSPHRASE),
    /live submission is disabled/
  );
});

test("SECRET LEAKAGE: error messages never contain secret material", async () => {
  delete process.env.LIVE_SUBMIT;
  const submitter = new StellarSubmitter(TESTNET_HORIZON);
  const tx = MockSignedTx(TESTNET_PASSPHRASE);

  try {
    await submitter.submit(tx, TESTNET_PASSPHRASE);
    assert.fail("Should have thrown");
  } catch (err: any) {
    // Error should not contain any secret-like patterns
    assert.ok(!/S[A-Z0-9]{50,}/.test(err.message), "Error should not contain secret key");
    assert.ok(!/secret|seed|private_key|mnemonic/i.test(err.message), "Error should not leak secret terms");
  }
});

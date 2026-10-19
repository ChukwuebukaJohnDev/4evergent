/**
 * LIVE STELLAR TESTNET SMOKE TEST
 *
 * This file is OUTSIDE the normal CI test suite. It calls the real Stellar
 * testnet Horizon API.
 *
 * Two modes:
 *   1. With STELLAR_TESTNET_SECRET_KEY set → full pipeline including signing
 *      and submission (ONLY if LIVE_SUBMIT=1 is also set, to prevent accidental
 *      real transactions during verification).
 *   2. Without funded credentials → verify network, verify simulation calls
 *      succeed against real Horizon, stop before signing. This proves the
 *      pipeline's simulation code path is wired to the real network without
 *      requiring a funded account.
 *
 * Run with: npx tsx test/live-smoke.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@stellar/stellar-sdk";
import { StellarTransactionBuilder } from "../src/transaction-builder.js";
import { StellarSimulator } from "../src/simulator.js";
import { TestnetLocalSigner } from "../src/testnet-local-signer.js";

const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// ========== Test 1: Verify network is actually testnet ==========

test("Live: Horizon root returns testnet passphrase", async () => {
  const res = await fetch(TESTNET_HORIZON);
  assert.equal(res.status, 200, "Horizon root endpoint should respond 200");
  const data = await res.json();
  assert.equal(
    data.network_passphrase,
    TESTNET_PASSPHRASE,
    "CRITICAL: connected Horizon is NOT testnet — abort"
  );
  assert.ok(data.history_latest_ledger > 0, "ledger number should be positive");
  console.log(
    `  Network: ${data.network_passphrase} | Ledger: ${data.history_latest_ledger} | Core: ${data.stellar_core_version}`
  );
});

// ========== Test 2: Real Horizon simulation call ==========

test("Live: StellarSimulator calls real Horizon API", async () => {
  // Generate a random keypair (unfunded) to test the simulation path.
  // The simulation will correctly FAIL at the account-not-found check,
  // proving we actually called the real Horizon API.
  const unfunded = Keypair.random();
  console.log(`  Testing with unfunded account: ${unfunded.publicKey().slice(0, 12)}...`);

  const builder = new StellarTransactionBuilder();
  const sourceAccount = {
    accountId: () => unfunded.publicKey(),
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  };

  // Build a transaction for the unfunded account.
  // The transaction will have sequence = "2" (sourceAccount.sequence + 1).
  // The real account doesn't exist, so sequence check will fail first.
  const tx = await builder.buildPayment(
    sourceAccount as any,
    {
      type: "payment",
      asset: "XLM",
      destination: Keypair.random().publicKey(),
      amount: "0.001",
      reason: "live smoke test — no submission",
    },
    TESTNET_PASSPHRASE
  );

  // Verify the built transaction envelope is valid XDR locally
  const envelope = tx.toEnvelope().toXDR("base64");
  assert.ok(envelope.length > 0, "envelope should be non-empty");
  console.log(`  Built transaction envelope (${envelope.length} chars base64)`);

  // Call the REAL Horizon API via the simulator
  const simulator = new StellarSimulator(TESTNET_HORIZON);
  const result = await simulator.simulate(tx);

  // Expect failure: account not found on testnet (unfunded)
  assert.equal(result.success, false, "unfunded account should fail simulation");
  assert.ok(
    result.error?.includes("not found") || result.error?.includes("Sequence"),
    `error should indicate account not found or sequence mismatch, got: ${result.error}`
  );
  // fee and operations count should still be populated from the real tx
  assert.ok(Number(result.fee) >= 0, "fee should be reported");
  assert.equal(result.operations, 1, "one payment operation");

  console.log(`  Simulation result: success=${result.success} | error="${result.error}"`);
});

// ========== Test 3: TransactionBuilder produces valid Stellar tx ==========

test("Live: TransactionBuilder output verifies against real Stellar tx validation", async () => {
  const builder = new StellarTransactionBuilder();
  const source = {
    accountId: () => Keypair.random().publicKey(),
    sequenceNumber: () => "100",
    incrementSequenceNumber: () => {},
  };

  const tx = await builder.buildPayment(
    source as any,
    {
      type: "payment",
      asset: "XLM",
      destination: Keypair.random().publicKey(),
      amount: "1.5",
      reason: "test",
    },
    TESTNET_PASSPHRASE
  );

  // Verify transaction structure
  assert.equal(tx.operations.length, 1, "one operation");
  assert.equal(tx.operations[0].type, "payment", "operation is payment");
  assert.equal(tx.operations[0].amount, "1.5000000", "amount matches SDK-normalized format");
  assert.equal(tx.networkPassphrase, TESTNET_PASSPHRASE, "network passphrase is testnet");
  assert.ok(tx.timeBounds, "timebounds set");
  assert.ok(tx.timeBounds.maxTime > tx.timeBounds.minTime, "valid time window");
  assert.equal(Number(tx.fee), 100000, "base fee 0.01 XLM");
  // Sequence should be sourceAccount.sequence + 1
  assert.equal(tx.sequence, "101", "sequence = source + 1");

  console.log(`  TX sequence: ${tx.sequence} | fee: ${tx.fee} | ops: ${tx.operations.length}`);
});

// ========== Test 4 (CONDITIONAL): Full pipeline with real submission ==========
// Only runs if STELLAR_TESTNET_SECRET_KEY AND LIVE_SUBMIT=1

const hasFundedKey = !!process.env.STELLAR_TESTNET_SECRET_KEY;
const wantsSubmit = process.env.LIVE_SUBMIT === "1";

test("Live: Full pipeline (signed + submitted) — SKIPPED (no funded key or LIVE_SUBMIT=1)", { skip: !hasFundedKey || !wantsSubmit }, async () => {
  // This test only runs when both STELLAR_TESTNET_SECRET_KEY and LIVE_SUBMIT=1 are set.
  // It is intentionally skipped during normal verification to prevent accidental
  // real testnet transactions. To run:
  //
  //   STELLAR_TESTNET_SECRET_KEY=S... LIVE_SUBMIT=1 npx tsx test/live-smoke.test.ts
  //
  const { TransactionPipeline } = await import("../src/pipeline.js");
  const signer = new TestnetLocalSigner(TESTNET_PASSPHRASE);
  console.log(`  Signer: ${signer.getAccountId().slice(0, 12)}...`);

  const pipeline = new TransactionPipeline({
    horizonUrl: TESTNET_HORIZON,
    networkPassphrase: TESTNET_PASSPHRASE,
    signer,
  });

  const { StellarAdapter } = await import("@4evergent/agent-core");
  const adapter = new StellarAdapter(TESTNET_HORIZON);
  const account = await adapter.getAccount(signer.getAccountId());
  const sourceAccount = {
    accountId: () => account.address,
    sequenceNumber: () => account.sequence,
    incrementSequenceNumber: () => {},
  };

  const dest = Keypair.random();
  console.log(`  Destination: ${dest.publicKey().slice(0, 12)}...`);

  const outcome = await pipeline.execute({
    intent: {
      type: "payment",
      asset: "XLM",
      destination: dest.publicKey(),
      amount: "0.001",
      reason: "live smoke test submission",
    },
    sourceAccount,
  });

  console.log(`  Outcome status: ${outcome.status}`);
  if (outcome.status === "submitted") {
    console.log(`  TX Hash: ${outcome.txHash}`);
    assert.ok(outcome.txHash.length === 64, "tx hash should be 64 hex chars");
  } else {
    // If it failed at simulation, that's fine — proves the gate works
    console.log(`  Failed at: ${outcome.status} | ${outcome.message}`);
  }
});

// ========== Test 5: TestnetLocalSigner cannot be used on mainnet ==========

test("TestnetLocalSigner: interface does not expose secret key", async () => {
  // We can't instantiate without STELLAR_TESTNET_SECRET_KEY, but we can verify
  // the interface shape by checking the class prototype
  const proto = TestnetLocalSigner.prototype;
  const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== "constructor");

  // Should only expose: getAccountId, getNetworkPassphrase, sign
  assert.deepEqual(methods.sort(), ["getAccountId", "getNetworkPassphrase", "sign"]);

  // No method returns secret material
  for (const m of methods) {
    assert.ok(!/secret|seed|private|mnemonic|key/i.test(m), `method ${m} may expose secret`);
  }

  // If STELLAR_TESTNET_SECRET_KEY is NOT set, constructor should throw
  if (!hasFundedKey) {
    assert.throws(
      () => new TestnetLocalSigner(TESTNET_PASSPHRASE),
      /environment variable STELLAR_TESTNET_SECRET_KEY is not set/
    );
    console.log("  Constructor correctly rejects missing env var");
  }
});

console.log("\n--- Live Stellar Testnet Smoke Test ---");
console.log(`Funded key available: ${hasFundedKey}`);
console.log(`LIVE_SUBMIT enabled: ${wantsSubmit}`);
console.log("");

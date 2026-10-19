/**
 * LIVE END-TO-END STELLAR TESTNET VALIDATION
 *
 * Proves the full execution path against the REAL Stellar Testnet:
 *
 *   intent → policy → authorization → construction → simulation
 *          → signing → submission → Horizon confirmation → reconciliation
 *
 * OUTSIDE the default `pnpm test` suite. This file is not matched by the
 * package test script (`tsx test/*.test.ts`) and makes real network calls.
 *
 * OPT-IN GATES (both required for real submission):
 *   STELLAR_TESTNET_SECRET_KEY=S...   funded TESTNET key (never committed)
 *   LIVE_SUBMIT=1                     explicit live submission enable
 *
 * Run:
 *   STELLAR_TESTNET_SECRET_KEY=S... LIVE_SUBMIT=1 \
 *     npx tsx test/live-e2e.ts
 *
 * Without LIVE_SUBMIT=1 the script runs the network/simulation preflight only
 * and stops BEFORE signing/submission.
 *
 * SECURITY:
 *   - The secret key is read ONLY from the environment variable.
 *   - It is never written to disk, logs, or output.
 *   - Network guard restricts execution to Testnet; Mainnet is rejected.
 *   - The destination is the signer's own account; no user-supplied recipient.
 */

import assert from "node:assert/strict";
import { StellarAdapter } from "@4evergent/agent-core";
import { InMemoryExecutionStore, type ExecutionRecord } from "@4evergent/database";
import {
  TransactionPipeline,
  TestnetLocalSigner,
  TransactionStatusReconciler,
  validateStellarNetwork,
  isLiveSubmitEnabled,
  TESTNET_HORIZON_URL,
  TESTNET_PASSPHRASE,
  type TransactionStatusProvider,
} from "../src/index.js";

/** Minimal Horizon status provider (same contract as the API server's). */
class HorizonStatusProvider implements TransactionStatusProvider {
  constructor(private horizonUrl: string) {}
  async getStatus(txHash: string) {
    try {
      const res = await fetch(`${this.horizonUrl}/transactions/${txHash}`);
      if (res.status === 404) return "not_found" as const;
      if (!res.ok) return "network_error" as const;
      const data = (await res.json()) as { successful?: boolean };
      if (data.successful === true) return "confirmed" as const;
      if (data.successful === false) return "failed" as const;
      return "network_error" as const;
    } catch {
      return "network_error" as const;
    }
  }
}

const HORIZON = TESTNET_HORIZON_URL;
const PASSPHRASE = TESTNET_PASSPHRASE;
/** Deliberately tiny amount. Testnet XLM has no value; this keeps state minimal. */
const AMOUNT = "0.001";

const report: Record<string, string> = {};

function record(key: string, value: string) {
  report[key] = value;
  console.log(`  ${key}: ${value}`);
}

async function main() {
  console.log("\n--- Live Stellar Testnet E2E ---");

  // ============================================================
  // STEP 1 — Network identity: prove we are on Testnet, not Mainnet
  // ============================================================
  const rootRes = await fetch(HORIZON);
  assert.equal(rootRes.status, 200, "Horizon root should respond 200");
  const root = (await rootRes.json()) as {
    network_passphrase: string;
    history_latest_ledger: number;
  };
  assert.equal(
    root.network_passphrase,
    PASSPHRASE,
    "CRITICAL: connected Horizon is NOT Testnet — aborting"
  );
  record("network", root.network_passphrase);
  record("horizon", HORIZON);
  record("ledger", String(root.history_latest_ledger));

  // ============================================================
  // STEP 2 — Network guard: Testnet accepted, Mainnet rejected
  // ============================================================
  const guard = validateStellarNetwork(HORIZON, PASSPHRASE);
  assert.equal(guard.valid, true, "network guard must accept Testnet");
  const mainnetGuard = validateStellarNetwork(
    "https://horizon.stellar.org",
    "Public Global Stellar Network ; September 2015"
  );
  assert.equal(mainnetGuard.valid, false, "network guard must reject Mainnet");
  record("network_guard", "testnet=accept, mainnet=reject");

  // ============================================================
  // STEP 3 — Signer (secret from env only; never printed)
  // ============================================================
  if (!process.env.STELLAR_TESTNET_SECRET_KEY) {
    console.log("\n  STELLAR_TESTNET_SECRET_KEY not set — preflight only, stopping.");
    record("signer", "NOT RUN (no funded key)");
    record("result", "PREFLIGHT ONLY");
    return;
  }

  const signer = new TestnetLocalSigner(PASSPHRASE);
  const accountId = signer.getAccountId();
  assert.equal(signer.getNetworkPassphrase(), PASSPHRASE, "signer must be testnet-bound");
  record("account", accountId);

  // ============================================================
  // STEP 4 — Source account from real Horizon
  // ============================================================
  const adapter = new StellarAdapter(HORIZON);
  const account = await adapter.getAccount(accountId);
  record("sequence", String(account.sequence));

  // ============================================================
  // STEP 5 — Destination = signer's own account (self-payment)
  // ============================================================
  // A payment to a brand-new unfunded account would fail the base-reserve
  // minimum (0.001 XLM < reserve). Paying the source account itself keeps the
  // transaction real (signed + submitted + confirmed on-chain) while avoiding
  // creation of extra accounts and any user-supplied recipient.
  const destinationPub = accountId;
  record("destination", destinationPub);

  // Policy explicitly allowlists this destination and caps the amount,
  // so the run exercises the policy allowlist gate as well as the pipeline.
  const pipeline = new TransactionPipeline({
    horizonUrl: HORIZON,
    networkPassphrase: PASSPHRASE,
    signer,
    policyRules: {
      maxTxAmount: { XLM: "1" },
      dailySpendingLimit: { XLM: "10" },
      allowedAssets: ["XLM"],
      allowedDestinations: [destinationPub],
      txTypeRestrictions: { payment: true, trustline: false, contract_call: false, account_settings: false },
      approvalThreshold: "1",
      requireHumanApprovalForAmountAbove: "1",
    },
  });

  const sourceAccount = {
    accountId: () => account.address,
    sequenceNumber: () => account.sequence,
    incrementSequenceNumber: () => {},
    agentId: "live-e2e-agent",
    ownerId: "live-e2e-owner",
  };

  // ============================================================
  // STEP 6 — Execute: intent → policy → construct → simulate → sign → submit
  // ============================================================
  if (!isLiveSubmitEnabled()) {
    console.log("\n  LIVE_SUBMIT != 1 — running up to the submission gate, stopping.");
  }

  const outcome = await pipeline.execute({
    intent: {
      type: "payment",
      asset: "XLM",
      destination: destinationPub,
      amount: AMOUNT,
      reason: "4evergent live e2e validation",
    },
    sourceAccount,
  });

  record("policy", outcome.policyDecision.result);
  record("simulation", outcome.simulationResult?.success ? "success" : "failed");
  record("outcome", outcome.status);

  if (outcome.status !== "submitted") {
    console.log(`\n  Stopped at: ${outcome.status} — ${outcome.message}`);
    record("submission", "NOT SUBMITTED");
    record("result", "FAIL");
    process.exitCode = 1;
    return;
  }

  const txHash = outcome.txHash!;
  assert.equal(txHash.length, 64, "tx hash must be 64 hex chars");
  record("tx_hash", txHash);
  record("submission", "submitted");

  // ============================================================
  // STEP 7 — Horizon confirmation
  // ============================================================
  let confirmed = false;
  let confirmedLedger = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${HORIZON}/transactions/${txHash}`);
    if (res.status === 200) {
      const data = (await res.json()) as { successful: boolean; ledger: number };
      if (data.successful === true) {
        confirmed = true;
        confirmedLedger = data.ledger;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(confirmed, true, "transaction must be confirmed on-chain");
  record("confirmation", `confirmed in ledger ${confirmedLedger}`);

  // ============================================================
  // STEP 8 — Reconciliation through the real reconciler + Horizon provider
  // ============================================================
  const store = new InMemoryExecutionStore();
  const now = new Date().toISOString();
  const execRecord: ExecutionRecord = {
    id: "live-e2e-execution",
    ownerId: "live-e2e-owner",
    agentId: "live-e2e-agent",
    approvalId: null,
    activityId: outcome.activityId ?? null,
    intent: {
      type: "payment",
      asset: "XLM",
      destination: destinationPub,
      amount: AMOUNT,
      reason: "4evergent live e2e validation",
    },
    status: "submitted",
    policyDecision: outcome.policyDecision,
    simulationResult: outcome.simulationResult,
    txHash,
    submittedHash: txHash,
    error: null,
    attempt: 0,
    nextRetryAt: null,
    startedAt: now,
    completedAt: null,
    errorClass: null,
    createdAt: now,
    updatedAt: now,
  };
  await store.record(execRecord);

  const reconciler = new TransactionStatusReconciler(
    store,
    new HorizonStatusProvider(HORIZON)
  );
  const reconResult = await reconciler.reconcile();
  const reconciled = await store.get(execRecord.id);

  assert.equal(reconResult.checked, 1, "reconciler must check the submitted execution");
  assert.equal(reconResult.confirmed, 1, "reconciler must confirm the execution");
  assert.equal(reconciled?.status, "confirmed", "execution record must move to confirmed");
  record("reconciliation", `submitted → ${reconciled?.status}`);

  record("result", "PASS");
  console.log("\n--- E2E PASS ---");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("\n--- E2E FAIL ---");
  console.error(err instanceof Error ? err.message : String(err));
  record("result", "FAIL");
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});

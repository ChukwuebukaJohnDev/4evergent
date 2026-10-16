import { Horizon, type Transaction } from "@stellar/stellar-sdk";
import { validateStellarNetwork, isLiveSubmitEnabled } from "./network-guard.js";

/**
 * Submitter — broadcasts a signed Stellar transaction to the network.
 *
 * SUBMISSION PRECONDITIONS (enforced by the pipeline, NOT by this class):
 *   1. Intent passed IntentValidator
 *   2. PolicyEngine returned allow (no approval required) or approved
 *   3. StellarSimulator.simulate() returned success
 *   4. The Signer signed the transaction
 *   5. This is the ONLY code path that calls submitTransaction()
 *   6. Network validation passed (Testnet only)
 *   7. LIVE_SUBMIT=1 is explicitly set
 *
 * SECURITY: This class performs no signing — it accepts an already-signed Transaction.
 */
export class StellarSubmitter {
  private server: Horizon.Server;
  private horizonUrl: string;

  constructor(horizonUrl: string) {
    this.horizonUrl = horizonUrl;
    this.server = new Horizon.Server(horizonUrl);
  }

  /**
   * Submits a signed transaction to the Stellar network.
   *
   * @param signedTransaction  A signed Transaction object (MUST be signed).
   * @param networkPassphrase The expected network passphrase (for validation).
   * @returns The transaction hash on success.
   * @throws Error if Horizon rejects the transaction or safety checks fail.
   */
  async submit(
    signedTransaction: Transaction,
    networkPassphrase: string
  ): Promise<{ hash: string; ledger: number }> {
    // Phase 21: Network safety guard — validate before any network call
    const validation = validateStellarNetwork(this.horizonUrl, networkPassphrase);
    if (!validation.valid) {
      throw new Error(`StellarSubmitter: network validation failed: ${validation.reason}`);
    }

    // Phase 21: Live submission gate — must be explicitly enabled
    if (!isLiveSubmitEnabled()) {
      throw new Error(
        "StellarSubmitter: live submission is disabled. Set LIVE_SUBMIT=1 to enable real Testnet submission."
      );
    }

    // Verify the transaction has at least one signature — this is a sanity
    // check; the real gate is the pipeline not calling submit() on unsigned
    // transactions.
    const envelope = signedTransaction.toEnvelope();
    const signatures = envelope.v1().signatures;

    if (signatures.length === 0) {
      throw new Error(
        "StellarSubmitter: transaction has no signatures — signing required before submission"
      );
    }

    try {
      const result = await this.server.submitTransaction(signedTransaction);
      return {
        hash: result.hash,
        ledger: result.ledger,
      };
    } catch (e: any) {
      // Horizon returns detailed error info on failure. We surface it so the
      // pipeline can record it and surface it to the operator.
      // SECURITY: Never include secret material in error messages.
      const detail = e?.response?.data?.detail ?? e?.message ?? "unknown submission error";
      throw new Error(`StellarSubmitter: submission failed: ${detail}`);
    }
  }
}

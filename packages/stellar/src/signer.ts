import type { Transaction } from "@stellar/stellar-sdk";

/**
 * Abstract signing interface.
 *
 * The pipeline NEVER depends on a concrete key store. A Signer implementation
 * is responsible for producing a signed transaction given an unsigned one.
 *
 * SECURITY CONTRACT
 * 1. sign() accepts an already-constructed, already-simulated Transaction object.
 *    It does NOT accept raw XDR or arbitrary operation arrays from callers.
 * 2. Implementations MUST NOT expose private key material through any method
 *    on this interface, through return values, or through error messages.
 * 3. Implementations MUST NOT log private keys, seeds, or mnemonics.
 * 4. Concrete signer selection is made at composition-root time (server boot),
 *    NEVER based on user-supplied input at request time.
 */
export interface Signer {
  /** Returns the public account ID this signer signs for. */
  getAccountId(): string;

  /** Returns the network passphrase this signer is bound to. */
  getNetworkPassphrase(): string;

  /**
   * Signs an unsigned Horizon Transaction object.
   * @throws Error if signing fails or the signer is misconfigured.
   */
  sign(transaction: Transaction): Promise<Transaction>;
}

/**
 * Metadata about a signer — safe to expose publicly; contains NO secret data.
 */
export interface SignerInfo {
  accountId: string;
  network: "testnet" | "mainnet";
  source: "env" | "user_wallet" | "permissioned_agent" | "hardware" | "kms";
}

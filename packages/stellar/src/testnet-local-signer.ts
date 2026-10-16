import { Keypair } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import type { Signer } from "./signer.js";

/**
 * TestnetLocalSigner — DEVELOPMENT INFRASTRUCTURE ONLY.
 *
 * NEVER use this in production. This class exists for local development and
 * automated tests against the Stellar TESTNET. It loads a Stellar secret key
 * from an environment variable and keeps it in memory for the process's lifetime.
 *
 * SECURITY GUARANTEES:
 * - The secret key is read ONLY from the environment variable
 *   `STELLAR_TESTNET_SECRET_KEY`.
 * - The secret key is NEVER written to disk, logs, API responses, or
 *   error messages.
 * - The secret key is NEVER exposed through the Signer interface — only the
 *   public account ID is available externally.
 * - The LLM / agent layer never receives a reference to this object. It is
 *   held by the pipeline, which is the only code path that invokes sign().
 *
 * FINAL WALLET ARCHITECTURE (not this class):
 * - UserWalletSigner   — user-custodied wallet signing (e.g. WalletConnect / xBull / Freighter)
 * - AgentPermissionSigner — scoped on-chain signer with an on-chain policy contract
 * - HardwareSigner / KmsSigner — hardware-backed or cloud-KMS-backed signing
 *
 * Those are interfaces today; they will be implemented when their
 * requirements are concrete. Do not build them prematurely.
 */
export class TestnetLocalSigner implements Signer {
  private readonly keypair: Keypair;
  private readonly networkPassphrase: string;

  /**
   * @param envVarName Environment variable holding the secret key. Defaults to
   *                   `STELLAR_TESTNET_SECRET_KEY`.
   */
  constructor(networkPassphrase: string, envVarName = "STELLAR_TESTNET_SECRET_KEY") {
    const secret = process.env[envVarName];
    if (!secret) {
      throw new Error(
        `TestnetLocalSigner: environment variable ${envVarName} is not set. ` +
          "Set it in your local .env (never commit it)."
      );
    }

    this.keypair = Keypair.fromSecret(secret.trim());
    this.networkPassphrase = networkPassphrase;
  }

  getAccountId(): string {
    return this.keypair.publicKey();
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  async sign(transaction: Transaction): Promise<Transaction> {
    if (transaction.networkPassphrase !== this.networkPassphrase) {
      throw new Error(
        "TestnetLocalSigner: transaction network passphrase does not match signer passphrase"
      );
    }
    transaction.sign(this.keypair);
    return transaction;
  }
}

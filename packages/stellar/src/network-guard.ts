/**
 * Stellar network safety guard.
 *
 * Only Testnet is supported for execution in Phase 21.
 * Mainnet execution is explicitly rejected.
 *
 * SECURITY: This module is the fail-closed gate for network configuration.
 * Any unknown/unsupported URL+passphrase combination is rejected.
 */

/** Known Testnet configuration (only supported execution network) */
export const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** Known Mainnet configuration (rejected for execution) */
const MAINNET_HORIZON_URL = "https://horizon.stellar.org";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export type NetworkValidationResult =
  | { valid: true; network: "testnet" }
  | { valid: false; network: "unknown"; reason: string };

/**
 * Validates that the provided Horizon URL and passphrase combination
 * is a known, supported network configuration.
 *
 * Rules:
 * - Testnet URL + Testnet passphrase → VALID (only supported network)
 * - Mainnet URL + Mainnet passphrase → REJECTED (mainnet execution not supported)
 * - Mismatched URL/passphrase → REJECTED
 * - Unknown URL → REJECTED
 */
export function validateStellarNetwork(
  horizonUrl: string,
  passphrase: string
): NetworkValidationResult {
  // Normalize URL (remove trailing slash)
  const normalizedUrl = horizonUrl.replace(/\/+$/, "");

  // Testnet: only supported execution network
  if (normalizedUrl === TESTNET_HORIZON_URL && passphrase === TESTNET_PASSPHRASE) {
    return { valid: true, network: "testnet" };
  }

  // Mainnet: explicitly rejected
  if (normalizedUrl === MAINNET_HORIZON_URL && passphrase === MAINNET_PASSPHRASE) {
    return {
      valid: false,
      network: "unknown",
      reason: "Mainnet execution is not supported. Only Stellar Testnet is allowed.",
    };
  }

  // Mismatched Testnet URL with Mainnet passphrase
  if (normalizedUrl === TESTNET_HORIZON_URL && passphrase === MAINNET_PASSPHRASE) {
    return {
      valid: false,
      network: "unknown",
      reason: "Network configuration mismatch: Testnet Horizon URL with Mainnet passphrase.",
    };
  }

  // Mismatched Mainnet URL with Testnet passphrase
  if (normalizedUrl === MAINNET_HORIZON_URL && passphrase === TESTNET_PASSPHRASE) {
    return {
      valid: false,
      network: "unknown",
      reason: "Network configuration mismatch: Mainnet Horizon URL with Testnet passphrase.",
    };
  }

  // Unknown/unsupported URL
  return {
    valid: false,
    network: "unknown",
    reason: `Unknown or unsupported Horizon URL: ${normalizedUrl}. Only Stellar Testnet (${TESTNET_HORIZON_URL}) is supported.`,
  };
}

/**
 * Checks if live submission is enabled via environment variable.
 *
 * LIVE_SUBMIT must be explicitly set to "1" to enable real submission.
 * Any other value (unset, "0", etc.) disables submission.
 */
export function isLiveSubmitEnabled(): boolean {
  return process.env.LIVE_SUBMIT === "1";
}

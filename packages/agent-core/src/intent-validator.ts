import type { AgentIntent } from "@4evergent/shared";

export class IntentValidator {
  static readonly VALID_ASSETS = ["XLM"];
  static readonly MAX_AMOUNT = "1000000";

  static validate(intent: AgentIntent): { valid: boolean; error?: string } {
    switch (intent.type) {
      case "payment":
        return validatePayment(intent);
      case "trustline":
        return validateTrustline(intent);
      case "contract_call":
        return validateContractCall(intent);
      case "account_settings":
        return validateAccountSettings(intent);
      default:
        return { valid: false, error: `Unknown intent type: ${(intent as { type: string }).type}` };
    }
  }
}

function parseAsset(intent: AgentIntent): { code: string; issuer: string | null } | null {
  if (intent.type !== "payment") return null;
  if (intent.assetDetails) {
    if (!intent.assetDetails.code || intent.assetDetails.code.length < 1) return null;
    if (intent.assetDetails.code === "XLM") {
      return { code: "XLM", issuer: null };
    }
    if (!intent.assetDetails.issuer || !intent.assetDetails.issuer.startsWith("G")) return null;
    return { code: intent.assetDetails.code, issuer: intent.assetDetails.issuer };
  }
  if (intent.asset === "XLM") return { code: "XLM", issuer: null };
  return null;
}

function validatePayment(intent: AgentIntent): { valid: boolean; error?: string } {
  if (intent.type !== "payment") return { valid: false, error: "not a payment" };
  if (!intent.amount || isNaN(parseFloat(intent.amount)) || parseFloat(intent.amount) <= 0) {
    return { valid: false, error: "amount must be a positive number" };
  }
  if (!intent.destination || !intent.destination.startsWith("G")) {
    return { valid: false, error: "destination must be a valid Stellar account (G...)" };
  }
  if (parseFloat(intent.amount) > parseFloat(IntentValidator.MAX_AMOUNT)) {
    return { valid: false, error: "amount exceeds global maximum" };
  }
  const asset = parseAsset(intent);
  if (!asset) {
    return { valid: false, error: "asset must be XLM or specify assetDetails with code + issuer" };
  }
  if (!intent.reason || intent.reason.length < 3) {
    return { valid: false, error: "reason must be at least 3 characters" };
  }
  return { valid: true };
}

function validateTrustline(intent: AgentIntent): { valid: boolean; error?: string } {
  if (intent.type !== "trustline") return { valid: false, error: "not a trustline" };
  if (!intent.assetCode || intent.assetCode.length < 1) {
    return { valid: false, error: "assetCode required" };
  }
  if (intent.assetCode === "XLM") {
    return { valid: false, error: "XLM is native and cannot be used as a trustline" };
  }
  if (!intent.issuer || !intent.issuer.startsWith("G")) {
    return { valid: false, error: "issuer must be a valid Stellar account" };
  }
  if (intent.limit !== undefined) {
    if (isNaN(parseFloat(intent.limit)) || parseFloat(intent.limit) < 0) {
      return { valid: false, error: "limit must be a non-negative number" };
    }
  }
  return { valid: true };
}

function validateContractCall(intent: AgentIntent): { valid: boolean; error?: string } {
  if (intent.type !== "contract_call") return { valid: false, error: "not a contract_call" };
  if (!intent.contractId || intent.contractId.length < 3) {
    return { valid: false, error: "contractId required" };
  }
  if (!intent.function || intent.function.length < 1) {
    return { valid: false, error: "function required" };
  }
  if (!intent.reason || intent.reason.length < 3) {
    return { valid: false, error: "reason required" };
  }
  return { valid: true };
}

function validateAccountSettings(intent: AgentIntent): { valid: boolean; error?: string } {
  if (intent.type !== "account_settings") return { valid: false, error: "not account_settings" };
  if (!intent.setting) {
    return { valid: false, error: "setting field required" };
  }
  return { valid: true };
}

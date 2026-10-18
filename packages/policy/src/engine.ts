import type { AgentIntent, PolicyDecision } from "@4evergent/shared";
import { type PolicyRules } from "./types.js";
import { normalizePolicyRules } from "./validation.js";

/**
 * PolicyEngine — deterministic, pure policy evaluation.
 *
 * SECURITY: Policy evaluation is the single gate that decides whether an
 * intent is allowed to proceed toward signing. It MUST be:
 *   - deterministic (same input → same output)
 *   - LLM-independent (no LLM involvement)
 *   - side-effect free EXCEPT for daily spending reservation (see below)
 *
 * The daily spending limit check requires reading persisted activity data
 * and atomically reserving the amount. For this reason, `evaluate()` is async.
 * An ActivityStore can be provided at construction time; without it, the
 * daily limit check is skipped.
 *
 * Phase 28J: Supports optional agent-scoped rule resolution via getRules callback.
 * When provided, evaluate() resolves rules per-agent before enforcement.
 * If getRules returns null/undefined, the defaultRules from construction are used.
 *
 * Phase 28J: `evaluateWithoutReservation()` performs policy checks without reserving
 * daily spending. Used by executeApproved() to re-evaluate current policy without
 * double-reserving (the reservation was already done at intent-creation time).
 */
export interface EvaluateOptions {
  /** Skip daily spending reservation (for re-evaluation in approve path). */
  skipReservation?: boolean;
}

export class PolicyEngine {
  private defaultRules: PolicyRules;
  private activityStore?: {
    listByAgent: (agentId: string, limit?: number) => Promise<ActivityRecord[]>;
    reserveDailySpending?: (agentId: string, asset: string, amount: string, limit: string) => Promise<boolean>;
  };
  private getRules?: (agentId: string) => Promise<PolicyRules | null>;

  constructor(
    rules?: Partial<PolicyRules>,
    activityStore?: {
      listByAgent: (agentId: string, limit?: number) => Promise<ActivityRecord[]>;
      reserveDailySpending?: (agentId: string, asset: string, amount: string, limit: string) => Promise<boolean>;
    },
    getRules?: (agentId: string) => Promise<PolicyRules | null>
  ) {
    this.defaultRules = normalizePolicyRules(rules ?? {});
    this.activityStore = activityStore;
    this.getRules = getRules;
  }

  /**
   * Evaluate an intent against the policy rules for the given agent.
   *
   * If a getRules callback was provided at construction, it is used to
   * resolve agent-specific rules (e.g., from persisted configuration).
   * If the callback returns null/undefined, the defaultRules from
   * construction are used as fallback.
   *
   * This method performs daily spending reservation when applicable.
   */
  async evaluate(intent: AgentIntent, agentId: string, options?: EvaluateOptions): Promise<PolicyDecision> {
    // Resolve rules: agent-specific if callback returns rules, otherwise fallback to defaultRules
    let rules = this.defaultRules;
    if (this.getRules) {
      const resolved = await this.getRules(agentId);
      if (resolved) {
        rules = resolved;
      }
    }
    return this.evaluateWithRules(intent, agentId, rules, options);
  }

  /**
   * Evaluate against a specific set of rules (internal).
   *
   * @param options.skipReservation — when true, daily spending limit is checked
   *   for denial but NOT reserved. Used by executeApproved to re-evaluate policy
   *   without double-reserving (reservation already occurred at intent creation).
   */
  private async evaluateWithRules(
    intent: AgentIntent,
    agentId: string,
    rules: PolicyRules,
    options?: EvaluateOptions
  ): Promise<PolicyDecision> {
    const decide = (
      result: PolicyDecision["result"],
      reason: string,
      rule: string
    ): PolicyDecision => ({
      result,
      reason,
      rule,
      intent,
    });

    // 0. Amount validation — reject zero, negative, or non-numeric
    const amountStr = extractAmount(intent);
    if (amountStr !== null) {
      const amountNum = parseFloat(amountStr);
      if (isNaN(amountNum)) {
        return decide("deny", `Invalid amount: '${amountStr}' is not a valid number`, "invalidAmount");
      }
      if (amountNum <= 0) {
        return decide("deny", `Amount must be positive, got ${amountNum}`, "positiveAmount");
      }
    }

    // 1. Transaction type restriction
    const typeAllowed = rules.txTypeRestrictions[intent.type];
    if (typeAllowed !== true) {
      return decide("deny", `Transaction type '${intent.type}' is not permitted`, "txTypeRestrictions");
    }

    const amount = extractAmount(intent);
    const asset = extractAsset(intent);

    // 2. Per-transaction max amount
    if (amount !== null) {
      const maxForAsset = rules.maxTxAmount[asset] ?? rules.maxTxAmount["native"];
      if (maxForAsset && compareAmounts(amount, maxForAsset) > 0) {
        return decide("deny", `Amount ${amount} ${asset} exceeds max_tx_amount ${maxForAsset}`, "maxTxAmount");
      }
    }

    // 3. Daily spending limit (requires persisted activity data)
    if (amountStr !== null && this.activityStore) {
      const dailyLimit = rules.dailySpendingLimit[asset] ?? rules.dailySpendingLimit["native"];
      if (dailyLimit) {
        if (options?.skipReservation) {
          // Skip reservation but still check the limit (read-only).
          // Used by executeApproved to verify tightened policy without double-reserving.
          const spent = await this.getDailySpent(asset, agentId);
          const limitNum = parseFloat(dailyLimit);
          const remaining = limitNum - spent;
          if (parseFloat(amountStr) > remaining) {
            return decide(
              "deny",
              `Amount ${amountStr} ${asset} exceeds daily limit: spent ${spent.toFixed(7)}, limit ${limitNum}, remaining ${remaining.toFixed(7)}`,
              "dailySpendingLimit"
            );
          }
        } else if (this.activityStore.reserveDailySpending) {
          const reserved = await this.activityStore.reserveDailySpending(
            agentId, asset, amountStr, dailyLimit
          );
          if (!reserved) {
            return decide(
              "deny",
              `Amount ${amountStr} ${asset} exceeds daily limit (atomically reserved failed)`,
              "dailySpendingLimit"
            );
          }
        } else {
          const spent = await this.getDailySpent(asset, agentId);
          const limitNum = parseFloat(dailyLimit);
          const remaining = limitNum - spent;
          if (parseFloat(amountStr) > remaining) {
            return decide(
              "deny",
              `Amount ${amountStr} ${asset} exceeds daily limit: spent ${spent.toFixed(7)}, limit ${limitNum}, remaining ${remaining.toFixed(7)}`,
              "dailySpendingLimit"
            );
          }
        }
      }
    }

    // 4. Approval threshold
    if (amount !== null) {
      const threshold = rules.requireHumanApprovalForAmountAbove;
      if (threshold && compareAmounts(amount, threshold) >= 0) {
        return decide("requires_approval", `Amount ${amount} ${asset} requires human approval (>= ${threshold})`, "approvalThreshold");
      }
    }

    // 5. Asset allowlist
    if (rules.allowedAssets.length > 0 && !rules.allowedAssets.includes(asset)) {
      return decide("deny", `Asset '${asset}' is not in allowed_assets`, "allowedAssets");
    }

    // 6. Destination allowlist (payments only)
    if (intent.type === "payment" && rules.allowedDestinations.length > 0) {
      if (!rules.allowedDestinations.includes(intent.destination)) {
        return decide("deny", `Destination '${intent.destination}' not in allowed_destinations`, "allowedDestinations");
      }
    }

    // 7. Contract ID allowlist (contract calls only)
    if (intent.type === "contract_call" && rules.allowedContractIds.length > 0) {
      if (!rules.allowedContractIds.includes(intent.contractId)) {
        return decide("deny", `Contract '${intent.contractId}' not in allowed list`, "allowedContractIds");
      }
    }

    return decide("allow", "All policy checks passed", "default");
  }

  /**
   * Calculates the total amount of `asset` spent by the agent today
   * (UTC day boundary), based on submitted activities.
   *
   * Only activities with status "submitted" are counted. Pending, rejected,
   * and failed activities do NOT count toward the daily limit.
   */
  private async getDailySpent(asset: string, agentId: string): Promise<number> {
    if (!this.activityStore) return 0;

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfDayIso = startOfDay.toISOString();

    const activities = await this.activityStore.listByAgent(agentId, 200);

    let total = 0;
    for (const activity of activities) {
      if (activity.status !== "submitted") continue;
      if (activity.createdAt < startOfDayIso) continue;
      const activityAsset = extractAsset(activity.intent);
      if (activityAsset !== asset) continue;
      const amount = extractAmount(activity.intent);
      if (amount !== null) {
        total += parseFloat(amount);
      }
    }

    return total;
  }
}

function extractAmount(intent: AgentIntent): string | null {
  if (intent.type === "payment") return intent.amount;
  if (intent.type === "trustline" && intent.limit) return intent.limit;
  return null;
}

function extractAsset(intent: AgentIntent): string {
  if (intent.type === "payment") {
    if (intent.assetDetails) {
      if (intent.assetDetails.code === "XLM") return "XLM";
      return `${intent.assetDetails.code}:${intent.assetDetails.issuer}`;
    }
    return intent.asset;
  }
  if (intent.type === "trustline") {
    return `trustline:${intent.assetCode}:${intent.issuer}`;
  }
  return "native";
}

function compareAmounts(a: string, b: string): number {
  const pa = parseFloat(a);
  const pb = parseFloat(b);
  if (isNaN(pa) || isNaN(pb)) return 0;
  return pa > pb ? 1 : pa < pb ? -1 : 0;
}

interface ActivityRecord {
  id: string;
  agentId: string;
  intent: AgentIntent;
  status: string;
  createdAt: string;
}

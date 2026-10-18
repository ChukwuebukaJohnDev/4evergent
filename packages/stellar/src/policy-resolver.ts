import type { PolicyRules } from "@4evergent/shared";

/**
 * PolicyResolver — resolves agent-scoped policy rules for a given agentId.
 *
 * This abstraction allows the pipeline to obtain per-agent policy configuration
 * without coupling to a specific storage implementation.
 *
 * SECURITY: The resolver MUST return agent-specific rules. Implementations
 * MUST NOT return rules belonging to a different agent.
 */
export type PolicyResolver = (agentId: string) => Promise<PolicyRules>;

/**
 * Creates a PolicyResolver from a PolicyConfigStore and fallback rules.
 *
 * - If agent has custom policy in store: returns that policy
 * - If agent has no custom policy: returns DEFAULT_RULES (safe fallback)
 * - Owner isolation is enforced by the store's getForOwner method
 */
export function createPolicyResolver(
  getPolicyForAgent: (agentId: string) => Promise<PolicyRules | null>,
  defaultRules: PolicyRules
): PolicyResolver {
  return async (agentId: string): Promise<PolicyRules> => {
    const custom = await getPolicyForAgent(agentId);
    return custom ?? defaultRules;
  };
}

import type { PolicyRules } from "@4evergent/shared";
import type { PolicyConfigStore } from "./index.js";

export interface PolicyConfigEntry {
  ownerId: string;
  rules: PolicyRules;
  version: number;
  updatedAt: string;
  createdAt: string;
}

/**
 * InMemoryPolicyConfigStore — process-local, agent-scoped policy configuration.
 *
 * Used for testing and development. Policy configs are lost on process exit.
 */
export class InMemoryPolicyConfigStore implements PolicyConfigStore {
  private configs = new Map<string, PolicyConfigEntry>();

  async get(agentId: string): Promise<PolicyRules | null> {
    const entry = this.configs.get(agentId);
    return entry ? entry.rules : null;
  }

  async getForOwner(agentId: string, ownerId: string): Promise<PolicyRules | null> {
    const entry = this.configs.get(agentId);
    if (!entry || entry.ownerId !== ownerId) return null;
    return entry.rules;
  }

  async getWithMetadata(agentId: string): Promise<{ rules: PolicyRules; version: number; updatedAt: string } | null> {
    const entry = this.configs.get(agentId);
    if (!entry) return null;
    return { rules: entry.rules, version: entry.version, updatedAt: entry.updatedAt };
  }

  async upsert(agentId: string, ownerId: string, rules: PolicyRules): Promise<{ rules: PolicyRules; version: number }> {
    const existing = this.configs.get(agentId);
    if (existing && existing.ownerId !== ownerId) {
      throw new Error(`Policy config for agent ${agentId} is owned by another user`);
    }
    const now = new Date().toISOString();
    const newVersion = existing ? existing.version + 1 : 1;
    this.configs.set(agentId, {
      ownerId,
      rules,
      version: newVersion,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    });
    return { rules, version: newVersion };
  }

  async delete(agentId: string): Promise<boolean> {
    return this.configs.delete(agentId);
  }

  async listByOwner(ownerId: string): Promise<Array<{ agentId: string; rules: PolicyRules }>> {
    const results: Array<{ agentId: string; rules: PolicyRules }> = [];
    for (const [agentId, entry] of this.configs.entries()) {
      if (entry.ownerId === ownerId) {
        results.push({ agentId, rules: entry.rules });
      }
    }
    return results;
  }
}

import type { Agent } from "@4evergent/shared";

export interface CreateAgentInput {
  id?: string;
  displayName: string;
  description?: string;
  capabilities?: string[];
  ownerId: string;
  stellarAddress?: string;
  status?: "active" | "paused" | "disabled";
}

export interface AgentStore {
  create(input: CreateAgentInput): Promise<Agent>;
  get(id: string): Promise<Agent | null>;
  getForOwner(id: string, ownerId: string): Promise<Agent | null>;
  listByOwner(ownerId: string, limit?: number): Promise<Agent[]>;
  listByCapability(ownerId: string, capability: string, limit?: number): Promise<Agent[]>;
  update(id: string, patch: Partial<Agent>): Promise<Agent | null>;
  delete(id: string): Promise<boolean>;
}

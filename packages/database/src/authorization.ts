import type { RequestContext, AuthorizationService } from '@4evergent/shared';
import type { ActivityStore, ApprovalStore, ScheduleStore, AgentStore } from './index.js';

export interface AuthorizationContext {
  activityStore: ActivityStore;
  approvalStore: ApprovalStore;
  scheduleStore: ScheduleStore;
  agents: Map<string, { id: string; ownerId: string }>;
  /**
   * Optional agent store for fallback lookups.
   *
   * PHASE 28I: When an agent is not found in the in-memory map (e.g., after
   * server restart with persistent storage), the service falls back to
   * looking up the agent from the store. This prevents authorization bypass
   * for agents created in previous sessions.
   */
  agentStore?: AgentStore;
}

export class ResourceAuthorizationService implements AuthorizationService {
  constructor(private ctx: AuthorizationContext) {}

  async canAccessAgent(ctx: RequestContext, agentId: string): Promise<boolean> {
    const agent = await this.resolveAgent(agentId);
    return agent?.ownerId === ctx.ownerId;
  }

  async canSubmitIntent(ctx: RequestContext, agentId: string): Promise<boolean> {
    return this.canAccessAgent(ctx, agentId);
  }

  async canAccessActivity(ctx: RequestContext, activityId: string): Promise<boolean> {
    const activity = await this.ctx.activityStore.get(activityId);
    if (!activity) return false;
    return this.canAccessAgent(ctx, activity.agentId);
  }

  async canAccessApproval(ctx: RequestContext, approvalId: string): Promise<boolean> {
    const approval = await this.ctx.approvalStore.get(approvalId);
    if (!approval) return false;
    return this.canAccessAgent(ctx, approval.agentId);
  }

  async canApprove(ctx: RequestContext, approvalId: string): Promise<boolean> {
    return this.canAccessApproval(ctx, approvalId);
  }

  async canReject(ctx: RequestContext, approvalId: string): Promise<boolean> {
    return this.canAccessApproval(ctx, approvalId);
  }

  async canChangeAgentStatus(ctx: RequestContext, agentId: string): Promise<boolean> {
    return this.canAccessAgent(ctx, agentId);
  }

  async canAccessSchedule(ctx: RequestContext, scheduleId: string): Promise<boolean> {
    const schedule = await this.ctx.scheduleStore.get(scheduleId);
    if (!schedule) return false;
    return schedule.ownerId === ctx.ownerId;
  }

  async canCreateSchedule(ctx: RequestContext, agentId: string): Promise<boolean> {
    return this.canAccessAgent(ctx, agentId);
  }

  async canUpdateSchedule(ctx: RequestContext, scheduleId: string): Promise<boolean> {
    return this.canAccessSchedule(ctx, scheduleId);
  }

  async canDeleteSchedule(ctx: RequestContext, scheduleId: string): Promise<boolean> {
    return this.canAccessSchedule(ctx, scheduleId);
  }

  async canPauseSchedule(ctx: RequestContext, scheduleId: string): Promise<boolean> {
    return this.canAccessSchedule(ctx, scheduleId);
  }

  async canResumeSchedule(ctx: RequestContext, scheduleId: string): Promise<boolean> {
    return this.canAccessSchedule(ctx, scheduleId);
  }

  async canDisableSchedule(ctx: RequestContext, scheduleId: string): Promise<boolean> {
    return this.canAccessSchedule(ctx, scheduleId);
  }

  /**
   * Resolve agent by ID with fallback to agent store.
   *
   * First checks the in-memory map (fast path). If not found, falls back
   * to the configured agent store (if any) for persistent agents.
   */
  private async resolveAgent(agentId: string): Promise<{ id: string; ownerId: string } | null> {
    const cached = this.ctx.agents.get(agentId);
    if (cached) return cached;

    if (this.ctx.agentStore) {
      const dbAgent = await this.ctx.agentStore.get(agentId);
      if (dbAgent) {
        const entry = { id: dbAgent.id, ownerId: dbAgent.ownerId };
        // Cache for subsequent lookups
        this.ctx.agents.set(agentId, entry);
        return entry;
      }
    }

    return null;
  }
}

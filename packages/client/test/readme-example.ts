import { ApiError, createClient } from "../dist/index.js";

export async function readmeExample(): Promise<void> {
  const client = createClient({
    baseUrl: "http://localhost:3000",
    token: process.env.FOUR_EVERGENT_API_KEY,
  });

  // Health
  const health = await client.health();

  // Agents
  const { agents } = await client.listAgents();
  const { agent } = await client.createAgent({ displayName: "Treasury agent" });
  const agentDetails = await client.getAgent(agent.id);
  await client.updateAgentStatus(agent.id, "paused");

  // Intents
  const result = await client.submitIntent(agent.id, {
    type: "payment",
    asset: "XLM",
    destination: "G...",
    amount: "1",
    reason: "Example payment",
  }, { idempotencyKey: "payment-2026-001" });

  // Approvals
  const { approvals } = await client.listApprovals({ status: "pending_approval" });
  if (approvals[0]) await client.approve(approvals[0].id);

  // Activity
  const { activity } = await client.listAgentActivity(agent.id, { limit: 25 });

  // Policy
  const currentPolicy = await client.getPolicy(agent.id);
  await client.updatePolicy(agent.id, { allowedAssets: ["XLM"] });

  // Schedules
  const { schedule } = await client.createSchedule(agent.id, {
    intent: {
      type: "payment",
      asset: "XLM",
      destination: "G...",
      amount: "1",
      reason: "Scheduled payment",
    },
    scheduleExpression: "0 9 * * *",
    timezone: "UTC",
  });
  await client.pauseSchedule(agent.id, schedule.id);

  // Executions and queue
  const executions = await client.listExecutions({ limit: 20 });
  const queue = await client.queueStatus();

  // Dashboard summaries
  const spending = await client.getAgentSpending(agent.id);
  const attention = await client.overviewAttention();

  try {
    await client.getAgent("missing-agent");
  } catch (error) {
    if (error instanceof ApiError) {
      console.error(error.status, error.message, error.details);
    }
  }

  void [health, agents, agentDetails, result, activity, currentPolicy, executions, queue, spending, attention];
}

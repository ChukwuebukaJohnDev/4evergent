# `@4evergent/client`

A dependency-free, typed TypeScript client for the 4evergent HTTP API. The
package is part of this private pnpm workspace and uses the built-in `fetch`
provided by Node.js 22 or newer.

## Install and import

Add the workspace package to another workspace package:

```json
{
  "dependencies": {
    "@4evergent/client": "workspace:*"
  }
}
```

Build the workspace package, then import the client:

```ts
import { createClient } from "@4evergent/client";

const client = createClient({
  baseUrl: "http://localhost:3000",
  token: process.env.FOUR_EVERGENT_API_KEY,
});
```

The bearer token is optional. `GET /health` is public; other routes require
the API's configured authentication. The client does not implement login.

## Examples by resource

```ts
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
```

All route arguments are URL-encoded. List methods accept optional `limit` and
`offset` values where supported by the API.

## Error handling

Non-2xx responses reject with `ApiError`, which carries the HTTP status and
parsed API response body. The message uses the API's `error` or `message` field;
`details` is available when the API includes it.

```ts
import { ApiError } from "@4evergent/client";

try {
  await client.getAgent("missing-agent");
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.status, error.message, error.details);
  }
}
```

See [the HTTP API reference](../../docs/api.md#typed-typescript-client) for the
route-to-method mapping.

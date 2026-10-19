/**
 * Declared command tree for the 4evergent Operator CLI.
 *
 * Single source of truth for:
 *   1. CLI dispatch routing and help text
 *   2. Shell completion generation (bash, zsh)
 *   3. Bidirectional dispatch-consistency test assertions
 */

export interface CommandArg {
  readonly name: string;
  readonly description?: string;
  readonly values?: readonly string[];
}

export interface SubcommandDef {
  readonly name: string;
  readonly description: string;
  readonly args?: readonly CommandArg[];
  readonly flags?: readonly string[];
}

export interface CommandDef {
  readonly name: string;
  readonly description: string;
  readonly subcommands?: Readonly<Record<string, SubcommandDef>>;
  readonly args?: readonly CommandArg[];
  readonly flags?: readonly string[];
}

export type CommandTree = Readonly<Record<string, CommandDef>>;

export const AGENT_STATUS_VALUES = ["active", "paused", "disabled"] as const;
export type AgentStatusValue = (typeof AGENT_STATUS_VALUES)[number];

export const INTENT_TYPES = ["payment", "trustline", "contract_call"] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export const SUPPORTED_SHELLS = ["bash", "zsh"] as const;
export type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

export const COMMAND_TREE: CommandTree = {
  health: {
    name: "health",
    description: "Check API health",
  },
  agent: {
    name: "agent",
    description: "Manage agents and their status",
    subcommands: {
      list: {
        name: "list",
        description: "List your agents",
      },
      get: {
        name: "get",
        description: "Show agent details",
        args: [{ name: "id", description: "Agent ID" }],
      },
      create: {
        name: "create",
        description: "Create a new agent",
        args: [
          { name: "name", description: "Agent display name" },
          { name: "description", description: "Agent description" },
          { name: "stellar-address", description: "Stellar G-address" },
          { name: "capabilities", description: "Agent capabilities" },
        ],
      },
      pause: {
        name: "pause",
        description: "Pause agent (rejects new intents)",
        args: [{ name: "id", description: "Agent ID" }],
      },
      resume: {
        name: "resume",
        description: "Resume agent (active)",
        args: [{ name: "id", description: "Agent ID" }],
      },
      disable: {
        name: "disable",
        description: "Disable agent",
        args: [{ name: "id", description: "Agent ID" }],
      },
      status: {
        name: "status",
        description: "Set agent status (active, paused, disabled)",
        args: [
          { name: "id", description: "Agent ID" },
          {
            name: "status",
            description: "Agent status value",
            values: AGENT_STATUS_VALUES,
          },
        ],
      },
    },
  },
  approval: {
    name: "approval",
    description: "Manage pending intent approvals",
    subcommands: {
      list: {
        name: "list",
        description: "List pending approvals",
      },
      get: {
        name: "get",
        description: "Show approval detail",
        args: [{ name: "id", description: "Approval ID" }],
      },
      approve: {
        name: "approve",
        description: "Approve an intent",
        args: [{ name: "id", description: "Approval ID" }],
      },
      reject: {
        name: "reject",
        description: "Reject an intent",
        args: [{ name: "id", description: "Approval ID" }],
      },
    },
  },
  execution: {
    name: "execution",
    description: "Manage executions across all agents",
    subcommands: {
      list: {
        name: "list",
        description: "List executions across all agents",
        args: [{ name: "limit", description: "Max executions to list" }],
      },
      get: {
        name: "get",
        description: "Show execution detail",
        args: [{ name: "id", description: "Execution ID" }],
      },
      retry: {
        name: "retry",
        description: "Retry a failed or dead-letter execution",
        args: [{ name: "id", description: "Execution ID" }],
      },
      cancel: {
        name: "cancel",
        description: "Cancel a queued or executing execution",
        args: [{ name: "id", description: "Execution ID" }],
      },
    },
  },
  policy: {
    name: "policy",
    description: "Manage agent policies",
    subcommands: {
      get: {
        name: "get",
        description: "Show effective policy rules",
        args: [{ name: "agent-id", description: "Agent ID" }],
      },
      update: {
        name: "update",
        description: "Update agent policy rules",
        args: [{ name: "agent-id", description: "Agent ID" }],
        flags: ["--rules"],
      },
    },
  },
  activity: {
    name: "activity",
    description: "Manage agent activity logs",
    subcommands: {
      list: {
        name: "list",
        description: "List agent activity",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "limit", description: "Limit (1-100, default 50)" },
        ],
      },
      get: {
        name: "get",
        description: "Show activity detail",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "activity-id", description: "Activity ID" },
        ],
      },
    },
  },
  schedule: {
    name: "schedule",
    description: "Manage recurring agent schedules",
    subcommands: {
      list: {
        name: "list",
        description: "List agent schedules",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "limit", description: "Limit (1-100, default 50)" },
        ],
      },
      get: {
        name: "get",
        description: "Show schedule detail",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "schedule-id", description: "Schedule ID" },
        ],
      },
      create: {
        name: "create",
        description: "Create a scheduled intent execution",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "expression", description: "Cron expression (5 fields)" },
          { name: "type", description: "Intent type", values: INTENT_TYPES },
        ],
      },
      update: {
        name: "update",
        description: "Update schedule expression",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "schedule-id", description: "Schedule ID" },
          { name: "expression", description: "New cron expression" },
        ],
      },
      pause: {
        name: "pause",
        description: "Pause a schedule",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "schedule-id", description: "Schedule ID" },
        ],
      },
      resume: {
        name: "resume",
        description: "Resume a paused schedule",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "schedule-id", description: "Schedule ID" },
        ],
      },
      disable: {
        name: "disable",
        description: "Disable a schedule permanently",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "schedule-id", description: "Schedule ID" },
        ],
      },
      delete: {
        name: "delete",
        description: "Delete a schedule",
        args: [
          { name: "agent-id", description: "Agent ID" },
          { name: "schedule-id", description: "Schedule ID" },
        ],
      },
    },
  },
  intent: {
    name: "intent",
    description: "Submit transactional intents",
    subcommands: {
      submit: {
        name: "submit",
        description: "Submit an intent (payment, trustline, contract_call)",
        args: [
          { name: "agent-id", description: "Agent ID" },
          {
            name: "type",
            description: "Intent type",
            values: INTENT_TYPES,
          },
        ],
        flags: ["--idempotency-key"],
      },
    },
  },
  completion: {
    name: "completion",
    description: "Generate shell completion script (bash, zsh)",
    subcommands: {
      bash: {
        name: "bash",
        description: "Generate Bash completion script",
      },
      zsh: {
        name: "zsh",
        description: "Generate Zsh completion script",
      },
    },
    args: [
      {
        name: "shell",
        description: "Target shell",
        values: SUPPORTED_SHELLS,
      },
    ],
  },
};

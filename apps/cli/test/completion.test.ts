/**
 * Shell completion tests for 4evergent Operator CLI.
 *
 * Verifies:
 *   1. Bidirectional consistency between declared COMMAND_TREE and CLI dispatcher
 *   2. Generated completion scripts for bash and zsh from COMMAND_TREE
 *   3. Fixed-value argument completions (agent status, intent types, shells)
 *   4. Offline generation without network or running API server
 *   5. Sourced completion script behavior in real Bash shell
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  COMMAND_TREE,
  AGENT_STATUS_VALUES,
  INTENT_TYPES,
  SUPPORTED_SHELLS,
} from "../src/commands.js";
import {
  generateBashCompletion,
  generateZshCompletion,
} from "../src/completion.js";

const _require = createRequire(import.meta.url);
const TSX_BIN = _require.resolve("tsx/cli");
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  requests: CapturedRequest[];
}

function run(
  args: string[],
  opts: {
    env?: Record<string, string>;
    responses?: Array<{ match: string; status: number; body: any }>;
    networkFail?: boolean;
  } = {}
): RunResult {
  const responses = opts.responses ?? [];
  const requestsPath = CLI.replace(/\.ts$/, ".mock-requests-comp.json");
  let prelude: string;

  if (opts.networkFail) {
    prelude = `
    globalThis.fetch = async () => {
      const err = new Error("connect ECONNREFUSED 127.0.0.1:9");
      (err as any).code = "ECONNREFUSED";
      throw err;
    };
  `;
  } else {
    prelude = `
    const responses = ${JSON.stringify(responses)};
    const requestsFile = ${JSON.stringify(requestsPath)};
    const captured = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const parsedUrl = new URL(u);
      const reqPath = parsedUrl.pathname + parsedUrl.search;
      const method = String(init?.method ?? "GET").toUpperCase();
      const headers = (init?.headers ?? {});
      const rawBody = typeof init?.body === "string" ? init.body : undefined;
      let parsedBody = rawBody;
      if (rawBody !== undefined) {
        try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; }
      }
      captured.push({ method, url: u, path: reqPath, headers, body: parsedBody });
      writeFileSync(requestsFile, JSON.stringify(captured));
      const hit = responses.find((r) => u.includes(r.match));
      if (!hit) return new Response(JSON.stringify({ error: "no mock for " + u }), { status: 500 });
      return new Response(JSON.stringify(hit.body), { status: hit.status });
    };
  `;
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    FOREGENT_API_URL: "http://mock:3000",
    ...opts.env,
  };

  const cliUrl = pathToFileURL(CLI).href;
  const wrapper = `
    import { writeFileSync } from "node:fs";
    ${prelude}
    await import(${JSON.stringify(cliUrl)});
  `;
  const wrapperPath = CLI.replace(/\.ts$/, ".mock-wrapper-comp.mts");
  rmSync(requestsPath, { force: true });
  writeFileSync(wrapperPath, wrapper);

  try {
    const r = spawnSync(process.execPath, [TSX_BIN, wrapperPath, ...args], {
      encoding: "utf-8",
      env,
      cwd: path.dirname(CLI),
      timeout: 30000,
    });
    let requests: CapturedRequest[] = [];
    try {
      requests = JSON.parse(readFileSync(requestsPath, "utf-8"));
    } catch {
      requests = [];
    }
    return {
      code: r.status ?? 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      requests,
    };
  } finally {
    rmSync(wrapperPath, { force: true });
    rmSync(requestsPath, { force: true });
  }
}

// ============================================================================
// 1. Bidirectional Consistency: Tree <-> Dispatcher
// ============================================================================

test("Tree and Dispatcher consistency: parse cli.ts switch cases and verify agreement", () => {
  const cliSource = readFileSync(CLI, "utf-8");

  // Extract the main command switch block: between `switch (cmd) {` and `case "--help":`
  const mainSwitchMatch = cliSource.match(/async function main[\s\S]*?switch\s*\(\s*cmd\s*\)\s*\{([\s\S]*?)\n\s*case "--help":/);
  assert.ok(mainSwitchMatch, "Must find switch (cmd) block in cli.ts");
  const mainSwitchBody = mainSwitchMatch[1]!;

  const topCases: string[] = [];
  const dispatchedTree: Record<string, string[]> = {};

  // Top-level cases are indented with 4 spaces in cli.ts main()
  const topCmdRegex = /\n {4}case "([^"]+)":([\s\S]*?)(?=(?:\n {4}case "|$))/g;
  let m: RegExpExecArray | null;

  while ((m = topCmdRegex.exec(mainSwitchBody)) !== null) {
    const cmdName = m[1]!;
    const block = m[2]!;
    topCases.push(cmdName);

    // Subcommand cases are indented with 8 spaces inside their respective sub-switch
    const subRegex = /\n {8}case "([^"]+)":/g;
    const subs: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = subRegex.exec(block)) !== null) {
      subs.push(sm[1]!);
    }
    dispatchedTree[cmdName] = subs;
  }

  // Direction 1: Every command in COMMAND_TREE appears in the dispatcher
  for (const [cmdName, cmdDef] of Object.entries(COMMAND_TREE)) {
    assert.ok(
      topCases.includes(cmdName),
      `Command '${cmdName}' from COMMAND_TREE must be dispatched in cli.ts main switch`
    );

    if (cmdDef.subcommands) {
      const dispatchedSubs = dispatchedTree[cmdName] ?? [];
      for (const subName of Object.keys(cmdDef.subcommands)) {
        assert.ok(
          dispatchedSubs.includes(subName),
          `Subcommand '${cmdName} ${subName}' from COMMAND_TREE must be dispatched in cli.ts sub-switch`
        );
      }
    }
  }

  // Direction 2: Every dispatched command in cli.ts appears in COMMAND_TREE
  for (const cmdName of topCases) {
    assert.ok(
      cmdName in COMMAND_TREE,
      `Dispatched command '${cmdName}' in cli.ts must exist in declared COMMAND_TREE`
    );

    const dispatchedSubs = dispatchedTree[cmdName] ?? [];
    const treeSubcommands = COMMAND_TREE[cmdName]?.subcommands ?? {};
    for (const subName of dispatchedSubs) {
      assert.ok(
        subName in treeSubcommands,
        `Dispatched subcommand '${cmdName} ${subName}' in cli.ts must exist in declared COMMAND_TREE`
      );
    }
  }
});

test("Dispatcher reachability: every command and subcommand in the tree reaches a real handler", () => {
  // Test that running each command does not exit with "Unknown command" or "Unknown subcommand"
  for (const [cmdName, cmdDef] of Object.entries(COMMAND_TREE)) {
    if (!cmdDef.subcommands) {
      // Top level command without subcommands (e.g. health)
      const r = run([cmdName], {
        responses: [{ match: "/health", status: 200, body: { status: "ok", signerAccountId: "GAAA" } }],
      });
      assert.doesNotMatch(r.stderr, new RegExp(`Unknown command: ${cmdName}`));
    } else {
      for (const subName of Object.keys(cmdDef.subcommands)) {
        // Run with mock responses so it doesn't fail on network if reached
        const r = run([cmdName, subName], {
          responses: [
            { match: "/", status: 200, body: { ok: true, agents: [], approvals: [], executions: [] } },
          ],
        });
        assert.doesNotMatch(r.stderr, new RegExp(`Unknown command: ${cmdName}`));
        assert.doesNotMatch(r.stderr, new RegExp(`Unknown ${cmdName} subcommand: ${subName}`));
      }
    }
  }
});

// ============================================================================
// 2. Shell Completion CLI Subcommand Invocations
// ============================================================================

test("CLI: 4evergent completion bash prints working bash script", () => {
  const r = run(["completion", "bash"], { networkFail: true });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.startsWith("# bash completion for 4evergent"));
  assert.ok(r.stdout.includes("complete -F _4evergent_completion 4evergent"));

  // Must contain all top-level commands from tree
  for (const cmd of Object.keys(COMMAND_TREE)) {
    assert.ok(r.stdout.includes(cmd), `Bash script must include top-level command '${cmd}'`);
  }

  // Must contain subcommands
  assert.ok(r.stdout.includes("pause resume disable status"));
  assert.ok(r.stdout.includes("approve reject"));

  // Must contain fixed-value arguments
  for (const status of AGENT_STATUS_VALUES) {
    assert.ok(r.stdout.includes(status), `Bash script must include status value '${status}'`);
  }
  for (const type of INTENT_TYPES) {
    assert.ok(r.stdout.includes(type), `Bash script must include intent type '${type}'`);
  }
  for (const shell of SUPPORTED_SHELLS) {
    assert.ok(r.stdout.includes(shell), `Bash script must include shell '${shell}'`);
  }
});

test("CLI: 4evergent completion zsh prints working zsh script", () => {
  const r = run(["completion", "zsh"], { networkFail: true });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "");
  assert.ok(r.stdout.startsWith("#compdef 4evergent"));
  assert.ok(r.stdout.includes("compdef _4evergent 4evergent"));

  // Must contain all top-level commands from tree
  for (const cmd of Object.keys(COMMAND_TREE)) {
    assert.ok(r.stdout.includes(cmd), `Zsh script must include top-level command '${cmd}'`);
  }

  // Must contain subcommands
  assert.ok(r.stdout.includes("pause:"));
  assert.ok(r.stdout.includes("resume:"));
  assert.ok(r.stdout.includes("disable:"));
  assert.ok(r.stdout.includes("status:"));
  assert.ok(r.stdout.includes("approve:"));
  assert.ok(r.stdout.includes("reject:"));

  // Must contain fixed-value arguments
  for (const status of AGENT_STATUS_VALUES) {
    assert.ok(r.stdout.includes(status), `Zsh script must include status value '${status}'`);
  }
  for (const type of INTENT_TYPES) {
    assert.ok(r.stdout.includes(type), `Zsh script must include intent type '${type}'`);
  }
  for (const shell of SUPPORTED_SHELLS) {
    assert.ok(r.stdout.includes(shell), `Zsh script must include shell '${shell}'`);
  }
});

test("CLI: completion script output matches generator functions directly", () => {
  const bashRes = run(["completion", "bash"]);
  assert.equal(bashRes.stdout, generateBashCompletion(COMMAND_TREE));

  const zshRes = run(["completion", "zsh"]);
  assert.equal(zshRes.stdout, generateZshCompletion(COMMAND_TREE));
});

test("CLI: completion without args prints usage and exits 1", () => {
  const r = run(["completion"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Usage: 4evergent completion <bash\|zsh>/);
});

test("CLI: completion with invalid shell reports error and exits 1", () => {
  const r = run(["completion", "fish"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unknown completion shell: fish/);
  assert.match(r.stderr, /Usage: 4evergent completion <bash\|zsh>/);
});

// ============================================================================
// 3. Agent Status Subcommand Dispatched Handling
// ============================================================================

test("CLI: agent status <id> <active|paused|disabled> dispatches PATCH with status", () => {
  for (const status of AGENT_STATUS_VALUES) {
    const r = run(["agent", "status", "agent-1", status], {
      responses: [
        {
          match: "/agents/agent-1/status",
          status: 200,
          body: { id: "agent-1", status },
        },
      ],
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`Agent agent-1 status: ${status}`));
    assert.equal(r.requests.length, 1);
    assert.equal(r.requests[0]?.method, "PATCH");
    assert.deepEqual(r.requests[0]?.body, { status });
  }
});

test("CLI: agent status missing status or invalid status shows usage", () => {
  const r1 = run(["agent", "status", "agent-1"]);
  assert.equal(r1.code, 1);
  assert.match(r1.stderr, /Usage: 4evergent agent status <id> <active\|paused\|disabled>/);

  const r2 = run(["agent", "status", "agent-1", "invalid-status"]);
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /Usage: 4evergent agent status <id> <active\|paused\|disabled>/);
});

// ============================================================================
// 4. Real Shell Completion Simulation (in Bash)
// ============================================================================

test("Real Bash completion: script executes correctly under bash", () => {
  const bashScript = generateBashCompletion(COMMAND_TREE);

  const bashTest = `
    ${bashScript}

    # 1. Top-level completion
    COMP_WORDS=(4evergent "")
    COMP_CWORD=1
    _4evergent_completion
    echo "TOP: \${COMPREPLY[*]}"

    # 2. Command prefix completion
    COMP_WORDS=(4evergent ag)
    COMP_CWORD=1
    _4evergent_completion
    echo "PREFIX: \${COMPREPLY[*]}"

    # 3. Subcommand completion
    COMP_WORDS=(4evergent agent "")
    COMP_CWORD=2
    _4evergent_completion
    echo "AGENT_SUBS: \${COMPREPLY[*]}"

    # 4. Status argument completion
    COMP_WORDS=(4evergent agent status agent-1 "")
    COMP_CWORD=4
    _4evergent_completion
    echo "AGENT_STATUS: \${COMPREPLY[*]}"

    # 5. Intent submit type completion
    COMP_WORDS=(4evergent intent submit agent-1 "")
    COMP_CWORD=4
    _4evergent_completion
    echo "INTENT_TYPES: \${COMPREPLY[*]}"

    # 6. Completion shell completion
    COMP_WORDS=(4evergent completion "")
    COMP_CWORD=2
    _4evergent_completion
    echo "SHELLS: \${COMPREPLY[*]}"
  `;

  const res = spawnSync("bash", ["-c", bashTest], { encoding: "utf-8" });
  assert.equal(res.status, 0, `Bash execution failed: ${res.stderr}`);

  assert.match(res.stdout, /TOP:.*health.*agent.*approval.*completion/);
  assert.match(res.stdout, /PREFIX: agent/);
  assert.match(res.stdout, /AGENT_SUBS:.*list.*get.*create.*pause.*resume.*disable.*status/);
  assert.match(res.stdout, /AGENT_STATUS: active paused disabled/);
  assert.match(res.stdout, /INTENT_TYPES: payment trustline contract_call/);
  assert.match(res.stdout, /SHELLS: bash zsh/);
});

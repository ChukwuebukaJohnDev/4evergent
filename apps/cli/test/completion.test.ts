/**
 * Shell completion tests for 4evergent Operator CLI.
 *
 * Verifies:
 *   1. Bidirectional consistency between declared COMMAND_TREE and CLI dispatcher
 *   2. Generated completion scripts for bash and zsh from COMMAND_TREE
 *   3. Fixed-value argument completions (intent types, shells)
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
  INTENT_TYPES,
  SUPPORTED_SHELLS,
  buildCommandTree,
  dispatchCommand,
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
// 1. Bidirectional Consistency: Declared Tree <-> Dispatcher Tree
// ============================================================================

test("Tree and Dispatcher consistency: verified across declared tree and dispatchCommand", async () => {
  const called: string[] = [];
  const mockHandlers = {
    health: () => { called.push("health"); return 0; },
    agent: {
      list: () => { called.push("agent.list"); return 0; },
      get: (args: string[]) => { called.push(`agent.get:${args.join(",")}`); return 0; },
      create: (args: string[]) => { called.push(`agent.create:${args.join(",")}`); return 0; },
      pause: (args: string[]) => { called.push(`agent.pause:${args.join(",")}`); return 0; },
      resume: (args: string[]) => { called.push(`agent.resume:${args.join(",")}`); return 0; },
      disable: (args: string[]) => { called.push(`agent.disable:${args.join(",")}`); return 0; },
    },
    approval: {
      list: () => { called.push("approval.list"); return 0; },
      get: (args: string[]) => { called.push(`approval.get:${args.join(",")}`); return 0; },
      approve: (args: string[]) => { called.push(`approval.approve:${args.join(",")}`); return 0; },
      reject: (args: string[]) => { called.push(`approval.reject:${args.join(",")}`); return 0; },
    },
    execution: {
      list: () => { called.push("execution.list"); return 0; },
      get: (args: string[]) => { called.push(`execution.get:${args.join(",")}`); return 0; },
      retry: (args: string[]) => { called.push(`execution.retry:${args.join(",")}`); return 0; },
      cancel: (args: string[]) => { called.push(`execution.cancel:${args.join(",")}`); return 0; },
    },
    policy: {
      get: (args: string[]) => { called.push(`policy.get:${args.join(",")}`); return 0; },
      update: (args: string[]) => { called.push(`policy.update:${args.join(",")}`); return 0; },
    },
    activity: {
      list: (args: string[]) => { called.push(`activity.list:${args.join(",")}`); return 0; },
      get: (args: string[]) => { called.push(`activity.get:${args.join(",")}`); return 0; },
    },
    schedule: {
      list: (args: string[]) => { called.push(`schedule.list:${args.join(",")}`); return 0; },
      get: (args: string[]) => { called.push(`schedule.get:${args.join(",")}`); return 0; },
      create: (args: string[]) => { called.push(`schedule.create:${args.join(",")}`); return 0; },
      update: (args: string[]) => { called.push(`schedule.update:${args.join(",")}`); return 0; },
      pause: (args: string[]) => { called.push(`schedule.pause:${args.join(",")}`); return 0; },
      resume: (args: string[]) => { called.push(`schedule.resume:${args.join(",")}`); return 0; },
      disable: (args: string[]) => { called.push(`schedule.disable:${args.join(",")}`); return 0; },
      delete: (args: string[]) => { called.push(`schedule.delete:${args.join(",")}`); return 0; },
    },
    intent: {
      submit: (args: string[]) => { called.push(`intent.submit:${args.join(",")}`); return 0; },
    },
    completion: {
      bash: () => { called.push("completion.bash"); return 0; },
      zsh: () => { called.push("completion.zsh"); return 0; },
    },
  };

  const tree = buildCommandTree(mockHandlers);

  // Direction 1: Every command in COMMAND_TREE exists in tree and has a working handler
  for (const [cmdName, cmdDef] of Object.entries(COMMAND_TREE)) {
    const handlerCmd = tree[cmdName];
    assert.ok(
      handlerCmd,
      `Command '${cmdName}' from COMMAND_TREE must exist in runtime tree`
    );

    if (cmdDef.subcommands) {
      assert.ok(
        handlerCmd.subcommands,
        `Command '${cmdName}' in runtime tree must have subcommands`
      );
      for (const subName of Object.keys(cmdDef.subcommands)) {
        const subDef = handlerCmd.subcommands[subName];
        assert.ok(
          subDef,
          `Subcommand '${cmdName} ${subName}' from COMMAND_TREE must exist in runtime tree`
        );
        assert.equal(
          typeof subDef.run,
          "function",
          `Subcommand '${cmdName} ${subName}' in runtime tree must have a run() handler`
        );

        // Verify dispatchCommand routes directly to this subcommand handler
        called.length = 0;
        const code = await dispatchCommand(tree, [cmdName, subName], { version: "1.0.0" });
        assert.equal(code, 0);
        assert.ok(called.length > 0, `dispatchCommand should route to '${cmdName} ${subName}'`);
      }
    } else {
      assert.equal(
        typeof handlerCmd.run,
        "function",
        `Top-level command '${cmdName}' in runtime tree must have a run() handler`
      );

      called.length = 0;
      const code = await dispatchCommand(tree, [cmdName], { version: "1.0.0" });
      assert.equal(code, 0);
      assert.ok(called.length > 0, `dispatchCommand should route to '${cmdName}'`);
    }
  }

  // Direction 2: Every command in runtime tree exists in declared COMMAND_TREE
  for (const [cmdName, handlerCmd] of Object.entries(tree)) {
    const treeCmd = COMMAND_TREE[cmdName];
    assert.ok(
      treeCmd,
      `Command '${cmdName}' in runtime tree must exist in declared COMMAND_TREE`
    );

    if (handlerCmd.subcommands) {
      assert.ok(
        treeCmd.subcommands,
        `Command '${cmdName}' in COMMAND_TREE must have subcommands`
      );
      for (const subName of Object.keys(handlerCmd.subcommands)) {
        assert.ok(
          subName in treeCmd.subcommands,
          `Subcommand '${cmdName} ${subName}' in runtime tree must exist in declared COMMAND_TREE`
        );
      }
    }
  }
});

test("Dispatcher reachability: every command and subcommand in the tree reaches a real handler", () => {
  for (const [cmdName, cmdDef] of Object.entries(COMMAND_TREE)) {
    if (!cmdDef.subcommands) {
      const r = run([cmdName], {
        responses: [{ match: "/health", status: 200, body: { status: "ok", signerAccountId: "GAAA" } }],
      });
      assert.doesNotMatch(r.stderr, new RegExp(`Unknown command: ${cmdName}`));
    } else {
      for (const subName of Object.keys(cmdDef.subcommands)) {
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
  assert.ok(r.stdout.includes("pause resume disable"));
  assert.ok(r.stdout.includes("approve reject"));

  // Must NOT contain unmaintained additions like agent status
  assert.ok(!r.stdout.includes("agent status"));

  // Must contain fixed-value arguments
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
  assert.ok(r.stdout.includes("approve:"));
  assert.ok(r.stdout.includes("reject:"));

  // Must NOT contain unmaintained additions like agent status
  assert.ok(!r.stdout.includes("status:Set agent status"));

  // Must contain fixed-value arguments
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
// 3. Real Shell Completion Simulation (in Bash)
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

    # 4. Intent submit type completion
    COMP_WORDS=(4evergent intent submit agent-1 "")
    COMP_CWORD=4
    _4evergent_completion
    echo "INTENT_TYPES: \${COMPREPLY[*]}"

    # 5. Completion shell completion
    COMP_WORDS=(4evergent completion "")
    COMP_CWORD=2
    _4evergent_completion
    echo "SHELLS: \${COMPREPLY[*]}"
  `;

  const res = spawnSync("bash", ["-c", bashTest], { encoding: "utf-8" });
  assert.equal(res.status, 0, `Bash execution failed: ${res.stderr}`);

  assert.match(res.stdout, /TOP:.*health.*agent.*approval.*completion/);
  assert.match(res.stdout, /PREFIX: agent/);
  assert.match(res.stdout, /AGENT_SUBS: list get create pause resume disable/);
  assert.ok(!res.stdout.includes("status"), "Must not complete agent status");
  assert.match(res.stdout, /INTENT_TYPES: payment trustline contract_call/);
  assert.match(res.stdout, /SHELLS: bash zsh/);
});

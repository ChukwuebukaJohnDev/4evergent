/**
 * Shell completion generator for the 4evergent Operator CLI.
 *
 * Emits working, non-placeholder completion scripts for bash and zsh,
 * driven directly from the declared command tree so the output cannot
 * drift from the dispatcher.
 */

import {
  COMMAND_TREE,
  type CommandTree,
} from "./commands.js";

function escapeZshDesc(desc: string): string {
  return desc.replace(/[':\\]/g, " ").trim();
}

/**
 * Generate a complete, working Bash completion script from the command tree.
 */
export function generateBashCompletion(tree: CommandTree = COMMAND_TREE): string {
  const topCommands = [
    ...Object.keys(tree),
    "--help",
    "-h",
    "--version",
    "-v",
  ].join(" ");

  const commandCases: string[] = [];

  for (const [cmdName, cmdDef] of Object.entries(tree)) {
    if (!cmdDef.subcommands) continue;

    const subList = Object.keys(cmdDef.subcommands).join(" ");
    const subCases: string[] = [];

    for (const [subName, subDef] of Object.entries(cmdDef.subcommands)) {
      const subConditions: string[] = [];

      // Flag completions
      if (subDef.flags && subDef.flags.length > 0) {
        const flagList = subDef.flags.join(" ");
        subConditions.push(
          `                    if [[ "\${cur}" == -* ]]; then\n` +
          `                        COMPREPLY=( $(compgen -W "${flagList}" -- "\${cur}") )\n` +
          `                        return 0\n` +
          `                    fi`
        );
      }

      // Argument completions with fixed values
      if (subDef.args) {
        subDef.args.forEach((arg, idx) => {
          if (arg.values && arg.values.length > 0) {
            // Words: 0=4evergent, 1=cmd, 2=sub, 3=arg0, 4=arg1...
            const argPosition = 3 + idx;
            const valList = arg.values.join(" ");
            subConditions.push(
              `                    if [[ \${cword} -eq ${argPosition} ]]; then\n` +
              `                        COMPREPLY=( $(compgen -W "${valList}" -- "\${cur}") )\n` +
              `                        return 0\n` +
              `                    fi`
            );
          }
        });
      }

      if (subConditions.length > 0) {
        subCases.push(
          `                ${subName})\n` +
          subConditions.join("\n") + "\n" +
          `                    ;;`
        );
      }
    }

    let cmdBlock =
      `        ${cmdName})\n` +
      `            if [[ \${cword} -eq 2 ]]; then\n` +
      `                COMPREPLY=( $(compgen -W "${subList}" -- "\${cur}") )\n` +
      `                return 0\n` +
      `            fi`;

    if (subCases.length > 0) {
      cmdBlock +=
        `\n` +
        `            local sub="\${COMP_WORDS[2]}"\n` +
        `            case "\${sub}" in\n` +
        subCases.join("\n") + "\n" +
        `            esac\n` +
        `            ;;`;
    } else {
      cmdBlock += `\n            ;;`;
    }

    commandCases.push(cmdBlock);
  }

  return `# bash completion for 4evergent
_4evergent_completion() {
    local cur prev cword
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    cword=\${COMP_CWORD}

    local top_commands="${topCommands}"

    if [[ \${cword} -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "\${top_commands}" -- "\${cur}") )
        return 0
    fi

    local cmd="\${COMP_WORDS[1]}"

    case "\${cmd}" in
${commandCases.join("\n")}
    esac

    return 0
}

complete -F _4evergent_completion 4evergent
`;
}

/**
 * Generate a complete, working Zsh completion script from the command tree.
 */
export function generateZshCompletion(tree: CommandTree = COMMAND_TREE): string {
  const topList: string[] = [];

  for (const [name, def] of Object.entries(tree)) {
    topList.push(`        '${name}:${escapeZshDesc(def.description)}'`);
  }
  topList.push(`        '--version:Print the CLI package version'`);
  topList.push(`        '--help:Show help for commands'`);

  const subCases: string[] = [];
  const argCases: string[] = [];

  for (const [cmdName, cmdDef] of Object.entries(tree)) {
    if (!cmdDef.subcommands) continue;

    const items = Object.entries(cmdDef.subcommands).map(
      ([subName, subDef]) =>
        `                    '${subName}:${escapeZshDesc(subDef.description)}'`
    );

    subCases.push(
      `            ${cmdName})\n` +
      `                local -a subcommands=(\n` +
      items.join("\n") + "\n" +
      `                )\n` +
      `                _describe 'subcommand' subcommands\n` +
      `                ;;`
    );

    const subArgCases: string[] = [];
    for (const [subName, subDef] of Object.entries(cmdDef.subcommands)) {
      const branches: string[] = [];

      // Value completions
      if (subDef.args) {
        subDef.args.forEach((arg, idx) => {
          if (arg.values && arg.values.length > 0) {
            // In zsh $words array: 1=4evergent, 2=cmd, 3=sub, 4=arg0, 5=arg1...
            const zshPosition = 4 + idx;
            const valItems = arg.values.map(
              (v) => `                                '${v}:${v}'`
            );
            branches.push(
              `                            if (( CURRENT == ${zshPosition} )); then\n` +
              `                                local -a vals=(\n` +
              valItems.join("\n") + "\n" +
              `                                )\n` +
              `                                _describe '${arg.name}' vals\n` +
              `                            fi`
            );
          }
        });
      }

      // Flag completions
      if (subDef.flags && subDef.flags.length > 0) {
        const flagSpecs = subDef.flags.map(
          (f) => `'${f}[${f} option]:value:'`
        );
        branches.push(
          `                            _arguments \\\n` +
          flagSpecs.map((spec) => `                                ${spec}`).join(" \\\n")
        );
      }

      if (branches.length > 0) {
        subArgCases.push(
          `                    ${subName})\n` +
          branches.join("\n") + "\n" +
          `                        ;;`
        );
      }
    }

    if (subArgCases.length > 0) {
      argCases.push(
        `            ${cmdName})\n` +
        `                case $words[3] in\n` +
        subArgCases.join("\n") + "\n" +
        `                esac\n` +
        `                ;;`
      );
    }
  }

  return `#compdef 4evergent

_4evergent() {
    local curcontext="$curcontext" state line
    typeset -A opt_args

    _arguments -C \\
        '1: :->command' \\
        '2: :->subcommand' \\
        '*:: :->args'

    case $state in
        command)
            local -a commands=(
${topList.join("\n")}
            )
            _describe 'command' commands
            ;;
        subcommand)
            case $words[2] in
${subCases.join("\n")}
            esac
            ;;
        args)
            case $words[2] in
${argCases.join("\n")}
            esac
            ;;
    esac
}

if type compdef >/dev/null 2>&1; then
    compdef _4evergent 4evergent
fi
`;
}

/**
 * Generate completion script for specified shell.
 */
export function generateCompletion(
  shell: "bash" | "zsh",
  tree: CommandTree = COMMAND_TREE
): string {
  if (shell === "bash") {
    return generateBashCompletion(tree);
  }
  if (shell === "zsh") {
    return generateZshCompletion(tree);
  }
  throw new Error(`Unsupported shell: ${shell}`);
}

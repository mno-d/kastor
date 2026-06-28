import { gitDiff, gitStatus, type GitDiffResult, type GitStatusResult } from "./codex-tools.js";

export type RuleEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "UserPromptSubmit";

export type RuleDecision = "allow" | "warn" | "block";

export interface RuleCheckInput {
  event: RuleEvent;
  toolName?: string;
  command?: string;
  summary?: string;
  checksPassed?: boolean;
  reviewed?: boolean;
  userApproved?: boolean;
}

export interface RuleGate {
  name: string;
  decision: RuleDecision;
  detail: string;
}

export interface RuleCheckResult {
  result: string;
  decision: RuleDecision;
  gates: RuleGate[];
  instructions: string[];
  gitStatus: GitStatusResult;
  diffStat: GitDiffResult;
}

export async function ruleCheck(input: RuleCheckInput, context: {
  cwd: string;
  root: string;
}): Promise<RuleCheckResult> {
  const git = await gitStatus({}, context);
  const diff = await gitDiff({ stat: true }, context);
  const gates = buildGates(input, git, diff);
  const decision = mostRestrictive(gates);
  const instructions = buildInstructions(input, decision);

  return {
    result: formatRuleCheck(input, decision, gates, instructions, git, diff),
    decision,
    gates,
    instructions,
    gitStatus: git,
    diffStat: diff,
  };
}

function buildGates(
  input: RuleCheckInput,
  git: GitStatusResult,
  diff: GitDiffResult,
): RuleGate[] {
  const gates: RuleGate[] = [
    {
      name: "event_supported",
      decision: "allow",
      detail: `Evaluating ${input.event} as a Kastor rule-check event.`,
    },
  ];

  if (input.event === "UserPromptSubmit") {
    gates.push(secretGate(input.summary ?? ""));
  }

  if (input.event === "PreToolUse") {
    gates.push(...preToolUseGates(input));
  }

  if (input.event === "PostToolUse") {
    gates.push(...postToolUseGates(input, git));
  }

  if (input.event === "Stop") {
    gates.push(...stopGates(input, git, diff));
  }

  return gates;
}

function preToolUseGates(input: RuleCheckInput): RuleGate[] {
  const tool = normalizeTool(input.toolName);
  const command = input.command ?? "";
  const gates: RuleGate[] = [];

  if (tool === "bash" || tool === "run_shell") {
    if (!command.trim()) {
      gates.push({
        name: "shell_command_present",
        decision: "block",
        detail: "Shell rule checks require the command text.",
      });
      return gates;
    }

    if (looksLikeShellWrite(command)) {
      gates.push({
        name: "shell_write_guard",
        decision: "block",
        detail: "Do not create or modify files with shell commands; use edit, write, or apply_patch.",
      });
    }

    if (looksDestructive(command)) {
      gates.push({
        name: "destructive_command_guard",
        decision: input.userApproved ? "warn" : "block",
        detail: input.userApproved
          ? "Destructive-looking command was explicitly approved; inspect scope before running."
          : "Destructive-looking command requires explicit user approval and a safer scoped alternative.",
      });
    }

    if (looksBroadScan(command)) {
      gates.push({
        name: "broad_scan_guard",
        decision: "warn",
        detail: "Avoid broad recursive scans; narrow the path or pattern first.",
      });
    }

    if (gates.length === 0) {
      gates.push({
        name: "bounded_shell",
        decision: "allow",
        detail: "Shell command looks read-only and bounded.",
      });
    }
  } else if (tool === "write" || tool === "write_file" || tool === "edit" || tool === "edit_file" || tool === "apply_patch") {
    gates.push({
      name: "file_change_tool",
      decision: "allow",
      detail: "File change tool is appropriate; inspect diff and run focused checks after editing.",
    });
  } else {
    gates.push({
      name: "tool_scope",
      decision: "allow",
      detail: input.toolName ? `No special rule matched ${input.toolName}.` : "No tool name was provided.",
    });
  }

  return gates;
}

function postToolUseGates(input: RuleCheckInput, git: GitStatusResult): RuleGate[] {
  const tool = normalizeTool(input.toolName);
  if (tool === "write" || tool === "write_file" || tool === "edit" || tool === "edit_file" || tool === "apply_patch") {
    return [
      {
        name: "post_edit_review",
        decision: git.clean ? "allow" : "warn",
        detail: git.clean
          ? "No local diff detected after the edit."
          : "Local changes exist; inspect git_diff and run focused checks before final handoff.",
      },
    ];
  }

  return [
    {
      name: "post_tool_scope",
      decision: "allow",
      detail: input.toolName ? `No post-tool rule matched ${input.toolName}.` : "No tool name was provided.",
    },
  ];
}

function stopGates(input: RuleCheckInput, git: GitStatusResult, diff: GitDiffResult): RuleGate[] {
  const gates: RuleGate[] = [];
  const hasDiff = Boolean(diff.diff.trim());

  if (input.checksPassed === false) {
    gates.push({
      name: "checks_failed",
      decision: "block",
      detail: "Checks are known to be failing; do not claim completion.",
    });
  } else if (!git.clean && input.checksPassed !== true) {
    gates.push({
      name: "checks_missing",
      decision: "warn",
      detail: "There are local changes and no positive check result was provided.",
    });
  } else {
    gates.push({
      name: "checks_state",
      decision: "allow",
      detail: input.checksPassed ? "Checks were reported as passing." : "No checks required for a clean handoff.",
    });
  }

  if (hasDiff && !input.reviewed) {
    gates.push({
      name: "review_missing",
      decision: "warn",
      detail: "A diff is present but no review/checkpoint evidence was provided.",
    });
  } else {
    gates.push({
      name: "review_state",
      decision: "allow",
      detail: hasDiff ? "Review evidence was provided." : "No diff needs review.",
    });
  }

  return gates;
}

function secretGate(text: string): RuleGate {
  if (/(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/.test(text)) {
    return {
      name: "secret_prompt_guard",
      decision: "block",
      detail: "Prompt appears to include an API token or secret; remove it before continuing.",
    };
  }

  return {
    name: "secret_prompt_guard",
    decision: "allow",
    detail: "No obvious API token pattern detected in the submitted prompt summary.",
  };
}

function looksLikeShellWrite(command: string): boolean {
  return /(^|[\s;&|])(?:tee|sed\s+-i|perl\s+-i)\b/i.test(command)
    || /(?:^|[\s;&|])(?:cat|echo|printf)\b[\s\S]*(?:>|>>|2>|&>)/i.test(command)
    || /(?:>|>>|<\s*<|<<)/.test(command)
    || /\b(?:python|python3|node|ruby)\b\s+(?:-e|-c)\b[\s\S]*\b(?:writeFile|writeFileSync|open\(|Path\(|Set-Content|Add-Content)\b/i.test(command)
    || /\b(?:New-Item|Set-Content|Add-Content|Out-File)\b/i.test(command);
}

function looksDestructive(command: string): boolean {
  return /\b(?:rm|del|erase)\b[\s\S]*(?:-rf|-fr|\/s|\/q)/i.test(command)
    || /\bRemove-Item\b[\s\S]*\b-Recurse\b/i.test(command)
    || /\bgit\s+(?:reset\s+--hard|checkout\s+--|clean\s+-fd)\b/i.test(command)
    || /\b(?:format|diskpart)\b/i.test(command);
}

function looksBroadScan(command: string): boolean {
  return /\b(?:rg|grep|find|Get-ChildItem|dir)\b[\s\S]*(?:\bC:\\Users\\|\$HOME|~|\/home|\/)\b/i.test(command)
    && !/\b(?:--max-count|--max-depth|-maxdepth|Select-Object\s+-First)\b/i.test(command);
}

function mostRestrictive(gates: RuleGate[]): RuleDecision {
  if (gates.some((gate) => gate.decision === "block")) return "block";
  if (gates.some((gate) => gate.decision === "warn")) return "warn";
  return "allow";
}

function buildInstructions(input: RuleCheckInput, decision: RuleDecision): string[] {
  const base = [
    "Use this as a Codex-style hook/rule gate before continuing the ChatGPT or MCP-hosted workflow.",
    "If decision=block, change approach before using the requested tool or claiming completion.",
    "If decision=warn, continue only after recording the risk and running the suggested focused check.",
  ];

  if (input.event === "PreToolUse") {
    base.push("For shell commands, prefer dedicated Kastor tools and keep any remaining shell command short, read-only, and bounded.");
  }
  if (input.event === "Stop") {
    base.push("Before final handoff, cite the checks, diff review, and any remaining risks.");
  }
  if (decision === "allow") {
    base.push("No blocking rule matched.");
  }

  return base;
}

function formatRuleCheck(
  input: RuleCheckInput,
  decision: RuleDecision,
  gates: RuleGate[],
  instructions: string[],
  git: GitStatusResult,
  diff: GitDiffResult,
): string {
  return [
    "Rule check packet",
    `Event: ${input.event}`,
    `Tool: ${input.toolName || "(none)"}`,
    `Decision: ${decision}`,
    `Git: ${git.clean ? "clean" : "dirty"}${git.branch ? ` on ${git.branch}` : ""}`,
    "Gates:",
    ...gates.map((gate) => `- ${gate.name}: ${gate.decision.toUpperCase()} - ${gate.detail}`),
    "Diff stat:",
    diff.diff.trim() || "No diff.",
    "Instructions:",
    ...instructions.map((line) => `- ${line}`),
  ].join("\n");
}

function normalizeTool(tool: string | undefined): string {
  return (tool ?? "").trim();
}

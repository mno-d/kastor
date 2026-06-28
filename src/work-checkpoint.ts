import { gitDiff, gitStatus, runChecks, type CheckRun, type GitDiffResult, type GitStatusResult } from "./codex-tools.js";
import { taskPlan, type TaskPlanResult } from "./task-plan.js";

export type WorkCheckpointPhase = "start" | "progress" | "pre_review" | "final";

export interface WorkCheckpointInput {
  phase?: WorkCheckpointPhase;
  note?: string;
  runChecks?: boolean;
  scripts?: string[];
  timeoutSeconds?: number;
}

export interface WorkCheckpointResult {
  result: string;
  phase: WorkCheckpointPhase;
  plan: TaskPlanResult;
  gitStatus: GitStatusResult;
  diffStat: GitDiffResult;
  checks?: {
    ok: boolean;
    runs: CheckRun[];
  };
}

export async function workCheckpoint(input: WorkCheckpointInput, context: {
  cwd: string;
  root: string;
  stateDir: string;
}): Promise<WorkCheckpointResult> {
  const phase = input.phase ?? "progress";
  const plan = await taskPlan(
    input.note
      ? { action: "add_items", items: [], note: checkpointNote(phase, input.note) }
      : { action: "get" },
    {
      stateDir: context.stateDir,
      workspaceRoot: context.root,
    },
  );
  const status = await gitStatus({}, context);
  const diffStat = await gitDiff({ stat: true }, context);

  let checks: WorkCheckpointResult["checks"];
  if (input.runChecks) {
    const checkResult = await runChecks({
      scripts: input.scripts,
      timeoutSeconds: input.timeoutSeconds,
    }, context);
    checks = {
      ok: checkResult.ok,
      runs: checkResult.runs,
    };
  }

  return {
    result: formatWorkCheckpoint({
      phase,
      plan,
      gitStatus: status,
      diffStat,
      checks,
    }),
    phase,
    plan,
    gitStatus: status,
    diffStat,
    checks,
  };
}

function checkpointNote(phase: WorkCheckpointPhase, note: string): string {
  return `${phase}: ${note}`;
}

function formatWorkCheckpoint(result: Omit<WorkCheckpointResult, "result">): string {
  const lines = [
    `Work checkpoint: ${result.phase}`,
    `Objective: ${result.plan.objective || "(none)"}`,
    `Plan items: ${result.plan.items.length}`,
    `Git: ${result.gitStatus.clean ? "clean" : "dirty"}${result.gitStatus.branch ? ` on ${result.gitStatus.branch}` : ""}`,
    "Diff stat:",
    result.diffStat.diff.trim() || "No diff.",
  ];

  if (result.checks) {
    lines.push(
      `Checks: ${result.checks.ok ? "passed" : "failed"}`,
      ...result.checks.runs.map((run) => `- ${run.script}: ${run.ok ? "PASS" : "FAIL"}`),
    );
  } else {
    lines.push("Checks: skipped");
  }

  const activeItems = result.plan.items.filter((item) => item.status !== "completed");
  if (activeItems.length > 0) {
    lines.push(
      "Open items:",
      ...activeItems.slice(0, 10).map((item) => `- ${item.id} [${item.status}] ${item.text}`),
    );
  }

  return lines.join("\n");
}

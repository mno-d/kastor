import { gitDiff, gitStatus, runChecks, type CheckRun, type GitDiffResult, type GitStatusResult } from "./codex-tools.js";
import { taskPlan, type TaskPlanItem, type TaskPlanResult } from "./task-plan.js";

export interface WorkResumeInput {
  note?: string;
  failure?: string;
  retryAfterSeconds?: number;
  runChecks?: boolean;
  scripts?: string[];
  timeoutSeconds?: number;
}

export interface WorkResumeResult {
  result: string;
  plan: TaskPlanResult;
  gitStatus: GitStatusResult;
  diffStat: GitDiffResult;
  nextItems: TaskPlanItem[];
  retryAfterAt?: string;
  resumeInstructions: string[];
  checks?: {
    ok: boolean;
    runs: CheckRun[];
  };
}

export async function workResume(input: WorkResumeInput, context: {
  cwd: string;
  root: string;
  stateDir: string;
}): Promise<WorkResumeResult> {
  const note = resumeNote(input);
  const plan = await taskPlan(
    note
      ? { action: "add_items", items: [], note }
      : { action: "get" },
    {
      stateDir: context.stateDir,
      workspaceRoot: context.root,
    },
  );
  const git = await gitStatus({}, context);
  const diff = await gitDiff({ stat: true }, context);

  let checks: WorkResumeResult["checks"];
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

  const retryAfterAt = retryAt(input.retryAfterSeconds);
  const nextItems = nextPlanItems(plan.items);
  const resumeInstructions = buildResumeInstructions({
    dirty: !git.clean,
    checksFailed: checks?.ok === false,
    nextItems,
    retryAfterAt,
  });

  return {
    result: formatWorkResume({
      plan,
      gitStatus: git,
      diffStat: diff,
      nextItems,
      retryAfterAt,
      resumeInstructions,
      checks,
    }),
    plan,
    gitStatus: git,
    diffStat: diff,
    nextItems,
    retryAfterAt,
    resumeInstructions,
    checks,
  };
}

function resumeNote(input: WorkResumeInput): string {
  const parts = [
    input.failure ? `failure=${input.failure}` : undefined,
    input.retryAfterSeconds ? `retry_after_seconds=${input.retryAfterSeconds}` : undefined,
    input.note,
  ].filter(Boolean);
  return parts.length ? `resume: ${parts.join("; ")}` : "";
}

function retryAt(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  return new Date(Date.now() + Math.min(seconds, 24 * 60 * 60) * 1000).toISOString();
}

function nextPlanItems(items: TaskPlanItem[]): TaskPlanItem[] {
  const inProgress = items.filter((item) => item.status === "in_progress");
  if (inProgress.length > 0) return inProgress.slice(0, 5);
  return items.filter((item) => item.status === "pending").slice(0, 5);
}

function buildResumeInstructions(input: {
  dirty: boolean;
  checksFailed: boolean;
  nextItems: TaskPlanItem[];
  retryAfterAt?: string;
}): string[] {
  return [
    input.retryAfterAt
      ? `If a rate limit or temporary outage caused the pause, wait until ${input.retryAfterAt} before retrying.`
      : undefined,
    input.dirty
      ? "Inspect the current diff before editing; preserve user and previous-agent changes."
      : "Working tree is clean; reopen context before making new edits.",
    input.checksFailed
      ? "Fix the first failing check before broadening scope."
      : "Run focused checks after the next edit.",
    input.nextItems.length > 0
      ? `Continue with: ${input.nextItems.map((item) => `${item.id} (${item.status})`).join(", ")}.`
      : "No open task-plan items were found; ask for or create the next concrete task before editing.",
    "Use checkpoint or review before final handoff so the next session has evidence.",
  ].filter((line): line is string => Boolean(line));
}

function formatWorkResume(result: Omit<WorkResumeResult, "result">): string {
  const lines = [
    "Work resume packet",
    `Objective: ${result.plan.objective || "(none)"}`,
    `Git: ${result.gitStatus.clean ? "clean" : "dirty"}${result.gitStatus.branch ? ` on ${result.gitStatus.branch}` : ""}`,
    result.retryAfterAt ? `Retry after: ${result.retryAfterAt}` : undefined,
    "Next items:",
    ...(result.nextItems.length
      ? result.nextItems.map((item) => `- ${item.id} [${item.status}] ${item.text}`)
      : ["- (none)"]),
    "Diff stat:",
    result.diffStat.diff.trim() || "No diff.",
  ].filter((line): line is string => Boolean(line));

  if (result.checks) {
    lines.push(
      "Checks:",
      ...result.checks.runs.map((run) => `- ${run.script}: ${run.ok ? "PASS" : "FAIL"}`),
    );
  } else {
    lines.push("Checks: skipped");
  }

  lines.push(
    "Resume instructions:",
    ...result.resumeInstructions.map((line) => `- ${line}`),
  );

  return lines.join("\n");
}

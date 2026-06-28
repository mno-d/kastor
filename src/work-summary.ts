import { gitDiff, gitStatus, runChecks, type CheckRun, type GitDiffResult, type GitStatusResult } from "./codex-tools.js";
import { taskPlan, type TaskPlanResult } from "./task-plan.js";

export interface WorkSummaryInput {
  runChecks?: boolean;
  scripts?: string[];
  timeoutSeconds?: number;
}

export interface WorkSummaryPayload {
  schemaVersion: 1;
  kind: "kastor.work_summary";
  generatedAt: string;
  workspaceRoot: string;
  objective: string;
  plan: {
    updatedAt: string;
    totalItems: number;
    openItems: number;
    completedItems: number;
    blockedItems: number;
    nextItems: TaskPlanResult["items"];
    recentNotes: string[];
  };
  git: {
    branch: string;
    clean: boolean;
    porcelain: string;
  };
  diffStat: string;
  checks: {
    requested: boolean;
    ok?: boolean;
    runs: CheckRun[];
  };
  recommendedNextActions: string[];
}

export interface WorkSummaryResult {
  result: string;
  plan: TaskPlanResult;
  gitStatus: GitStatusResult;
  diffStat: GitDiffResult;
  checks?: {
    ok: boolean;
    runs: CheckRun[];
  };
  automationSummary: WorkSummaryPayload;
}

export async function workSummary(input: WorkSummaryInput, context: {
  cwd: string;
  root: string;
  stateDir: string;
}): Promise<WorkSummaryResult> {
  const plan = await taskPlan({ action: "get" }, {
    stateDir: context.stateDir,
    workspaceRoot: context.root,
  });
  const status = await gitStatus({}, context);
  const diffStat = await gitDiff({ stat: true }, context);

  let checks: WorkSummaryResult["checks"];
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

  const automationSummary = buildAutomationSummary({
    plan,
    gitStatus: status,
    diffStat,
    checks,
    requestedChecks: input.runChecks ?? false,
    generatedAt: new Date().toISOString(),
  });

  return {
    result: formatWorkSummary(automationSummary),
    plan,
    gitStatus: status,
    diffStat,
    checks,
    automationSummary,
  };
}

function buildAutomationSummary(input: {
  plan: TaskPlanResult;
  gitStatus: GitStatusResult;
  diffStat: GitDiffResult;
  checks: WorkSummaryResult["checks"];
  requestedChecks: boolean;
  generatedAt: string;
}): WorkSummaryPayload {
  const openItems = input.plan.items.filter((item) => item.status !== "completed");
  const completedItems = input.plan.items.filter((item) => item.status === "completed");
  const blockedItems = input.plan.items.filter((item) => item.status === "blocked");
  return {
    schemaVersion: 1,
    kind: "kastor.work_summary",
    generatedAt: input.generatedAt,
    workspaceRoot: input.plan.workspaceRoot,
    objective: input.plan.objective,
    plan: {
      updatedAt: input.plan.updatedAt,
      totalItems: input.plan.items.length,
      openItems: openItems.length,
      completedItems: completedItems.length,
      blockedItems: blockedItems.length,
      nextItems: openItems.slice(0, 10),
      recentNotes: input.plan.notes.slice(-10),
    },
    git: {
      branch: input.gitStatus.branch,
      clean: input.gitStatus.clean,
      porcelain: input.gitStatus.porcelain,
    },
    diffStat: input.diffStat.diff,
    checks: {
      requested: input.requestedChecks,
      ok: input.checks?.ok,
      runs: input.checks?.runs ?? [],
    },
    recommendedNextActions: recommendedNextActions({
      openItems,
      gitStatus: input.gitStatus,
      checks: input.checks,
      requestedChecks: input.requestedChecks,
    }),
  };
}

function recommendedNextActions(input: {
  openItems: TaskPlanResult["items"];
  gitStatus: GitStatusResult;
  checks: WorkSummaryResult["checks"];
  requestedChecks: boolean;
}): string[] {
  const actions: string[] = [];
  if (input.openItems.length > 0) {
    actions.push(`Continue with task-plan item: ${input.openItems[0]?.id}`);
  }
  if (!input.gitStatus.clean) {
    actions.push("Review the current diff before final handoff or commit.");
  }
  if (!input.requestedChecks) {
    actions.push("Run package checks before claiming completion.");
  } else if (input.checks && !input.checks.ok) {
    actions.push("Fix failing checks before final handoff.");
  }
  if (actions.length === 0) {
    actions.push("No immediate local follow-up is required.");
  }
  return actions;
}

function formatWorkSummary(summary: WorkSummaryPayload): string {
  return [
    "Work summary",
    `Schema: ${summary.kind} v${summary.schemaVersion}`,
    `Objective: ${summary.objective || "(none)"}`,
    `Plan: ${summary.plan.completedItems}/${summary.plan.totalItems} completed, ${summary.plan.openItems} open, ${summary.plan.blockedItems} blocked`,
    `Git: ${summary.git.clean ? "clean" : "dirty"}${summary.git.branch ? ` on ${summary.git.branch}` : ""}`,
    `Checks: ${summary.checks.requested ? summary.checks.ok ? "passed" : "failed" : "skipped"}`,
    "Recommended next actions:",
    ...summary.recommendedNextActions.map((action) => `- ${action}`),
    "JSON:",
    JSON.stringify(summary),
  ].join("\n");
}

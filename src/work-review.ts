import { gitDiff, type GitDiffResult } from "./codex-tools.js";
import { workCheckpoint, type WorkCheckpointInput, type WorkCheckpointResult } from "./work-checkpoint.js";

export interface WorkReviewInput extends WorkCheckpointInput {
  includeDiff?: boolean;
}

export interface ReviewGate {
  name: string;
  ok: boolean;
  detail: string;
}

export interface WorkReviewResult extends WorkCheckpointResult {
  reviewGates: ReviewGate[];
  reviewInstructions: string[];
  fullDiff?: GitDiffResult;
}

export async function workReview(input: WorkReviewInput, context: {
  cwd: string;
  root: string;
  stateDir: string;
}): Promise<WorkReviewResult> {
  const checkpoint = await workCheckpoint({
    ...input,
    phase: input.phase ?? "pre_review",
    note: input.note ?? "review packet created",
  }, context);
  const fullDiff = input.includeDiff === false
    ? undefined
    : await gitDiff({}, context);
  const reviewGates = buildReviewGates(checkpoint, fullDiff);

  return {
    ...checkpoint,
    result: formatWorkReview(checkpoint, reviewGates, fullDiff),
    reviewGates,
    reviewInstructions: [
      "Review the diff for correctness, regressions, missing tests, and unsafe behavior.",
      "Treat failed checks as blockers unless the user explicitly accepted the risk.",
      "Mention unresolved task-plan items before final handoff.",
      "Do not claim completion when the diff is empty, checks are failing, or required evidence is missing.",
    ],
    fullDiff,
  };
}

function buildReviewGates(
  checkpoint: WorkCheckpointResult,
  fullDiff: GitDiffResult | undefined,
): ReviewGate[] {
  const activeItems = checkpoint.plan.items.filter((item) => item.status !== "completed");
  const gates: ReviewGate[] = [
    {
      name: "diff_present",
      ok: Boolean((fullDiff?.diff ?? checkpoint.diffStat.diff).trim()),
      detail: "There should be a concrete diff to review for code-change tasks.",
    },
    {
      name: "checks",
      ok: checkpoint.checks?.ok ?? true,
      detail: checkpoint.checks
        ? `Checks ${checkpoint.checks.ok ? "passed" : "failed"}: ${checkpoint.checks.runs.map((run) => run.script).join(", ")}`
        : "Checks were not requested for this review packet.",
    },
    {
      name: "open_plan_items",
      ok: activeItems.length === 0,
      detail: activeItems.length === 0
        ? "No open task-plan items."
        : `Open task-plan items: ${activeItems.map((item) => item.id).join(", ")}`,
    },
  ];

  if (fullDiff?.truncated) {
    gates.push({
      name: "diff_truncated",
      ok: false,
      detail: "Full diff was truncated; inspect narrower diffs before final review.",
    });
  }

  return gates;
}

function formatWorkReview(
  checkpoint: WorkCheckpointResult,
  gates: ReviewGate[],
  fullDiff: GitDiffResult | undefined,
): string {
  const lines = [
    "Work review packet",
    `Phase: ${checkpoint.phase}`,
    `Objective: ${checkpoint.plan.objective || "(none)"}`,
    `Git: ${checkpoint.gitStatus.clean ? "clean" : "dirty"}${checkpoint.gitStatus.branch ? ` on ${checkpoint.gitStatus.branch}` : ""}`,
    "Review gates:",
    ...gates.map((gate) => `- ${gate.name}: ${gate.ok ? "PASS" : "WARN"} - ${gate.detail}`),
    "Diff stat:",
    checkpoint.diffStat.diff.trim() || "No diff.",
  ];

  if (checkpoint.checks) {
    lines.push(
      "Checks:",
      ...checkpoint.checks.runs.map((run) => `- ${run.script}: ${run.ok ? "PASS" : "FAIL"}`),
    );
  } else {
    lines.push("Checks: skipped");
  }

  if (fullDiff) {
    lines.push(
      "Full diff:",
      fullDiff.diff.trim() || "No diff.",
    );
  }

  return lines.join("\n");
}

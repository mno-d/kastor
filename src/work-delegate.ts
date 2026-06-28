import { gitDiff, gitStatus, type GitDiffResult, type GitStatusResult } from "./codex-tools.js";
import { taskPlan, type TaskPlanItem, type TaskPlanResult } from "./task-plan.js";

export type DelegateMode = "explore" | "review" | "test" | "implement";

export interface DelegateSpec {
  id?: string;
  role: string;
  task: string;
  mode?: DelegateMode;
}

export interface WorkDelegateInput {
  note?: string;
  delegates?: DelegateSpec[];
  waitForAll?: boolean;
}

export interface DelegatePacket {
  id: string;
  role: string;
  task: string;
  mode: DelegateMode;
  prompt: string;
}

export interface WorkDelegateResult {
  result: string;
  plan: TaskPlanResult;
  gitStatus: GitStatusResult;
  diffStat: GitDiffResult;
  delegatePackets: DelegatePacket[];
  orchestrationInstructions: string[];
  consolidationChecklist: string[];
}

export async function workDelegate(input: WorkDelegateInput, context: {
  cwd: string;
  root: string;
  stateDir: string;
}): Promise<WorkDelegateResult> {
  const specs = normalizeDelegates(input.delegates);
  const note = delegateNote(specs, input.note);
  const plan = await taskPlan(
    { action: "add_items", items: [], note },
    {
      stateDir: context.stateDir,
      workspaceRoot: context.root,
    },
  );
  const git = await gitStatus({}, context);
  const diff = await gitDiff({ stat: true }, context);
  const openItems = plan.items.filter((item) => item.status !== "completed");
  const packets = specs.map((spec, index) => buildDelegatePacket(spec, index, plan, openItems, diff));
  const waitForAll = input.waitForAll ?? true;
  const orchestrationInstructions = buildOrchestrationInstructions(waitForAll);
  const consolidationChecklist = buildConsolidationChecklist(packets);

  return {
    result: formatWorkDelegate({
      plan,
      gitStatus: git,
      diffStat: diff,
      delegatePackets: packets,
      orchestrationInstructions,
      consolidationChecklist,
    }),
    plan,
    gitStatus: git,
    diffStat: diff,
    delegatePackets: packets,
    orchestrationInstructions,
    consolidationChecklist,
  };
}

function normalizeDelegates(delegates: DelegateSpec[] | undefined): Required<DelegateSpec>[] {
  const source: DelegateSpec[] = delegates?.length
    ? delegates
    : [
      {
        id: "reviewer",
        role: "reviewer",
        task: "Review the current diff for correctness, regressions, unsafe behavior, and missing tests.",
        mode: "review",
      },
      {
        id: "tester",
        role: "tester",
        task: "Identify the focused checks that should prove the current change and any likely gaps.",
        mode: "test",
      },
      {
        id: "maintainer",
        role: "maintainer",
        task: "Check whether the change keeps the codebase simple, scoped, and consistent with existing patterns.",
        mode: "review",
      },
    ];

  return source.slice(0, 6).map((delegate, index) => {
    const id = cleanId(delegate.id || delegate.role || `agent-${index + 1}`) || `agent-${index + 1}`;
    const role = cleanText(delegate.role) || id;
    const task = cleanText(delegate.task);
    if (!task) throw new Error(`Delegate task is required: ${id}`);
    return {
      id,
      role,
      task,
      mode: delegate.mode ?? defaultMode(role, task),
    };
  });
}

function buildDelegatePacket(
  delegate: Required<DelegateSpec>,
  index: number,
  plan: TaskPlanResult,
  openItems: TaskPlanItem[],
  diff: GitDiffResult,
): DelegatePacket {
  const label = `${delegate.id || `agent-${index + 1}`}`;
  const prompt = [
    `Role: ${delegate.role}`,
    `Mode: ${delegate.mode}`,
    `Objective: ${plan.objective || "(none)"}`,
    `Assigned task: ${delegate.task}`,
    "Rules:",
    "- Work from the current workspace state only.",
    "- Keep intermediate exploration out of the main thread.",
    "- Return a short summary with evidence, file references, risks, and recommended next action.",
    "- Do not edit files unless the parent explicitly assigns an implementation task.",
    "- If you find a blocker, name the exact missing evidence or failing command.",
    "Open task-plan items:",
    ...(openItems.length
      ? openItems.map((item) => `- ${item.id} [${item.status}] ${item.text}`)
      : ["- (none)"]),
    "Current diff stat:",
    diff.diff.trim() || "No diff.",
  ];

  return {
    id: label,
    role: delegate.role,
    task: delegate.task,
    mode: delegate.mode,
    prompt: prompt.join("\n"),
  };
}

function buildOrchestrationInstructions(waitForAll: boolean): string[] {
  return [
    "Spawn or simulate one worker per delegate packet; keep each worker focused on its assigned task.",
    waitForAll
      ? "Wait for every delegate result before making the final decision."
      : "You may continue after the first blocking result, but record which delegates were skipped.",
    "Do not merge raw logs into the main answer; ask for concise findings and evidence only.",
    "Prefer read-heavy delegation for exploration, review, testing strategy, and triage.",
    "Avoid parallel write-heavy work unless each delegate has a clearly isolated file scope.",
  ];
}

function buildConsolidationChecklist(packets: DelegatePacket[]): string[] {
  return [
    `Collected results from ${packets.length} delegate packet(s).`,
    "Grouped findings by correctness, tests, security/safety, maintainability, and unresolved evidence.",
    "Resolved duplicate or conflicting findings before editing.",
    "Updated task_plan items or notes with the accepted next action.",
    "Ran focused checks after any follow-up edit.",
  ];
}

function defaultMode(role: string, task: string): DelegateMode {
  const text = `${role} ${task}`.toLowerCase();
  if (/test|verify|flaky/.test(text)) return "test";
  if (/implement|fix|code|edit/.test(text)) return "implement";
  if (/explore|inspect|search|triage/.test(text)) return "explore";
  return "review";
}

function delegateNote(delegates: Required<DelegateSpec>[], note: string | undefined): string {
  const summary = delegates.map((delegate) => `${delegate.id}:${delegate.mode}`).join(", ");
  return cleanText(`delegate: ${summary}${note ? `; ${note}` : ""}`);
}

function cleanId(text: string): string {
  return cleanText(text).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function formatWorkDelegate(result: Omit<WorkDelegateResult, "result">): string {
  return [
    "Work delegate packet",
    `Objective: ${result.plan.objective || "(none)"}`,
    `Git: ${result.gitStatus.clean ? "clean" : "dirty"}${result.gitStatus.branch ? ` on ${result.gitStatus.branch}` : ""}`,
    "Delegates:",
    ...result.delegatePackets.map((packet) => `- ${packet.id} [${packet.mode}] ${packet.role}: ${packet.task}`),
    "Diff stat:",
    result.diffStat.diff.trim() || "No diff.",
    "Orchestration instructions:",
    ...result.orchestrationInstructions.map((line) => `- ${line}`),
    "Consolidation checklist:",
    ...result.consolidationChecklist.map((line) => `- ${line}`),
    "Delegate prompts:",
    ...result.delegatePackets.flatMap((packet) => [
      `## ${packet.id}`,
      packet.prompt,
    ]),
  ].join("\n");
}

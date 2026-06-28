import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type TaskPlanItemStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TaskPlanAction = "get" | "set" | "add_items" | "update_item" | "clear";

export interface TaskPlanItem {
  id: string;
  text: string;
  status: TaskPlanItemStatus;
}

export interface TaskPlan {
  workspaceRoot: string;
  objective: string;
  items: TaskPlanItem[];
  notes: string[];
  updatedAt: string;
}

export interface TaskPlanInput {
  action: TaskPlanAction;
  objective?: string;
  items?: Array<{
    id?: string;
    text: string;
    status?: TaskPlanItemStatus;
  }>;
  itemId?: string;
  status?: TaskPlanItemStatus;
  text?: string;
  note?: string;
}

export interface TaskPlanResult extends TaskPlan {
  result: string;
}

const MAX_ITEMS = 100;
const MAX_NOTES = 100;
const MAX_TEXT_LENGTH = 2_000;

export async function taskPlan(input: TaskPlanInput, context: {
  stateDir: string;
  workspaceRoot: string;
}): Promise<TaskPlanResult> {
  const current = await readPlan(context);
  let plan = current;

  switch (input.action) {
    case "get":
      break;
    case "set":
      plan = normalizePlan({
        workspaceRoot: context.workspaceRoot,
        objective: cleanText(input.objective ?? ""),
        items: normalizeItems(input.items ?? []),
        notes: input.note ? [cleanText(input.note)] : [],
        updatedAt: new Date().toISOString(),
      });
      await writePlan(context, plan);
      break;
    case "add_items":
      plan = normalizePlan({
        ...current,
        items: [...current.items, ...normalizeItems(input.items ?? [])],
        notes: appendNote(current.notes, input.note),
        updatedAt: new Date().toISOString(),
      });
      await writePlan(context, plan);
      break;
    case "update_item":
      plan = updatePlanItem(current, input);
      await writePlan(context, plan);
      break;
    case "clear":
      plan = normalizePlan({
        workspaceRoot: context.workspaceRoot,
        objective: "",
        items: [],
        notes: input.note ? [cleanText(input.note)] : [],
        updatedAt: new Date().toISOString(),
      });
      await writePlan(context, plan);
      break;
    default:
      assertNever(input.action);
  }

  return {
    ...plan,
    result: formatTaskPlan(plan),
  };
}

async function readPlan(context: {
  stateDir: string;
  workspaceRoot: string;
}): Promise<TaskPlan> {
  try {
    const raw = await readFile(planPath(context), "utf8");
    const parsed = JSON.parse(raw) as TaskPlan;
    return normalizePlan({
      workspaceRoot: context.workspaceRoot,
      objective: parsed.objective ?? "",
      items: parsed.items ?? [],
      notes: parsed.notes ?? [],
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    });
  } catch {
    return normalizePlan({
      workspaceRoot: context.workspaceRoot,
      objective: "",
      items: [],
      notes: [],
      updatedAt: new Date(0).toISOString(),
    });
  }
}

async function writePlan(context: {
  stateDir: string;
  workspaceRoot: string;
}, plan: TaskPlan): Promise<void> {
  const directory = planDirectory(context.stateDir);
  await mkdir(directory, { recursive: true });
  await writeFile(planPath(context), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function updatePlanItem(current: TaskPlan, input: TaskPlanInput): TaskPlan {
  if (!input.itemId) {
    throw new Error("itemId is required for update_item.");
  }

  let found = false;
  const items = current.items.map((item) => {
    if (item.id !== input.itemId) return item;
    found = true;
    return normalizeItem({
      id: item.id,
      text: input.text ?? item.text,
      status: input.status ?? item.status,
    });
  });
  if (!found) {
    throw new Error(`Task plan item not found: ${input.itemId}`);
  }

  return normalizePlan({
    ...current,
    items,
    notes: appendNote(current.notes, input.note),
    updatedAt: new Date().toISOString(),
  });
}

function normalizePlan(plan: TaskPlan): TaskPlan {
  return {
    workspaceRoot: plan.workspaceRoot,
    objective: cleanText(plan.objective),
    items: plan.items.slice(0, MAX_ITEMS).map(normalizeItem),
    notes: plan.notes.map(cleanText).filter(Boolean).slice(-MAX_NOTES),
    updatedAt: plan.updatedAt,
  };
}

function normalizeItems(items: TaskPlanInput["items"]): TaskPlanItem[] {
  return (items ?? []).map((item, index) => normalizeItem({
    id: item.id ?? `item-${index + 1}`,
    text: item.text,
    status: item.status ?? "pending",
  }));
}

function normalizeItem(item: TaskPlanItem): TaskPlanItem {
  const id = cleanText(item.id);
  const text = cleanText(item.text);
  if (!id) throw new Error("Task plan item id is required.");
  if (!text) throw new Error(`Task plan item text is required: ${id}`);
  return {
    id,
    text,
    status: item.status,
  };
}

function appendNote(notes: string[], note: string | undefined): string[] {
  const cleaned = cleanText(note ?? "");
  return cleaned ? [...notes, cleaned].slice(-MAX_NOTES) : notes;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function formatTaskPlan(plan: TaskPlan): string {
  const objective = plan.objective || "(none)";
  const items = plan.items.length
    ? plan.items.map((item) => `- ${item.id} [${item.status}] ${item.text}`)
    : ["- (no items)"];
  const notes = plan.notes.length
    ? ["Notes:", ...plan.notes.map((note) => `- ${note}`)]
    : [];
  return [
    `Task plan for ${plan.workspaceRoot}`,
    `Objective: ${objective}`,
    `Updated: ${plan.updatedAt}`,
    "Items:",
    ...items,
    ...notes,
  ].join("\n");
}

function planDirectory(stateDir: string): string {
  return join(stateDir, "task-plans");
}

function planPath(context: {
  stateDir: string;
  workspaceRoot: string;
}): string {
  const digest = createHash("sha256").update(context.workspaceRoot).digest("hex");
  return join(planDirectory(context.stateDir), `${digest}.json`);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported task plan action: ${value}`);
}

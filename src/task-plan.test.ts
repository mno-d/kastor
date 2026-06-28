import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskPlan } from "./task-plan.js";

async function withTempDir(test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "kastor-task-plan-test-"));
  try {
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withTempDir(async (root) => {
  const context = {
    stateDir: join(root, ".state"),
    workspaceRoot: join(root, "project"),
  };

  const empty = await taskPlan({ action: "get" }, context);
  assert.equal(empty.objective, "");
  assert.deepEqual(empty.items, []);

  const created = await taskPlan({
    action: "set",
    objective: "Ship the next Kastor capability",
    items: [
      { id: "inspect", text: "Inspect current state", status: "completed" },
      { id: "implement", text: "Implement the next tool", status: "in_progress" },
    ],
    note: "Started from a clean workspace.",
  }, context);
  assert.equal(created.objective, "Ship the next Kastor capability");
  assert.equal(created.items.length, 2);
  assert.equal(created.notes.length, 1);

  const restored = await taskPlan({ action: "get" }, context);
  assert.equal(restored.objective, created.objective);
  assert.deepEqual(restored.items, created.items);

  const updated = await taskPlan({
    action: "update_item",
    itemId: "implement",
    status: "completed",
    note: "Tool implemented.",
  }, context);
  assert.equal(updated.items.find((item) => item.id === "implement")?.status, "completed");
  assert.equal(updated.notes.at(-1), "Tool implemented.");
});

await withTempDir(async (root) => {
  const context = {
    stateDir: join(root, ".state"),
    workspaceRoot: join(root, "project"),
  };

  await taskPlan({
    action: "add_items",
    items: [{ text: "Unnamed item receives a stable id" }],
  }, context);

  const plan = await taskPlan({ action: "get" }, context);
  assert.equal(plan.items[0]?.id, "item-1");
  assert.equal(plan.items[0]?.status, "pending");

  await assert.rejects(
    taskPlan({ action: "update_item", itemId: "missing", status: "completed" }, context),
    /not found/,
  );
});

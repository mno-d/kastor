import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { taskPlan } from "./task-plan.js";
import { workDelegate } from "./work-delegate.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "kastor-work-delegate-test-"));
const stateDir = await mkdtemp(join(tmpdir(), "kastor-work-delegate-state-"));

try {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "README.md"), "hello\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial commit"]);

  await taskPlan({
    action: "set",
    objective: "Delegate review",
    items: [
      { id: "review", text: "Review change", status: "in_progress" },
      { id: "done", text: "Completed item", status: "completed" },
    ],
  }, { stateDir, workspaceRoot: root });

  await writeFile(join(root, "README.md"), "hello\ndelegate\n");
  const packet = await workDelegate({
    note: "parallel review",
    delegates: [
      { id: "security", role: "Security reviewer", task: "Check for unsafe behavior." },
      { id: "tests", role: "Tester", task: "Find missing verification.", mode: "test" },
    ],
  }, {
    cwd: root,
    root,
    stateDir,
  });

  assert.equal(packet.plan.objective, "Delegate review");
  assert.equal(packet.delegatePackets.length, 2);
  assert.equal(packet.delegatePackets[0]?.id, "security");
  assert.equal(packet.delegatePackets[1]?.mode, "test");
  assert.match(packet.delegatePackets[0]?.prompt ?? "", /Open task-plan items/);
  assert.match(packet.delegatePackets[0]?.prompt ?? "", /review \[in_progress\]/);
  assert.match(packet.diffStat.diff, /README\.md/);
  assert.match(packet.result, /Work delegate packet/);
  assert.equal(packet.orchestrationInstructions.some((line) => line.includes("Wait for every delegate")), true);

  const persistedPlan = await taskPlan({ action: "get" }, { stateDir, workspaceRoot: root });
  assert.equal(persistedPlan.notes.some((note) => note.includes("delegate: security:review, tests:test")), true);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { taskPlan } from "./task-plan.js";
import { workCheckpoint } from "./work-checkpoint.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "kastor-work-checkpoint-test-"));
const stateDir = await mkdtemp(join(tmpdir(), "kastor-work-checkpoint-state-"));

try {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: {
      typecheck: "node -e \"process.exit(0)\"",
    },
  }, null, 2));
  await writeFile(join(root, "README.md"), "hello\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial commit"]);

  await taskPlan({
    action: "set",
    objective: "Verify checkpoint",
    items: [{ id: "one", text: "Run checkpoint", status: "in_progress" }],
  }, { stateDir, workspaceRoot: root });

  await writeFile(join(root, "README.md"), "hello\nworld\n");
  const checkpoint = await workCheckpoint({
    phase: "pre_review",
    note: "ready for review",
    runChecks: true,
    scripts: ["typecheck"],
  }, {
    cwd: root,
    root,
    stateDir,
  });

  assert.equal(checkpoint.phase, "pre_review");
  assert.equal(checkpoint.plan.objective, "Verify checkpoint");
  assert.equal(checkpoint.gitStatus.clean, false);
  assert.match(checkpoint.diffStat.diff, /README\.md/);
  assert.equal(checkpoint.checks?.ok, true);
  assert.equal(checkpoint.checks?.runs[0]?.script, "typecheck");
  assert.match(checkpoint.result, /Work checkpoint: pre_review/);
  assert.match(checkpoint.result, /Open items:/);

  const persistedPlan = await taskPlan({ action: "get" }, { stateDir, workspaceRoot: root });
  assert.equal(persistedPlan.notes.some((note) => note.includes("ready for review")), true);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

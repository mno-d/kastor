import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { taskPlan } from "./task-plan.js";
import { workReview } from "./work-review.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "kastor-work-review-test-"));
const stateDir = await mkdtemp(join(tmpdir(), "kastor-work-review-state-"));

try {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"process.exit(0)\"",
    },
  }, null, 2));
  await writeFile(join(root, "README.md"), "hello\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial commit"]);

  await taskPlan({
    action: "set",
    objective: "Review packet",
    items: [
      { id: "done", text: "Implemented change", status: "completed" },
      { id: "review", text: "Review change", status: "in_progress" },
    ],
  }, { stateDir, workspaceRoot: root });

  await writeFile(join(root, "README.md"), "hello\nreview\n");
  const packet = await workReview({
    runChecks: true,
    scripts: ["test"],
  }, {
    cwd: root,
    root,
    stateDir,
  });

  assert.equal(packet.phase, "pre_review");
  assert.equal(packet.checks?.ok, true);
  assert.match(packet.fullDiff?.diff ?? "", /review/);
  assert.equal(packet.reviewGates.find((gate) => gate.name === "diff_present")?.ok, true);
  assert.equal(packet.reviewGates.find((gate) => gate.name === "checks")?.ok, true);
  assert.equal(packet.reviewGates.find((gate) => gate.name === "open_plan_items")?.ok, false);
  assert.match(packet.result, /Work review packet/);
  assert.match(packet.result, /Full diff:/);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

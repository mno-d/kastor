import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { taskPlan } from "./task-plan.js";
import { workSummary } from "./work-summary.js";

const execFileAsync = promisify(execFile);

const root = await mkdtemp(join(tmpdir(), "kastor-work-summary-test-"));
const stateDir = await mkdtemp(join(tmpdir(), "kastor-work-summary-state-"));

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root, encoding: "utf8" });
  return stdout;
}

await git(["init"]);
await git(["config", "user.email", "test@example.com"]);
await git(["config", "user.name", "Kastor Test"]);
await writeFile(join(root, "README.md"), "hello\n");
await git(["add", "README.md"]);
await git(["commit", "-m", "Initial commit"]);
await writeFile(join(root, "README.md"), "hello\nsummary\n");
await writeFile(join(root, "package.json"), JSON.stringify({
  scripts: {
    typecheck: "node -e \"process.exit(0)\"",
  },
}, null, 2));

await taskPlan({
  action: "set",
  objective: "Create machine-readable handoff",
  items: [
    { id: "done", text: "Finished item", status: "completed" },
    { id: "next", text: "Continue item", status: "in_progress" },
    { id: "blocked", text: "Blocked item", status: "blocked" },
  ],
  note: "first note",
}, {
  stateDir,
  workspaceRoot: root,
});

const summary = await workSummary({
  runChecks: true,
  scripts: ["typecheck"],
}, {
  cwd: root,
  root,
  stateDir,
});

assert.equal(summary.automationSummary.schemaVersion, 1);
assert.equal(summary.automationSummary.kind, "kastor.work_summary");
assert.equal(summary.automationSummary.workspaceRoot, root);
assert.equal(summary.automationSummary.objective, "Create machine-readable handoff");
assert.equal(summary.automationSummary.plan.totalItems, 3);
assert.equal(summary.automationSummary.plan.completedItems, 1);
assert.equal(summary.automationSummary.plan.openItems, 2);
assert.equal(summary.automationSummary.plan.blockedItems, 1);
assert.deepEqual(summary.automationSummary.plan.nextItems.map((item) => item.id), ["next", "blocked"]);
assert.deepEqual(summary.automationSummary.plan.recentNotes, ["first note"]);
assert.equal(summary.automationSummary.git.clean, false);
assert.match(summary.automationSummary.diffStat, /README\.md/);
assert.equal(summary.automationSummary.checks.requested, true);
assert.equal(summary.automationSummary.checks.ok, true);
assert.deepEqual(summary.automationSummary.checks.runs.map((run) => run.script), ["typecheck"]);
assert.equal(summary.automationSummary.recommendedNextActions.some((action) => action.includes("next")), true);
assert.match(summary.result, /Work summary/);
assert.match(summary.result, /\"kind\":\"kastor.work_summary\"/);

const porcelainAfter = await git(["status", "--short"]);
assert.match(porcelainAfter, /M README\.md/);

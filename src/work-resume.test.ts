import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { taskPlan } from "./task-plan.js";
import { workResume } from "./work-resume.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "kastor-work-resume-test-"));
const stateDir = await mkdtemp(join(tmpdir(), "kastor-work-resume-state-"));

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
    objective: "Resume work",
    items: [
      { id: "done", text: "Already done", status: "completed" },
      { id: "next", text: "Continue here", status: "in_progress" },
      { id: "later", text: "Later item", status: "pending" },
    ],
  }, { stateDir, workspaceRoot: root });

  await writeFile(join(root, "README.md"), "hello\nresume\n");
  const packet = await workResume({
    failure: "rate limit",
    retryAfterSeconds: 60,
    runChecks: true,
    scripts: ["test"],
  }, {
    cwd: root,
    root,
    stateDir,
  });

  assert.equal(packet.plan.objective, "Resume work");
  assert.equal(packet.nextItems[0]?.id, "next");
  assert.equal(packet.checks?.ok, true);
  assert.equal(packet.gitStatus.clean, false);
  assert.match(packet.diffStat.diff, /README\.md/);
  assert.match(packet.result, /Work resume packet/);
  assert.match(packet.result, /Retry after:/);
  assert.equal(Boolean(packet.retryAfterAt), true);
  assert.equal(packet.resumeInstructions.some((line) => line.includes("Continue with: next")), true);

  const persistedPlan = await taskPlan({ action: "get" }, { stateDir, workspaceRoot: root });
  assert.equal(persistedPlan.notes.some((note) => note.includes("failure=rate limit")), true);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

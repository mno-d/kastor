import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ruleCheck } from "./rule-check.js";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "kastor-rule-check-test-"));

try {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "README.md"), "hello\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial commit"]);

  const shellWrite = await ruleCheck({
    event: "PreToolUse",
    toolName: "bash",
    command: "echo hi > README.md",
  }, { cwd: root, root });
  assert.equal(shellWrite.decision, "block");
  assert.equal(shellWrite.gates.some((gate) => gate.name === "shell_write_guard"), true);

  const safeShell = await ruleCheck({
    event: "PreToolUse",
    toolName: "bash",
    command: "rg TODO src",
  }, { cwd: root, root });
  assert.equal(safeShell.decision, "allow");

  const npmInstall = await ruleCheck({
    event: "PreToolUse",
    toolName: "run_shell",
    command: "npm install left-pad",
  }, { cwd: root, root });
  assert.equal(npmInstall.decision, "block");
  assert.equal(npmInstall.gates.some((gate) => gate.name === "external_or_install_guard"), true);

  const approvedPublish = await ruleCheck({
    event: "PreToolUse",
    toolName: "run_shell",
    command: "npm publish",
    userApproved: true,
  }, { cwd: root, root });
  assert.equal(approvedPublish.decision, "warn");

  const secretPrompt = await ruleCheck({
    event: "UserPromptSubmit",
    summary: "use sk-abcdefghijklmnopqrstuvwxyz123456",
  }, { cwd: root, root });
  assert.equal(secretPrompt.decision, "block");

  await writeFile(join(root, "README.md"), "hello\nchanged\n");
  const stopMissingChecks = await ruleCheck({
    event: "Stop",
    checksPassed: undefined,
    reviewed: false,
  }, { cwd: root, root });
  assert.equal(stopMissingChecks.decision, "warn");
  assert.equal(stopMissingChecks.gates.some((gate) => gate.name === "checks_missing"), true);

  const stopFailedChecks = await ruleCheck({
    event: "Stop",
    checksPassed: false,
    reviewed: true,
  }, { cwd: root, root });
  assert.equal(stopFailedChecks.decision, "block");
  assert.match(stopFailedChecks.result, /Rule check packet/);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

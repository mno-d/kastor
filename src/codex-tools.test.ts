import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyUnifiedPatch, gitCommit, gitDiff, gitPublish, gitStage, gitStatus, runChecks, selfTest, sizeTop } from "./codex-tools.js";

const execFileAsync = promisify(execFile);

async function withTempDir(test: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "devspace-codex-tools-test-"));
  try {
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

await withTempDir(async (root) => {
  const target = join(root, "sample.txt");
  await writeFile(target, "hello\n", "utf8");

  const result = await applyUnifiedPatch({
    patch: [
      "diff --git a/sample.txt b/sample.txt",
      "--- a/sample.txt",
      "+++ b/sample.txt",
      "@@ -1 +1 @@",
      "-hello",
      "+hello world",
      "",
    ].join("\n"),
  }, { cwd: root, root });

  assert.deepEqual(result.files, ["sample.txt"]);
  assert.equal((await readFile(target, "utf8")).replace(/\r\n/g, "\n"), "hello world\n");
});

await withTempDir(async (root) => {
  await assert.rejects(
    applyUnifiedPatch({
      patch: [
        "diff --git a/../outside.txt b/../outside.txt",
        "--- a/../outside.txt",
        "+++ b/../outside.txt",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n"),
    }, { cwd: root, root }),
    /must not contain/,
  );
});

await withTempDir(async (root) => {
  const target = join(root, "name with space.txt");
  await writeFile(target, "old\n", "utf8");

  const result = await applyUnifiedPatch({
    patch: [
      "diff --git a/name with space.txt b/name with space.txt",
      "--- a/name with space.txt",
      "+++ b/name with space.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
  }, { cwd: root, root });

  assert.deepEqual(result.files, ["name with space.txt"]);
  assert.equal((await readFile(target, "utf8")).replace(/\r\n/g, "\n"), "new\n");
});

await withTempDir(async (root) => {
  await writeFile(join(root, "tiny.txt"), "x", "utf8");
  await mkdir(join(root, "large"));
  await writeFile(join(root, "large", "large.txt"), "x".repeat(2048), "utf8");

  const result = await sizeTop({ limit: 2, maxDepth: 3 }, { cwd: root, root });

  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.path, "large");
  assert.equal(result.entries[0]?.type, "directory");
  assert.equal(result.entries[0]?.bytes, 2048);
  assert.equal(result.truncated, false);
});

await withTempDir(async (root) => {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "tracked.txt"), "old\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  await writeFile(join(root, "tracked.txt"), "new\n", "utf8");

  const status = await gitStatus({}, { cwd: root, root });
  assert.equal(status.clean, false);
  assert.match(status.porcelain, /M tracked\.txt/);

  const diff = await gitDiff({}, { cwd: root, root });
  assert.match(diff.diff, /-old/);
  assert.match(diff.diff, /\+new/);
});

await withTempDir(async (root) => {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "tracked.txt"), "old\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  await writeFile(join(root, "tracked.txt"), "new\n", "utf8");

  const staged = await gitStage({
    action: "stage",
    paths: ["tracked.txt"],
  }, { cwd: root, root });
  assert.deepEqual(staged.staged, ["tracked.txt"]);
  assert.deepEqual(staged.unstaged, []);

  const unstaged = await gitStage({
    action: "unstage",
    paths: ["tracked.txt"],
  }, { cwd: root, root });
  assert.deepEqual(unstaged.staged, []);
  assert.deepEqual(unstaged.unstaged, ["tracked.txt"]);

  await assert.rejects(
    gitStage({ action: "stage" }, { cwd: root, root }),
    /requires paths or all=true/,
  );
});

await withTempDir(async (root) => {
  await git(root, ["init"]);
  await assert.rejects(
    gitStage({ action: "status", paths: ["../outside.txt"] }, { cwd: root, root }),
    /outside allowed roots/,
  );
});

await withTempDir(async (root) => {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "tracked.txt"), "old\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  await writeFile(join(root, "tracked.txt"), "new\n", "utf8");

  const status = await gitCommit({ action: "status" }, { cwd: root, root });
  assert.equal(status.committed, false);
  assert.deepEqual(status.unstaged, ["tracked.txt"]);

  await assert.rejects(
    gitCommit({ action: "commit" }, { cwd: root, root }),
    /requires a non-empty message/,
  );

  const committed = await gitCommit({
    action: "commit",
    message: "Update tracked file",
    stageAll: true,
  }, { cwd: root, root });
  assert.equal(committed.committed, true);
  assert.match(committed.commit ?? "", /^[a-f0-9]+$/);
  assert.equal(committed.porcelain.trim(), "");
});

await withTempDir(async (root) => {
  const remoteRoot = await mkdtemp(join(tmpdir(), "devspace-codex-tools-remote-"));
  try {
    const remotePath = join(remoteRoot, "remote.git");
    await execFileAsync("git", ["init", "--bare", remotePath]);
    await git(root, ["init"]);
    await git(root, ["checkout", "-b", "main"]);
    await git(root, ["config", "user.email", "kastor@example.com"]);
    await git(root, ["config", "user.name", "Kastor Test"]);
    await git(root, ["remote", "add", "origin", remotePath]);
    await writeFile(join(root, "tracked.txt"), "old\n", "utf8");
    await git(root, ["add", "tracked.txt"]);
    await git(root, ["commit", "-m", "initial"]);
    await git(root, ["push", "-u", "origin", "main"]);
    await writeFile(join(root, "tracked.txt"), "new\n", "utf8");
    await git(root, ["add", "tracked.txt"]);
    await git(root, ["commit", "-m", "local change"]);

    const ready = await gitPublish({ action: "preflight" }, { cwd: root, root });
    assert.equal(ready.ready, true);
    assert.equal(ready.requiresApproval, true);
    assert.equal(ready.currentBranch, "main");
    assert.equal(ready.targetRemote, "origin");
    assert.equal(ready.targetBranch, "main");
    assert.equal(ready.upstream, "origin/main");
    assert.equal(ready.ahead, 1);
    assert.equal(ready.behind, 0);
    assert.equal(ready.commitsToPublish.length, 1);
    assert.match(ready.result, /did not push/);

    await writeFile(join(root, "tracked.txt"), "dirty\n", "utf8");
    const dirty = await gitPublish({ action: "preflight" }, { cwd: root, root });
    assert.equal(dirty.ready, false);
    assert.equal(dirty.blockers.some((blocker) => blocker.includes("uncommitted changes")), true);
  } finally {
    await rm(remoteRoot, { recursive: true, force: true });
  }
});

await withTempDir(async (root) => {
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: {
      typecheck: "node -e \"process.exit(0)\"",
      test: "node -e \"process.exit(0)\"",
    },
  }), "utf8");

  const result = await runChecks({}, { cwd: root, root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.runs.map((run) => run.script), ["typecheck", "test"]);
});

await withTempDir(async (root) => {
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"process.exit(3)\"",
      build: "node -e \"process.exit(0)\"",
    },
  }), "utf8");

  const result = await runChecks({ scripts: ["test", "build"] }, { cwd: root, root });
  assert.equal(result.ok, false);
  assert.deepEqual(result.runs.map((run) => run.script), ["test"]);
});

await withTempDir(async (root) => {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"process.exit(0)\"",
    },
  }), "utf8");
  await git(root, ["add", "package.json"]);
  await git(root, ["commit", "-m", "initial"]);

  const result = await selfTest({
    expectedTools: ["open_workspace", "self_test", "git_status"],
  }, { cwd: root, root });

  assert.equal(result.ok, true);
  assert.deepEqual(result.expectedTools, ["git_status", "open_workspace", "self_test"]);
  assert.deepEqual(result.packageScripts, ["test"]);
  assert.equal(result.checkRuns, undefined);
  assert.match(result.result, /Kastor self-test passed/);
});

await withTempDir(async (root) => {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "kastor@example.com"]);
  await git(root, ["config", "user.name", "Kastor Test"]);
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"process.exit(0)\"",
    },
  }), "utf8");

  const result = await selfTest({
    runChecks: true,
    scripts: ["test"],
    expectedTools: ["self_test"],
  }, { cwd: root, root });

  assert.equal(result.ok, true);
  assert.deepEqual(result.checkRuns?.map((run) => run.script), ["test"]);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicCheck } from "./public-check.js";

const root = mkdtempSync(join(tmpdir(), "kastor-public-check-test-"));
execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "kastor@example.com"], { cwd: root });
execFileSync("git", ["config", "user.name", "Kastor Test"], { cwd: root });

writeFileSync(join(root, "README.md"), "safe\n");
writeFileSync(join(root, "local-build.tgz"), "local package archive\n");
execFileSync("git", ["add", "local-build.tgz"], { cwd: root, stdio: "ignore" });
execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "ignore" });
execFileSync("git", ["commit", "-m", "safe"], { cwd: root, stdio: "ignore" });

const clean = publicCheck({
  cwd: root,
  files: {
    dir: join(root, ".kastor"),
    configPath: join(root, ".kastor", "config.json"),
    authPath: join(root, ".kastor", "auth.json"),
    configExists: false,
    authExists: false,
    config: { allowedRoots: [root] },
    auth: {},
  },
});
assert.equal(clean.ok, true);
assert.match(clean.issues.map((issue) => issue.message).join("\n"), /Tracked package archive: local-build\.tgz/);

execFileSync("git", ["rm", "local-build.tgz"], { cwd: root, stdio: "ignore" });
execFileSync("git", ["commit", "-m", "remove local archive"], { cwd: root, stdio: "ignore" });
mkdirSync(join(root, "releases"));
writeFileSync(join(root, "releases", "mnod-kastor-1.2.3.tgz"), "release artifact\n");
execFileSync("git", ["add", "releases/mnod-kastor-1.2.3.tgz"], { cwd: root, stdio: "ignore" });
execFileSync("git", ["commit", "-m", "release artifact"], { cwd: root, stdio: "ignore" });

const releaseArtifact = publicCheck({
  cwd: root,
  files: {
    dir: join(root, ".kastor"),
    configPath: join(root, ".kastor", "config.json"),
    authPath: join(root, ".kastor", "auth.json"),
    configExists: false,
    authExists: false,
    config: { allowedRoots: [root] },
    auth: {},
  },
});
assert.equal(releaseArtifact.ok, true);
assert.equal(releaseArtifact.issues.length, 0);

writeFileSync(join(root, ".env"), "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456\n");
execFileSync("git", ["add", ".env"], { cwd: root, stdio: "ignore" });

const unsafe = publicCheck({
  cwd: root,
  files: {
    dir: join(root, ".kastor"),
    configPath: join(root, ".kastor", "config.json"),
    authPath: join(root, ".kastor", "auth.json"),
    configExists: false,
    authExists: false,
    config: { allowedRoots: [root] },
    auth: {},
  },
});
assert.equal(unsafe.ok, false);
assert.match(unsafe.issues.map((issue) => issue.message).join("\n"), /Tracked \.env file/);
assert.match(unsafe.issues.map((issue) => issue.message).join("\n"), /Possible secret/);

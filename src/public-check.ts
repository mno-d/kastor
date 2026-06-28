import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { DevspaceFiles } from "./user-config.js";

export interface PublicCheckInput {
  cwd: string;
  files: DevspaceFiles;
}

export interface PublicCheckIssue {
  severity: "blocker" | "warning";
  message: string;
}

export interface PublicCheckResult {
  ok: boolean;
  issues: PublicCheckIssue[];
}

const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{20,}|MT[A-Za-z0-9_.-]{20,}\.G[A-Za-z0-9_.-]{20,})/;
const SECRET_ALLOWLIST = [
  "src/rule-check.ts",
  "src/rule-check.test.ts",
  "src/public-check.test.ts",
  "README.md",
  "docs/publishing.md",
  "docs/security.ja.md",
];

export function publicCheck(input: PublicCheckInput): PublicCheckResult {
  const issues: PublicCheckIssue[] = [];
  const trackedFiles = gitLines(input.cwd, ["ls-files"]);

  for (const file of trackedFiles) {
    const normalized = file.replaceAll("\\", "/");
    if (normalized === ".env" || normalized.endsWith("/.env")) {
      issues.push({ severity: "blocker", message: `Tracked .env file: ${file}` });
    }
    if (normalized.endsWith("auth.json") || normalized.includes("secret") || normalized.includes("credential")) {
      issues.push({ severity: "blocker", message: `Tracked sensitive-looking file: ${file}` });
    }
    // Release workflow uploads this committed artifact. Other tracked archives
    // are usually accidental local packaging output and should stay visible.
    if (normalized.endsWith(".tgz") && !/^releases\/mnod-kastor-\d+\.\d+\.\d+\.tgz$/.test(normalized)) {
      issues.push({ severity: "warning", message: `Tracked package archive: ${file}` });
    }
  }

  const secretHits = gitLines(input.cwd, ["grep", "-n", "-I", "-E", SECRET_PATTERN.source, "--", "."])
    .filter((line) => !SECRET_ALLOWLIST.some((file) => line.startsWith(`${file}:`)));
  for (const hit of secretHits) {
    issues.push({ severity: "blocker", message: `Possible secret in tracked files: ${hit}` });
  }

  const configuredRoots = input.files.config.allowedRoots ?? [];
  for (const root of configuredRoots) {
    if (isBroadRoot(root)) {
      issues.push({
        severity: "warning",
        message: `Configured broad allowed root: ${root}. Use only on a private machine.`,
      });
    } else if (!existsSync(resolve(root))) {
      issues.push({ severity: "warning", message: `Configured allowed root does not exist: ${root}` });
    }
  }

  if (input.files.authExists && trackedFiles.includes(relativeOrAbsolute(input.cwd, input.files.authPath))) {
    issues.push({ severity: "blocker", message: "auth.json is tracked by git." });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "blocker"),
    issues,
  };
}

function gitLines(cwd: string, args: string[]): string[] {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isBroadRoot(root: string): boolean {
  const normalized = resolve(root).replaceAll("/", "\\").replace(/\\+$/, "\\");
  const home = resolve(homedir()).replaceAll("/", "\\").replace(/\\+$/, "\\");
  return normalized === "\\" || /^[A-Za-z]:\\$/.test(normalized) || normalized.toLowerCase() === home.toLowerCase();
}

function relativeOrAbsolute(cwd: string, filePath: string): string {
  const absoluteCwd = resolve(cwd);
  const absoluteFile = resolve(filePath);
  if (!absoluteFile.toLowerCase().startsWith(`${absoluteCwd.toLowerCase()}\\`)) return absoluteFile;
  return absoluteFile.slice(absoluteCwd.length + 1).replaceAll("\\", "/");
}

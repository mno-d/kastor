import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { isPathInsideRoot, resolveAllowedPath } from "./roots.js";

const execFileAsync = promisify(execFile);
const DEFAULT_SIZE_LIMIT = 10;
const MAX_SIZE_LIMIT = 50;
const DEFAULT_SIZE_DEPTH = 4;
const MAX_SIZE_DEPTH = 8;
const MAX_SIZE_ENTRIES = 20_000;
const MAX_SIZE_MS = 10_000;
const DEFAULT_CHECKS = ["typecheck", "test", "build", "lint"];
const MAX_CHECK_TIMEOUT_SECONDS = 600;

export interface ApplyPatchInput {
  patch: string;
}

export interface ApplyPatchResult {
  result: string;
  files: string[];
}

export interface SizeTopInput {
  path?: string;
  limit?: number;
  maxDepth?: number;
}

export interface SizeTopEntry {
  path: string;
  type: "file" | "directory" | "other";
  bytes: number;
  size: string;
  truncated: boolean;
}

export interface SizeTopResult {
  result: string;
  root: string;
  entries: SizeTopEntry[];
  truncated: boolean;
  visited: number;
}

export interface GitStatusInput {
  path?: string;
}

export interface GitStatusResult {
  result: string;
  root: string;
  porcelain: string;
  branch: string;
  clean: boolean;
}

export interface GitDiffInput {
  path?: string;
  staged?: boolean;
  stat?: boolean;
}

export interface GitDiffResult {
  result: string;
  root: string;
  diff: string;
  truncated: boolean;
}

export interface GitStageInput {
  action: "status" | "stage" | "unstage";
  paths?: string[];
  all?: boolean;
}

export interface GitStageResult {
  result: string;
  root: string;
  action: GitStageInput["action"];
  porcelain: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitCommitInput {
  action: "status" | "commit";
  message?: string;
  stageAll?: boolean;
}

export interface GitCommitResult {
  result: string;
  root: string;
  action: GitCommitInput["action"];
  committed: boolean;
  commit?: string;
  porcelain: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitPublishInput {
  action: "preflight";
  remote?: string;
  branch?: string;
}

export interface GitPublishResult {
  result: string;
  root: string;
  action: GitPublishInput["action"];
  ready: boolean;
  requiresApproval: boolean;
  currentBranch: string;
  targetRemote: string;
  targetBranch: string;
  upstream?: string;
  remoteUrl?: string;
  head: string;
  porcelain: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
  commitsToPublish: string[];
  blockers: string[];
  warnings: string[];
  instructions: string[];
}

export interface RunChecksInput {
  scripts?: string[];
  timeoutSeconds?: number;
}

export interface CheckRun {
  script: string;
  ok: boolean;
  output: string;
}

export interface RunChecksResult {
  result: string;
  runs: CheckRun[];
  ok: boolean;
}

export interface SelfTestInput {
  runChecks?: boolean;
  scripts?: string[];
  timeoutSeconds?: number;
  expectedTools?: string[];
}

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  result: string;
  ok: boolean;
  checks: SelfTestCheck[];
  expectedTools: string[];
  packageScripts: string[];
  checkRuns?: CheckRun[];
}

export async function applyUnifiedPatch(input: ApplyPatchInput, context: {
  cwd: string;
  root: string;
}): Promise<ApplyPatchResult> {
  const touchedFiles = patchTouchedFiles(input.patch);
  if (touchedFiles.length === 0) {
    throw new Error("Patch does not contain any file paths.");
  }

  for (const file of touchedFiles) {
    const absolutePath = resolveAllowedPath(file, context.cwd, [context.root]);
    if (!isPathInsideRoot(absolutePath, context.root)) {
      throw new Error(`Patch path is outside workspace root: ${file}`);
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "devspace-patch-"));
  const patchPath = join(tempDir, "change.patch");
  try {
    await writeFile(patchPath, input.patch, "utf8");
    await execGitApply(context.cwd, ["apply", "--check", "--whitespace=nowarn", patchPath]);
    await execGitApply(context.cwd, ["apply", "--whitespace=nowarn", patchPath]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    result: `Applied patch to ${touchedFiles.length} file${touchedFiles.length === 1 ? "" : "s"}: ${touchedFiles.join(", ")}`,
    files: touchedFiles,
  };
}

export async function sizeTop(input: SizeTopInput, context: {
  cwd: string;
  root: string;
}): Promise<SizeTopResult> {
  const scanRoot = resolveAllowedPath(input.path ?? ".", context.cwd, [context.root]);
  if (!isPathInsideRoot(scanRoot, context.root)) {
    throw new Error(`Path is outside workspace root: ${input.path ?? "."}`);
  }

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_SIZE_LIMIT, MAX_SIZE_LIMIT));
  const maxDepth = Math.max(0, Math.min(input.maxDepth ?? DEFAULT_SIZE_DEPTH, MAX_SIZE_DEPTH));
  const state = {
    startedAt: performance.now(),
    visited: 0,
    truncated: false,
  };
  const rootStat = await stat(scanRoot);
  if (!rootStat.isDirectory()) {
    const entry = await sizePath(scanRoot, scanRoot, maxDepth, state);
    const entries = [entry];
    return {
      result: formatSizeTopResult(scanRoot, entries, state),
      root: scanRoot,
      entries,
      truncated: state.truncated,
      visited: state.visited,
    };
  }

  const children = await readdir(scanRoot, { withFileTypes: true });
  const entries: SizeTopEntry[] = [];
  for (const child of children) {
    if (shouldStopSizeWalk(state)) break;
    const childPath = join(scanRoot, child.name);
    entries.push(await sizePath(childPath, scanRoot, maxDepth, state));
  }

  entries.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  const topEntries = entries.slice(0, limit);
  return {
    result: formatSizeTopResult(scanRoot, topEntries, state),
    root: scanRoot,
    entries: topEntries,
    truncated: state.truncated,
    visited: state.visited,
  };
}

export async function gitStatus(input: GitStatusInput, context: {
  cwd: string;
  root: string;
}): Promise<GitStatusResult> {
  const cwd = resolveAllowedPath(input.path ?? ".", context.cwd, [context.root]);
  if (!isPathInsideRoot(cwd, context.root)) {
    throw new Error(`Path is outside workspace root: ${input.path ?? "."}`);
  }

  const porcelain = await execGitText(cwd, ["status", "--short"]);
  const branch = await execGitText(cwd, ["branch", "--show-current"]).catch(() => "");
  const clean = porcelain.trim().length === 0;
  const result = [
    `Git status for ${cwd}`,
    branch.trim() ? `Branch: ${branch.trim()}` : "Branch: unknown",
    clean ? "Working tree clean." : porcelain.trimEnd(),
  ].join("\n");

  return {
    result,
    root: cwd,
    porcelain,
    branch: branch.trim(),
    clean,
  };
}

export async function gitDiff(input: GitDiffInput, context: {
  cwd: string;
  root: string;
}): Promise<GitDiffResult> {
  const cwd = resolveAllowedPath(input.path ?? ".", context.cwd, [context.root]);
  if (!isPathInsideRoot(cwd, context.root)) {
    throw new Error(`Path is outside workspace root: ${input.path ?? "."}`);
  }

  const args = ["diff"];
  if (input.staged) args.push("--cached");
  if (input.stat ?? false) args.push("--stat");
  const raw = await execGitText(cwd, args);
  const maxChars = 60_000;
  const truncated = raw.length > maxChars;
  const diff = truncated ? raw.slice(0, maxChars) : raw;
  const result = diff.trim()
    ? `${diff}${truncated ? "\n\nDiff truncated at 60000 characters." : ""}`
    : "No diff.";

  return {
    result,
    root: cwd,
    diff,
    truncated,
  };
}

export async function gitStage(input: GitStageInput, context: {
  cwd: string;
  root: string;
}): Promise<GitStageResult> {
  const cwd = context.root;
  const paths = validateGitStagePaths(input.paths ?? [], context);
  const all = input.all ?? false;

  if (input.action !== "status" && paths.length === 0 && !all) {
    throw new Error("git_stage requires paths or all=true when action is stage or unstage.");
  }

  if (input.action === "stage") {
    if (all) {
      await execGitText(cwd, ["add", "-A"]);
    } else {
      await execGitText(cwd, ["add", "--", ...paths]);
    }
  } else if (input.action === "unstage") {
    if (all) {
      await execGitText(cwd, ["restore", "--staged", "--", "."]);
    } else {
      await execGitText(cwd, ["restore", "--staged", "--", ...paths]);
    }
  }

  const porcelain = await execGitText(cwd, ["status", "--short"]);
  const parsed = parseGitPorcelain(porcelain);
  return {
    result: formatGitStageResult(input.action, parsed, porcelain),
    root: cwd,
    action: input.action,
    porcelain,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
  };
}

export async function gitCommit(input: GitCommitInput, context: {
  cwd: string;
  root: string;
}): Promise<GitCommitResult> {
  const cwd = context.root;
  if (input.action === "status") {
    const porcelain = await execGitText(cwd, ["status", "--short"]);
    const parsed = parseGitPorcelain(porcelain);
    return {
      result: formatGitCommitResult(input.action, false, undefined, parsed, porcelain),
      root: cwd,
      action: input.action,
      committed: false,
      porcelain,
      staged: parsed.staged,
      unstaged: parsed.unstaged,
      untracked: parsed.untracked,
    };
  }

  const message = input.message?.trim();
  if (!message) {
    throw new Error("git_commit requires a non-empty message when action=commit.");
  }
  if (message.includes("\0")) {
    throw new Error("git_commit message must not contain null bytes.");
  }

  if (input.stageAll) {
    await execGitText(cwd, ["add", "-A"]);
  }

  const stagedDiff = await execGitText(cwd, ["diff", "--cached", "--name-only"]);
  if (stagedDiff.trim().length === 0) {
    throw new Error("git_commit has no staged changes. Stage files first or pass stageAll=true.");
  }

  await execGitText(cwd, ["commit", "-m", message]);
  const commit = (await execGitText(cwd, ["rev-parse", "--short", "HEAD"])).trim();
  const porcelain = await execGitText(cwd, ["status", "--short"]);
  const parsed = parseGitPorcelain(porcelain);
  return {
    result: formatGitCommitResult(input.action, true, commit, parsed, porcelain),
    root: cwd,
    action: input.action,
    committed: true,
    commit,
    porcelain,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
  };
}

export async function gitPublish(input: GitPublishInput, context: {
  cwd: string;
  root: string;
}): Promise<GitPublishResult> {
  const cwd = context.root;
  const currentBranch = (await execGitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const head = (await execGitText(cwd, ["rev-parse", "--short", "HEAD"])).trim();
  const porcelain = await execGitText(cwd, ["status", "--short"]);
  const parsed = parseGitPorcelain(porcelain);
  const upstream = await tryGitText(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const upstreamParts = upstream?.trim().split("/");
  const upstreamRemote = upstreamParts && upstreamParts.length > 1 ? upstreamParts[0] : undefined;
  const targetRemote = cleanGitRefName(input.remote) || upstreamRemote || "origin";
  const targetBranch = cleanGitRefName(input.branch) || (currentBranch === "HEAD" ? "" : currentBranch);
  const remoteUrl = await tryGitText(cwd, ["remote", "get-url", targetRemote]);
  const aheadBehind = upstream
    ? parseAheadBehind(await tryGitText(cwd, ["rev-list", "--left-right", "--count", `HEAD...${upstream.trim()}`]))
    : { ahead: 0, behind: 0 };
  const commitsToPublish = upstream
    ? parseLines(await tryGitText(cwd, ["log", "--oneline", `${upstream.trim()}..HEAD`]))
    : parseLines(await tryGitText(cwd, ["log", "--oneline", "-10"]));

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (currentBranch === "HEAD") blockers.push("Repository is in detached HEAD state.");
  if (!targetBranch) blockers.push("Target branch is unknown.");
  if (!remoteUrl?.trim()) blockers.push(`Remote is not configured: ${targetRemote}`);
  if (porcelain.trim()) blockers.push("Working tree or index has uncommitted changes.");
  if (aheadBehind.behind > 0) blockers.push(`Branch is behind upstream by ${aheadBehind.behind} commit(s).`);
  if (!upstream) warnings.push("No upstream branch is configured; a future push would need --set-upstream.");
  if (commitsToPublish.length === 0) warnings.push("No local commits appear ready to publish.");

  const result: GitPublishResult = {
    result: "",
    root: cwd,
    action: input.action,
    ready: blockers.length === 0,
    requiresApproval: true,
    currentBranch,
    targetRemote,
    targetBranch,
    upstream: upstream?.trim() || undefined,
    remoteUrl: remoteUrl?.trim() || undefined,
    head,
    porcelain,
    staged: parsed.staged,
    unstaged: parsed.unstaged,
    untracked: parsed.untracked,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    commitsToPublish,
    blockers,
    warnings,
    instructions: [
      "This preflight did not push, create a pull request, or contact the remote.",
      "Before any future push or PR creation, get explicit user approval in that action-time turn.",
      "Review the diff and checks before publishing.",
    ],
  };
  return {
    ...result,
    result: formatGitPublishResult(result),
  };
}

export async function runChecks(input: RunChecksInput, context: {
  cwd: string;
  root: string;
}): Promise<RunChecksResult> {
  const packageJsonPath = join(context.root, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const availableScripts = packageJson.scripts ?? {};
  const requestedScripts = input.scripts?.length
    ? input.scripts
    : DEFAULT_CHECKS.filter((script) => availableScripts[script]);
  const scripts = [...new Set(requestedScripts)];
  if (scripts.length === 0) {
    throw new Error("No requested checks are available in package.json scripts.");
  }

  for (const script of scripts) {
    if (!/^[A-Za-z0-9:_-]+$/.test(script)) {
      throw new Error(`Unsupported package script name: ${script}`);
    }
    if (!availableScripts[script]) {
      throw new Error(`package.json does not define script: ${script}`);
    }
  }

  const timeoutMs = Math.max(1, Math.min(
    input.timeoutSeconds ?? 300,
    MAX_CHECK_TIMEOUT_SECONDS,
  )) * 1000;
  const runs: CheckRun[] = [];
  for (const script of scripts) {
    const run = await execNpmScript(context.root, script, timeoutMs);
    runs.push(run);
    if (!run.ok) break;
  }

  const ok = runs.every((run) => run.ok);
  return {
    result: formatRunChecksResult(runs, ok),
    runs,
    ok,
  };
}

export async function selfTest(input: SelfTestInput, context: {
  cwd: string;
  root: string;
}): Promise<SelfTestResult> {
  const checks: SelfTestCheck[] = [];

  checks.push({
    name: "auth",
    ok: true,
    detail: "This tool call reached Kastor through the authenticated MCP session.",
  });

  const expectedTools = [...new Set(input.expectedTools ?? [])].sort();
  checks.push({
    name: "tool_surface",
    ok: expectedTools.length > 0,
    detail: expectedTools.length > 0
      ? `Expected tools advertised by this server: ${expectedTools.join(", ")}`
      : "No expected tool list was provided by the server.",
  });

  let packageScripts: string[] = [];
  try {
    const packageJson = JSON.parse(await readFile(join(context.root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    packageScripts = Object.keys(packageJson.scripts ?? {}).sort();
    checks.push({
      name: "package_scripts",
      ok: packageScripts.length > 0,
      detail: packageScripts.length > 0
        ? `Available scripts: ${packageScripts.join(", ")}`
        : "package.json has no scripts.",
    });
  } catch (error) {
    checks.push({
      name: "package_scripts",
      ok: false,
      detail: errorDetail(error, "Unable to read package.json scripts."),
    });
  }

  try {
    const status = await gitStatus({}, context);
    checks.push({
      name: "git_status",
      ok: true,
      detail: status.clean
        ? `Git is available on ${status.branch || "unknown branch"}; working tree is clean.`
        : `Git is available on ${status.branch || "unknown branch"}; working tree has local changes.`,
    });
  } catch (error) {
    checks.push({
      name: "git_status",
      ok: false,
      detail: errorDetail(error, "Unable to run git status."),
    });
  }

  let checkRuns: CheckRun[] | undefined;
  if (input.runChecks) {
    try {
      const checkResult = await runChecks({
        scripts: input.scripts,
        timeoutSeconds: input.timeoutSeconds,
      }, context);
      checkRuns = checkResult.runs;
      checks.push({
        name: "run_checks",
        ok: checkResult.ok,
        detail: checkResult.ok
          ? `Ran checks successfully: ${checkResult.runs.map((run) => run.script).join(", ")}`
          : `Check failed: ${checkResult.runs.find((run) => !run.ok)?.script ?? "unknown"}`,
      });
    } catch (error) {
      checks.push({
        name: "run_checks",
        ok: false,
        detail: errorDetail(error, "Unable to run package checks."),
      });
    }
  } else {
    checks.push({
      name: "run_checks",
      ok: true,
      detail: "Skipped by request. Pass runChecks=true to run package verification scripts.",
    });
  }

  const ok = checks.every((check) => check.ok);
  return {
    result: formatSelfTestResult(checks, ok),
    ok,
    checks,
    expectedTools,
    packageScripts,
    checkRuns,
  };
}

function patchTouchedFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("--- ") && !line.startsWith("+++ ")) continue;
    const rawPath = line.slice(4).trimEnd().split("\t")[0]?.trim();
    if (!rawPath || rawPath === "/dev/null") continue;
    const normalized = normalizePatchPath(rawPath);
    if (normalized) files.add(normalized);
  }
  return [...files].sort();
}

function normalizePatchPath(path: string): string | undefined {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\")) {
    throw new Error(`Patch path must be relative, got: ${path}`);
  }
  const withoutPrefix = path.replace(/^[ab]\//, "");
  if (!withoutPrefix || withoutPrefix === "." || withoutPrefix.includes("\0")) return undefined;
  if (withoutPrefix.split(/[\\/]+/).includes("..")) {
    throw new Error(`Patch path must not contain '..': ${path}`);
  }
  return withoutPrefix;
}

function validateGitStagePaths(paths: string[], context: { cwd: string; root: string }): string[] {
  const normalized: string[] = [];
  for (const path of paths) {
    if (!path || path.includes("\0")) {
      throw new Error("git_stage paths must be non-empty strings.");
    }
    if (path.startsWith(":(")) {
      throw new Error(`git_stage does not accept git pathspec magic: ${path}`);
    }
    const absolutePath = resolveAllowedPath(path, context.cwd, [context.root]);
    if (!isPathInsideRoot(absolutePath, context.root)) {
      throw new Error(`Path is outside workspace root: ${path}`);
    }
    normalized.push(absolutePath);
  }
  return [...new Set(normalized)];
}

function parseGitPorcelain(porcelain: string): {
  staged: string[];
  unstaged: string[];
  untracked: string[];
} {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const path = line.slice(3).trim();
    if (indexStatus === "?" && worktreeStatus === "?") {
      untracked.push(path);
      continue;
    }
    if (indexStatus !== " ") staged.push(path);
    if (worktreeStatus !== " ") unstaged.push(path);
  }

  return { staged, unstaged, untracked };
}

function formatGitStageResult(
  action: GitStageInput["action"],
  parsed: { staged: string[]; unstaged: string[]; untracked: string[] },
  porcelain: string,
): string {
  const changed = porcelain.trim().length > 0;
  const lines = [
    `Git stage ${action} complete.`,
    changed ? "Working tree/index summary:" : "Working tree and index clean.",
  ];
  if (parsed.staged.length > 0) lines.push(`Staged: ${parsed.staged.join(", ")}`);
  if (parsed.unstaged.length > 0) lines.push(`Unstaged: ${parsed.unstaged.join(", ")}`);
  if (parsed.untracked.length > 0) lines.push(`Untracked: ${parsed.untracked.join(", ")}`);
  return lines.join("\n");
}

function formatGitCommitResult(
  action: GitCommitInput["action"],
  committed: boolean,
  commit: string | undefined,
  parsed: { staged: string[]; unstaged: string[]; untracked: string[] },
  porcelain: string,
): string {
  const lines = [
    action === "status"
      ? "Git commit status."
      : committed && commit
        ? `Git commit created: ${commit}`
        : "Git commit did not run.",
  ];
  if (porcelain.trim().length === 0) {
    lines.push("Working tree and index clean.");
    return lines.join("\n");
  }
  lines.push("Remaining working tree/index summary:");
  if (parsed.staged.length > 0) lines.push(`Staged: ${parsed.staged.join(", ")}`);
  if (parsed.unstaged.length > 0) lines.push(`Unstaged: ${parsed.unstaged.join(", ")}`);
  if (parsed.untracked.length > 0) lines.push(`Untracked: ${parsed.untracked.join(", ")}`);
  return lines.join("\n");
}

function formatGitPublishResult(result: Omit<GitPublishResult, "result">): string {
  const lines = [
    "Git publish preflight.",
    `Ready: ${result.ready ? "yes" : "no"}`,
    `Requires approval: ${result.requiresApproval ? "yes" : "no"}`,
    `Branch: ${result.currentBranch}`,
    `Target: ${result.targetRemote}/${result.targetBranch}`,
    result.upstream ? `Upstream: ${result.upstream}` : "Upstream: (none)",
    result.remoteUrl ? `Remote URL: ${result.remoteUrl}` : "Remote URL: (missing)",
    `HEAD: ${result.head}`,
    `Ahead/behind: ${result.ahead}/${result.behind}`,
  ];

  if (result.commitsToPublish.length > 0) {
    lines.push(
      "Commits to publish:",
      ...result.commitsToPublish.map((commit) => `- ${commit}`),
    );
  }
  if (result.porcelain.trim()) {
    lines.push("Working tree/index summary:");
    if (result.staged.length > 0) lines.push(`Staged: ${result.staged.join(", ")}`);
    if (result.unstaged.length > 0) lines.push(`Unstaged: ${result.unstaged.join(", ")}`);
    if (result.untracked.length > 0) lines.push(`Untracked: ${result.untracked.join(", ")}`);
  }
  if (result.blockers.length > 0) {
    lines.push("Blockers:", ...result.blockers.map((blocker) => `- ${blocker}`));
  }
  if (result.warnings.length > 0) {
    lines.push("Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
  }
  lines.push("Instructions:", ...result.instructions.map((instruction) => `- ${instruction}`));
  return lines.join("\n");
}

async function execGitApply(cwd: string, args: string[]): Promise<void> {
  try {
    await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch (error) {
    const anyError = error as { stderr?: string; stdout?: string; message?: string };
    const detail = [anyError.stderr, anyError.stdout, anyError.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(detail || "git apply failed");
  }
}

async function execGitText(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
    });
    return `${stdout}${stderr}`;
  } catch (error) {
    throw new Error(errorDetail(error, "git command failed"));
  }
}

async function tryGitText(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await execGitText(cwd, args);
  } catch {
    return undefined;
  }
}

function cleanGitRefName(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  if (!cleaned) return undefined;
  if (cleaned.includes("\0") || cleaned.startsWith("-") || cleaned.includes("..")) {
    throw new Error(`Unsupported git ref name: ${value}`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(cleaned)) {
    throw new Error(`Unsupported git ref name: ${value}`);
  }
  return cleaned;
}

function parseAheadBehind(raw: string | undefined): { ahead: number; behind: number } {
  const [aheadText, behindText] = raw?.trim().split(/\s+/) ?? [];
  return {
    ahead: Number.parseInt(aheadText ?? "0", 10) || 0,
    behind: Number.parseInt(behindText ?? "0", 10) || 0,
  };
}

function parseLines(raw: string | undefined): string[] {
  return raw?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
}

async function execNpmScript(cwd: string, script: string, timeoutMs: number): Promise<CheckRun> {
  const executable = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run ${script}`]
    : ["run", script];
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return {
      script,
      ok: true,
      output: trimCheckOutput(`${stdout}${stderr}`),
    };
  } catch (error) {
    return {
      script,
      ok: false,
      output: trimCheckOutput(errorDetail(error, `${script} failed`)),
    };
  }
}

function errorDetail(error: unknown, fallback: string): string {
  const anyError = error as { stderr?: string; stdout?: string; message?: string };
  return [anyError.stderr, anyError.stdout, anyError.message]
    .filter(Boolean)
    .join("\n")
    .trim() || fallback;
}

function trimCheckOutput(output: string): string {
  const maxChars = 30_000;
  return output.length > maxChars
    ? `${output.slice(0, maxChars)}\n\nOutput truncated at 30000 characters.`
    : output;
}

function formatRunChecksResult(runs: CheckRun[], ok: boolean): string {
  const header = ok ? "All checks passed." : "Checks failed.";
  const body = runs.map((run) => {
    const status = run.ok ? "PASS" : "FAIL";
    return `## ${run.script}: ${status}\n${run.output.trim() || "(no output)"}`;
  });
  return [header, ...body].join("\n\n");
}

function formatSelfTestResult(checks: SelfTestCheck[], ok: boolean): string {
  const header = ok ? "Kastor self-test passed." : "Kastor self-test found issues.";
  const body = checks.map((check) => {
    const status = check.ok ? "PASS" : "FAIL";
    return `- ${check.name}: ${status} - ${check.detail}`;
  });
  return [header, ...body].join("\n");
}

async function sizePath(
  absolutePath: string,
  basePath: string,
  depthLeft: number,
  state: { startedAt: number; visited: number; truncated: boolean },
): Promise<SizeTopEntry> {
  state.visited += 1;
  const relativePath = relativePathForResult(basePath, absolutePath);
  let info;
  try {
    info = await lstat(absolutePath);
  } catch {
    return { path: relativePath, type: "other", bytes: 0, size: "0 B", truncated: true };
  }

  if (info.isSymbolicLink()) {
    return { path: relativePath, type: "other", bytes: 0, size: "0 B", truncated: false };
  }
  if (info.isFile()) {
    return { path: relativePath, type: "file", bytes: info.size, size: formatBytes(info.size), truncated: false };
  }
  if (!info.isDirectory()) {
    return { path: relativePath, type: "other", bytes: info.size, size: formatBytes(info.size), truncated: false };
  }
  if (depthLeft <= 0 || shouldStopSizeWalk(state)) {
    state.truncated = true;
    return { path: relativePath, type: "directory", bytes: 0, size: "0 B", truncated: true };
  }

  let bytes = 0;
  let truncated = false;
  let children;
  try {
    children = await readdir(absolutePath, { withFileTypes: true });
  } catch {
    return { path: relativePath, type: "directory", bytes: 0, size: "0 B", truncated: true };
  }

  for (const child of children) {
    if (shouldStopSizeWalk(state)) {
      truncated = true;
      break;
    }
    const childEntry = await sizePath(join(absolutePath, child.name), basePath, depthLeft - 1, state);
    bytes += childEntry.bytes;
    truncated ||= childEntry.truncated;
  }

  return {
    path: relativePath,
    type: "directory",
    bytes,
    size: formatBytes(bytes),
    truncated,
  };
}

function shouldStopSizeWalk(state: { startedAt: number; visited: number; truncated: boolean }): boolean {
  if (state.truncated) return true;
  if (state.visited >= MAX_SIZE_ENTRIES || performance.now() - state.startedAt >= MAX_SIZE_MS) {
    state.truncated = true;
    return true;
  }
  return false;
}

function formatSizeTopResult(
  root: string,
  entries: SizeTopEntry[],
  state: { visited: number; truncated: boolean },
): string {
  const header = `Top ${entries.length} entries under ${root}`;
  const body = entries.map((entry, index) => {
    const truncated = entry.truncated ? " (partial)" : "";
    return `${index + 1}. ${entry.path} - ${entry.size}${truncated}`;
  });
  const footer = state.truncated
    ? `Scan stopped early after ${state.visited} entries; sizes may be partial.`
    : `Scanned ${state.visited} entries.`;
  return [header, ...body, footer].join("\n");
}

function relativePathForResult(basePath: string, absolutePath: string): string {
  const relative = resolve(absolutePath) === resolve(basePath)
    ? "."
    : absolutePath.slice(resolve(basePath).length + 1);
  return relative.split(sep).join("/");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

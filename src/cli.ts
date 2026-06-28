#!/usr/bin/env node
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import * as prompts from "@clack/prompts";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { satisfies } from "semver";
import { loadConfig } from "./config.js";
import {
  generateOwnerToken,
  loadDevspaceFiles,
  writeDevspaceAuth,
  writeDevspaceConfig,
  type DevspaceUserConfig,
} from "./user-config.js";
import { expandHomePath } from "./roots.js";

type Command = "serve" | "init" | "doctor" | "setup-guide" | "config" | "help";
type PermissionPreset = "project" | "projects" | "power";
const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=20.12 <27";

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();

  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "serve":
      await ensureConfigured();
      await serve();
      return;
    case "init":
      await runInit({ force: args.includes("--force") });
      return;
    case "doctor":
      await runDoctor();
      return;
    case "setup-guide":
      printSetupGuide();
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "help":
      printHelp();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "init" || command === "doctor" || command === "setup-guide" || command === "config") return command;
  if (command === "help" || command === "--help" || command === "-h") return "help";
  throw new Error(`Unknown command: ${command}`);
}

async function ensureConfigured(): Promise<void> {
  const files = loadDevspaceFiles();
  if (files.configExists && files.authExists) return;
  if (process.env.KASTOR_OAUTH_OWNER_TOKEN || process.env.DEVSPACE_OAUTH_OWNER_TOKEN) return;

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      [
        "Kastor is not configured and this terminal is non-interactive.",
        "",
        "Run:",
        "  kastor init",
        "",
        "Or provide KASTOR_OAUTH_OWNER_TOKEN and KASTOR_ALLOWED_ROOTS.",
      ].join("\n"),
    );
  }

  await runInit({ force: false });
}

async function runInit({ force }: { force: boolean }): Promise<void> {
  const files = loadDevspaceFiles();
  if (!force && files.configExists && files.authExists) {
    prompts.log.info(`Kastor is already configured at ${files.dir}`);
    prompts.log.info("Run `kastor init --force` to update it.");
    return;
  }

  try {
    prompts.intro("Kastor setup");

    const permissionPreset = await permissionPresetPrompt(files.config.permissionPreset);
    const allowedRoots = await allowedRootsPrompt(permissionPreset, files.config.allowedRoots);

    const defaultPort = String(files.config.port ?? 7676);
    const portAnswer = await textPrompt({
      message: `Which local port should Kastor use? Press Enter to use ${defaultPort}`,
      placeholder: defaultPort,
      defaultValue: defaultPort,
      validate: validatePort,
    });
    const port = Number(portAnswer);

    prompts.note(
      [
        "Kastor needs a public base URL so ChatGPT or Claude can reach this MCP server.",
        "Create a tunnel or reverse proxy with Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel, or your own HTTPS proxy.",
        "Paste the public origin here, without /mcp.",
        "",
        "Example: https://your-tunnel-host.example.com",
      ].join("\n"),
      "Public URL required",
    );
    const publicBaseUrl = normalizePublicBaseUrl(await textPrompt({
      message: files.config.publicBaseUrl
        ? `What is the public base URL? Press Enter to keep ${files.config.publicBaseUrl}`
        : "What is the public base URL?",
      placeholder: files.config.publicBaseUrl ?? "https://your-tunnel-host.example.com",
      defaultValue: files.config.publicBaseUrl ?? "",
      validate: validateRequiredPublicBaseUrl,
    }));

    const config: DevspaceUserConfig = {
      host: files.config.host ?? "127.0.0.1",
      port,
      allowedRoots,
      permissionPreset,
      publicBaseUrl,
    };
    const auth = {
      ownerToken: files.auth.ownerToken ?? generateOwnerToken(),
    };

    const configPath = writeDevspaceConfig(config);
    const authPath = writeDevspaceAuth(auth);

    const lines = [
      `Permission preset: ${permissionPreset}`,
      `Config: ${configPath}`,
      `Auth: ${authPath}`,
      `Local MCP URL: http://${config.host}:${config.port}/mcp`,
      ...(publicBaseUrl ? [`Public MCP URL: ${publicBaseUrl}/mcp`] : []),
    ];
    prompts.note(lines.join("\n"), "Kastor configured");
    prompts.note(
      [
        `Owner password: ${auth.ownerToken}`,
        "Use this when ChatGPT or Claude asks you to approve Kastor access.",
        `Stored at: ${authPath}`,
      ].join("\n"),
      "Owner password",
    );
    prompts.outro("Run `kastor serve` to start the MCP server.");
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      prompts.cancel("Setup cancelled");
      return;
    }
    throw error;
  }
}

async function serve(): Promise<void> {
  const sqliteStatus = checkSqliteNative();
  if (sqliteStatus !== "ok") {
    throw new Error(
      [
        "better-sqlite3 could not load for this Node runtime.",
        sqliteStatus,
        "",
        "Try reinstalling or rebuilding dependencies under the active Node version:",
        "  npm rebuild better-sqlite3",
      ].join("\n"),
    );
  }

  const { createServer } = await import("./server.js");
  const config = loadConfig();
  const { app, close } = createServer(config);
  const httpServer = app.listen(config.port, config.host, () => {
    console.log(`kastor listening on http://${config.host}:${config.port}/mcp`);
    console.log(`public base url: ${config.publicBaseUrl}`);
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`allowed hosts: ${config.allowedHosts.join(", ")}`);
    if (config.allowedHosts.includes("*")) {
      console.warn("warning: Host header allowlist is disabled because DEVSPACE_ALLOWED_HOSTS=*");
    }
    console.log("auth: Owner password approval required");
    console.log(`logging: ${config.logging.level} ${config.logging.format}`);
  });

  const shutdown = () => {
    httpServer.close(() => {
      close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function runDoctor(): Promise<void> {
  const files = loadDevspaceFiles();
  console.log(`Config dir: ${files.dir}`);
  console.log(`Config file: ${files.configExists ? files.configPath : "missing"}`);
  console.log(`Auth file: ${files.authExists ? files.authPath : "missing"}`);
  console.log(`Node: ${process.version} (${nodeVersionStatus()})`);
  console.log(`Node ABI: ${process.versions.modules}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Git: ${checkGitAvailable()}`);
  console.log(`Bash shell: ${checkBashShell()}`);
  console.log(`SQLite native dependency: ${checkSqliteNative()}`);

  try {
    const config = loadConfig();
    console.log(`Local MCP URL: http://${config.host}:${config.port}/mcp`);
    console.log(`Public MCP URL: ${new URL("/mcp", config.publicBaseUrl).toString()}`);
    console.log(`Allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`Allowed hosts: ${config.allowedHosts.join(", ")}`);
    console.log(`Permission preset: ${files.config.permissionPreset ?? "not recorded"}`);
    console.log(`Filesystem scope: ${filesystemScopeStatus(config.allowedRoots)}`);
    console.log(`Public URL status: ${publicUrlStatus(config.publicBaseUrl)}`);
  } catch (error) {
    console.log(`Config status: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("");
  console.log("Next setup checks:");
  for (const line of setupChecklist()) {
    console.log(`- ${line}`);
  }
}

function runConfigCommand(args: string[]): void {
  const [subcommand, key, ...rest] = args;
  const files = loadDevspaceFiles();

  if (!subcommand || subcommand === "get") {
    console.log(JSON.stringify(files.config, null, 2));
    return;
  }

  if (subcommand !== "set") {
    throw new Error(`Unknown config command: ${subcommand}`);
  }
  if (key !== "publicBaseUrl") {
    throw new Error("Only `kastor config set publicBaseUrl <url|null>` is supported right now.");
  }

  const value = rest.join(" ").trim();
  if (!value) {
    throw new Error("Missing publicBaseUrl value.");
  }

  writeDevspaceConfig({
    ...files.config,
    publicBaseUrl: normalizeOptionalPublicBaseUrl(value),
  });
  console.log(`Updated ${files.configPath}`);
}

function printHelp(): void {
  console.log(
    [
      "Kastor",
      "",
      "Usage:",
      "  kastor                 Run first-time setup if needed, then start the server",
      "  kastor serve           Start the server",
      "  kastor init            Create or update ~/.kastor/config.json and auth.json",
      "  kastor doctor          Show config, runtime, and native dependency status",
      "  kastor setup-guide     Print OS, tunnel, and permission setup guidance",
      "  kastor config get      Print persisted config",
      "  kastor config set publicBaseUrl <url|null>",
      "",
      "For temporary tunnels:",
      "  KASTOR_PUBLIC_BASE_URL=https://example.trycloudflare.com kastor serve",
    ].join("\n"),
  );
}

function printSetupGuide(): void {
  const osName = process.platform === "win32"
    ? "Windows"
    : process.platform === "darwin"
      ? "macOS"
      : "Linux";

  const lines = [
    `Kastor setup guide for ${osName}`,
    "",
    "1. Install prerequisites",
    process.platform === "win32"
      ? "   - Install Node 22 LTS, Git for Windows, and make sure Git Bash is available."
      : "   - Install Node 22 LTS, Git, and bash.",
    "",
    "2. Choose a permission preset",
    "   - project: current project only, safest default.",
    "   - projects: one or more project folders.",
    "   - power: broader private-machine access; do not use for public/shared setups.",
    "",
    "3. Create a public HTTPS tunnel",
    "   - ngrok: stable domain is easiest for ChatGPT connectors.",
    "   - Cloudflare Tunnel: good if you already use Cloudflare.",
    "   - Tailscale Funnel: good for private identity-controlled access.",
    "   - Reverse proxy: best for servers you control.",
    "   Point the tunnel to http://127.0.0.1:7676 and use the origin as KASTOR_PUBLIC_BASE_URL.",
    "",
    "4. Configure and verify",
    "   kastor init",
    "   kastor doctor",
    "   kastor serve",
    "",
    "5. Connect your MCP host",
    "   Use https://your-domain.example.com/mcp, approve the Owner password, then ask the host to call open_workspace.",
  ];

  console.log(lines.join("\n"));
}

async function permissionPresetPrompt(existing: PermissionPreset | undefined): Promise<PermissionPreset> {
  const fallback = existing ?? "project";
  const answer = await textPrompt({
    message: `Permission preset? project, projects, or power. Press Enter to use ${fallback}`,
    placeholder: fallback,
    defaultValue: fallback,
    validate: validatePermissionPreset,
  });
  return normalizePermissionPreset(answer);
}

async function allowedRootsPrompt(
  permissionPreset: PermissionPreset,
  existingRoots: string[] | undefined,
): Promise<string[]> {
  if (permissionPreset === "project") {
    return [resolve(process.cwd())];
  }

  const defaultRoots = existingRoots?.join(", ") || process.cwd();
  const message = permissionPreset === "power"
    ? `Power preset: enter the broad roots you trust. Press Enter to use ${defaultRoots}`
    : `Where are your projects located? Press Enter to use ${defaultRoots}`;
  const rootsAnswer = await textPrompt({
    message,
    placeholder: defaultRoots,
    defaultValue: defaultRoots,
    validate: (value) => value?.trim() ? undefined : "Enter at least one project root.",
  });

  return rootsAnswer
    .split(",")
    .map((root) => resolve(expandHomePath(root.trim())))
    .filter(Boolean);
}

function validatePermissionPreset(value: string | undefined): string | undefined {
  try {
    normalizePermissionPreset(value ?? "");
    return undefined;
  } catch {
    return "Use project, projects, or power.";
  }
}

function normalizePermissionPreset(value: string): PermissionPreset {
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "project") return "project";
  if (normalized === "2" || normalized === "projects") return "projects";
  if (normalized === "3" || normalized === "power") return "power";
  throw new Error(`Invalid permission preset: ${value}`);
}

function filesystemScopeStatus(roots: string[]): string {
  if (roots.some((root) => isBroadRoot(root))) {
    return "broad root configured; use only on a private trusted machine";
  }
  const missing = roots.filter((root) => !existsSync(root));
  if (missing.length > 0) {
    return `some roots do not exist: ${missing.join(", ")}`;
  }
  return "narrow roots look usable";
}

function isBroadRoot(root: string): boolean {
  const normalized = root.replaceAll("/", "\\").replace(/\\+$/, "\\");
  return normalized === "\\" || /^[A-Za-z]:\\$/.test(normalized) || normalized === resolve(expandHomePath("~"));
}

function publicUrlStatus(publicBaseUrl: string): string {
  const parsed = new URL(publicBaseUrl);
  if (parsed.protocol !== "https:") {
    return "not HTTPS; most remote MCP hosts require a public HTTPS URL";
  }
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    return "local only; create a tunnel before connecting ChatGPT web";
  }
  return "public HTTPS origin configured";
}

function setupChecklist(): string[] {
  return [
    nodeVersionStatus() === `supported ${SUPPORTED_NODE_RANGE}`
      ? "Node version is supported"
      : "Install Node 22 LTS",
    checkGitAvailable().startsWith("git version")
      ? "Git is available"
      : "Install Git",
    checkBashShell().startsWith("unavailable")
      ? "Install Bash or Git Bash"
      : "Bash is available",
    checkSqliteNative() === "ok"
      ? "SQLite native dependency loads"
      : "Run npm rebuild better-sqlite3",
    "Run kastor setup-guide if tunnel or permission setup is unclear",
  ];
}

function normalizeOptionalPublicBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "none") return null;

  return normalizePublicBaseUrl(trimmed);
}

function normalizePublicBaseUrl(value: string): string {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

type TextPromptOptions = Omit<Parameters<typeof prompts.text>[0], "validate"> & {
  defaultValue: string;
  validate?: (value: string | undefined) => string | Error | undefined;
};

async function textPrompt(options: TextPromptOptions): Promise<string> {
  const result = await prompts.text({
    ...options,
    validate: (value) => options.validate?.(value?.trim() ? value : options.defaultValue),
  });
  if (prompts.isCancel(result)) throw new SetupCancelledError();
  const value = String(result).trim();
  return value || options.defaultValue;
}

function validatePort(value: string | undefined): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? undefined
    : "Enter a port between 1 and 65535.";
}

function validateRequiredPublicBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "Enter the public URL from your tunnel or reverse proxy.";
  if (trimmed.endsWith("/mcp")) return "Enter the base URL only, without /mcp.";
  return validatePublicBaseUrl(trimmed);
}

function validatePublicBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? undefined
      : "Use an http or https URL.";
  } catch {
    return "Enter a valid URL, for example https://your-tunnel-host.example.com.";
  }
}

function assertSupportedNode(): void {
  if (satisfies(process.versions.node, SUPPORTED_NODE_RANGE)) return;

  throw new Error(
    [
      `Kastor requires Node ${SUPPORTED_NODE_RANGE}.`,
      `Current Node: ${process.version}`,
      "",
      "Install Node 22 LTS or use a version manager such as nvm, fnm, or mise.",
    ].join("\n"),
  );
}

function nodeVersionStatus(): string {
  return satisfies(process.versions.node, SUPPORTED_NODE_RANGE)
    ? `supported ${SUPPORTED_NODE_RANGE}`
    : `unsupported, requires ${SUPPORTED_NODE_RANGE}`;
}

class SetupCancelledError extends Error {}

function checkSqliteNative(): string {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkGitAvailable(): string {
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unavailable (${message})`;
  }
}

function checkBashShell(): string {
  try {
    const { shell, args } = getShellConfig();
    return `${shell} ${args.join(" ")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unavailable (${message})`;
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

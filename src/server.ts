import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  createOAuthMetadata,
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { checkResourceAllowed, resourceUrlFromServerUrl } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import express from "express";
import type { Request, Response } from "express";
import * as z from "zod/v4";
import { applyUnifiedPatch, gitCommit, gitDiff, gitPublish, gitStage, gitStatus, runChecks, selfTest, sizeTop } from "./codex-tools.js";
import { loadConfig, type ServerConfig } from "./config.js";
import {
  logEvent,
  requestIp,
  requestPath,
  sessionIdPrefix,
} from "./logger.js";
import {
  editFileTool,
  findFilesTool,
  grepFilesTool,
  listDirectoryTool,
  readFileTool,
  runShellTool,
  writeFileTool,
} from "./pi-tools.js";
import { SingleUserOAuthProvider } from "./oauth-provider.js";
import { registerComputerUseTool } from "./register-computer-use-tool.js";
import { createReviewCheckpointManager } from "./review-checkpoints.js";
import { ruleCheck } from "./rule-check.js";
import { formatPathForPrompt } from "./skills.js";
import {
  appCsp,
  assertWorkspaceAppAssets,
  setAssetHeaders,
  uiBuildDirectory,
  WORKSPACE_APP_URI,
  workspaceAppHtml,
} from "./server-ui.js";
import { serverInstructions } from "./server-instructions.js";
import {
  CHECK_TOOL_ANNOTATIONS,
  EDIT_TOOL_ANNOTATIONS,
  registeredToolNames,
  SHELL_TOOL_ANNOTATIONS,
  toolNamesFor,
  toolWidgetDescriptorMeta,
  type ToolNames,
  WRITE_TOOL_ANNOTATIONS,
} from "./server-tool-meta.js";
import {
  contentText,
  imageBlock,
  logFailedToolResponse,
  logToolCall,
  resultOutputSchema,
  textBlock,
  textSummary,
  type ToolContent,
} from "./server-tool-runtime.js";
import { taskPlan, type TaskPlanInput } from "./task-plan.js";
import { workCheckpoint } from "./work-checkpoint.js";
import { workDelegate } from "./work-delegate.js";
import { workResume } from "./work-resume.js";
import { workReview } from "./work-review.js";
import { workSummary } from "./work-summary.js";
import { createWorkspaceStore } from "./workspace-store.js";
import { formatAgentsPath, WorkspaceRegistry } from "./workspaces.js";

type Transport = StreamableHTTPServerTransport;
const APP_NAME = "Kastor";
const APP_ID = "kastor";

interface RunningServer {
  app: ReturnType<typeof createMcpExpressApp>;
  config: ServerConfig;
  close(): void;
}

interface DiffStats {
  additions: number;
  removals: number;
}

const workspaceSkillOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string(),
});

const workspaceAgentsFileOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const workspaceAvailableAgentsFileOutputSchema = z.object({
  path: z.string(),
});

const reviewFileOutputSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  type: z.enum(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  additions: z.number(),
  removals: z.number(),
});

const reviewSummaryOutputSchema = z.object({
  files: z.number(),
  additions: z.number(),
  removals: z.number(),
});

function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

function requestLogFields(req: Request, config: ServerConfig): Record<string, unknown> {
  return {
    ip: requestIp(req, config.logging.trustProxy),
    host: req.header("host"),
    userAgent: req.header("user-agent"),
    origin: req.header("origin"),
    referer: req.header("referer"),
    contentLength: req.header("content-length"),
  };
}

function contentLineCount(content: string): number {
  if (content.length === 0) return 0;
  return content.endsWith("\n")
    ? content.slice(0, -1).split("\n").length
    : content.split("\n").length;
}

function countDiffStats(diff: string | undefined): DiffStats {
  if (!diff) return { additions: 0, removals: 0 };

  let additions = 0;
  let removals = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }

  return { additions, removals };
}

function newFilePatch(path: string, content: string): string {
  const lines =
    content.length === 0
      ? []
      : content.endsWith("\n")
        ? content.slice(0, -1).split("\n")
        : content.split("\n");
  const hunkLength = lines.length;
  const hunkRange = hunkLength === 0 ? "+0,0" : `+1,${hunkLength}`;
  const body = lines.map((line) => `+${line}`).join("\n");

  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 ${hunkRange} @@`,
    body,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function createMcpServer(
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  reviewCheckpoints: ReturnType<typeof createReviewCheckpointManager>,
): McpServer {
  const toolNames = toolNamesFor(config);
  const server = new McpServer(
    {
      name: APP_ID,
      title: APP_NAME,
      version: "0.1.0",
      description:
        "Codex-style local development harness for ChatGPT. Provides workspace-scoped file, search, edit, git, check, and bounded shell tools.",
    },
    {
      instructions: serverInstructions(config, toolNames),
    },
  );

  if (config.widgets !== "off") {
    registerAppResource(
      server,
      "Kastor Diff Card",
      WORKSPACE_APP_URI,
      {
        description: "Interactive card for viewing Kastor file diffs.",
        _meta: {
          ui: {
            csp: appCsp(config),
          },
        },
      },
      async () => {
        await assertWorkspaceAppAssets();
        return {
          contents: [
            {
              uri: WORKSPACE_APP_URI,
              mimeType: RESOURCE_MIME_TYPE,
              text: workspaceAppHtml(config),
              _meta: {
                ui: {
                  csp: appCsp(config),
                },
              },
            },
          ],
        };
      },
    );
  }

  registerAppTool(
    server,
    "open_workspace",
    {
      title: "Open workspace",
      description:
        "Open a local project directory as a coding workspace. Call this once per project folder or worktree before reading, editing, searching, writing, showing changes, or running commands. Reuse the returned workspaceId for later calls in the same folder; do not call open_workspace again unless switching folders/worktrees, changing checkout/worktree mode, the workspaceId is rejected as unknown, or the user explicitly asks to reopen. By default this opens the actual checkout; set mode=\"worktree\" when the user asks for an isolated or parallel coding session. Returns a workspaceId, loaded root project instructions, and nested instruction file paths the model should read before working in those directories.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Absolute path, or a leading-tilde home path such as ~/project, to a local project directory inside an allowed root.",
          ),
        mode: z
          .enum(["checkout", "worktree"])
          .optional()
          .describe(
            "Defaults to checkout. Use checkout to work in the actual directory. Use worktree to create an isolated managed Git worktree for parallel work.",
          ),
        baseRef: z
          .string()
          .optional()
          .describe("Git ref to base a worktree on. Only used with mode=\"worktree\". Defaults to HEAD."),
      },
      outputSchema: {
        workspaceId: z.string(),
        root: z.string(),
        mode: z.enum(["checkout", "worktree"]),
        sourceRoot: z.string().optional(),
        worktree: z
          .object({
            path: z.string(),
            baseRef: z.string(),
            baseSha: z.string(),
            dirtySource: z.boolean(),
            detached: z.boolean(),
            managed: z.boolean(),
          })
          .optional(),
        agentsFiles: z.array(workspaceAgentsFileOutputSchema),
        availableAgentsFiles: z.array(workspaceAvailableAgentsFileOutputSchema),
        contextDiscoveryTruncated: z.boolean(),
        skills: z.array(workspaceSkillOutputSchema),
        skillDiagnostics: z.array(z.unknown()),
        instruction: z.string(),
      },
      ...toolWidgetDescriptorMeta(config, "workspace"),
      annotations: { readOnlyHint: true },
    },
    async ({ path, mode, baseRef }) => {
      const startedAt = performance.now();
      const {
        workspace,
        agentsFiles,
        availableAgentsFiles,
        contextDiscoveryTruncated,
      } = await workspaces.openWorkspace({ path, mode, baseRef });
      if (config.widgets === "changes") {
        void reviewCheckpoints.initializeWorkspace({
          workspaceId: workspace.id,
          root: workspace.root,
        });
      }
      const visibleSkills = workspace.skills
        .filter((skill) => !skill.disableModelInvocation)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          path: formatPathForPrompt(skill.filePath),
        }));
      const loadedAgentsFiles = agentsFiles.map((file) => ({
        path: formatAgentsPath(file.path, workspace.root),
        content: file.content,
      }));
      const availableAgentsFileOutputs = availableAgentsFiles.map((file) => ({
        path: formatAgentsPath(file.path, workspace.root),
      }));
      const instruction = config.skillsEnabled
        ? "Use this workspaceId in all subsequent tool calls for this project. Do not call open_workspace again for this same folder unless this workspaceId stops working, the user asks to reopen, or you switch to a different folder/worktree. Follow loaded agentsFiles instructions. Before working under a path listed in availableAgentsFiles, read that instruction file. When a task matches an available skill in skills, read its path before proceeding."
        : "Use this workspaceId in all subsequent tool calls for this project. Do not call open_workspace again for this same folder unless this workspaceId stops working, the user asks to reopen, or you switch to a different folder/worktree. Follow loaded agentsFiles instructions. Before working under a path listed in availableAgentsFiles, read that instruction file.";
      const resultContent: ToolContent[] = [
        {
          type: "text" as const,
          text: [
            `Opened workspace ${workspace.id}`,
            `Root: ${workspace.root}`,
            `Mode: ${workspace.mode}`,
            loadedAgentsFiles.length > 0
              ? `Loaded project instructions: ${loadedAgentsFiles.map((file) => file.path).join(", ")}`
              : undefined,
            availableAgentsFileOutputs.length > 0
              ? `Available nested instructions: ${availableAgentsFileOutputs.map((file) => file.path).join(", ")}`
              : undefined,
            contextDiscoveryTruncated
              ? "Nested instruction discovery stopped early because the workspace is large. Use read, grep, glob, ls, or bash to inspect specific paths as needed."
              : undefined,
            visibleSkills.length > 0
              ? `Available skills: ${visibleSkills.map((skill) => skill.name).join(", ")}`
              : undefined,
            instruction,
          ].filter(Boolean).join("\n"),
        },
      ];
      logToolCall(config, {
        tool: "open_workspace",
        workspaceId: workspace.id,
        path: workspace.root,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        content: resultContent,
        _meta: {
          tool: "open_workspace",
          card: {
            workspaceId: workspace.id,
            root: workspace.root,
            path: workspace.root,
            summary: {
              agentsFiles: loadedAgentsFiles.length,
              availableAgentsFiles: availableAgentsFileOutputs.length,
              skills: visibleSkills.length,
              skillDiagnostics: workspace.skillDiagnostics.length,
            },
          },
        },
        structuredContent: {
          workspaceId: workspace.id,
          root: workspace.root,
          mode: workspace.mode,
          sourceRoot: workspace.sourceRoot,
          worktree: workspace.worktree,
          agentsFiles: loadedAgentsFiles,
          availableAgentsFiles: availableAgentsFileOutputs,
          contextDiscoveryTruncated,
          skills: visibleSkills,
          skillDiagnostics: workspace.skillDiagnostics,
          instruction,
        },
      };
    },
  );

  registerAppTool(
    server,
    toolNames.read,
    {
      title: "Read file",
      description:
        [
          "Read a file inside an open workspace. Use this for file inspection instead of shell commands like cat or sed. Call open_workspace first and pass workspaceId.",
          "Use this tool to inspect relevant AGENTS.md or CLAUDE.md files listed by open_workspace before working in nested directories.",
          config.skillsEnabled
            ? "If available skills were returned and a task matches one, read that skill's path before proceeding. Skill paths may be outside the workspace; only advertised SKILL.md files and files under already-loaded skill directories are readable."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe(
            config.skillsEnabled
              ? "File path to read, relative to the workspace root. May also be an advertised skill path from open_workspace skills."
              : "File path to read, relative to the workspace root.",
          ),
        offset: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-indexed line number to start reading from."),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of lines to read."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "read"),
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      const readPath = workspaces.resolveReadPath(workspace, input.path);
      const response = await readFileTool(
        { ...input, path: readPath.absolutePath },
        {
          cwd: workspace.root,
          root: workspace.root,
          readRoots: readPath.readRoots,
        },
      );

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.read,
          workspaceId,
          path: input.path,
        }, response.content, startedAt);
        return response;
      }
      workspaces.markReadPathLoaded(workspace, readPath);

      const summary = {
        ...textSummary(response.content),
        offset: input.offset ?? 1,
        limited: input.limit !== undefined,
      };
      logToolCall(config, {
        tool: toolNames.read,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        _meta: {
          tool: toolNames.read,
          card: {
            workspaceId,
            path: input.path,
            summary,
            payload: { content: response.content },
          },
        },
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  registerAppTool(
    server,
    toolNames.write,
    {
      title: "Write file",
      description:
        `Create or completely overwrite a file inside an open workspace. Prefer ${toolNames.edit} for targeted changes to existing files. Call open_workspace first and pass workspaceId.`,
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe("File path to write, relative to the workspace root."),
        content: z.string().describe("Complete new file content."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "write"),
      annotations: WRITE_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      workspaces.resolvePath(workspace, input.path);
      const response = await writeFileTool(input, {
        cwd: workspace.root,
        root: workspace.root,
      });

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.write,
          workspaceId,
          path: input.path,
        }, response.content, startedAt);
        return response;
      }

      const patch = newFilePatch(input.path, input.content);
      const stats = countDiffStats(patch);
      const summary = {
        ...stats,
        lines: contentLineCount(input.content),
        characters: input.content.length,
      };
      logToolCall(config, {
        tool: toolNames.write,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        _meta: {
          tool: toolNames.write,
          card: {
            workspaceId,
            path: input.path,
            summary,
            payload: {
              content: response.content,
              patch,
            },
          },
        },
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  registerAppTool(
    server,
    toolNames.edit,
    {
      title: "Edit file",
      description:
        `Edit one file inside an open workspace by replacing exact text blocks. Prefer this over ${toolNames.write} for targeted changes. Each oldText must match a unique, non-overlapping region of the original file; merge nearby changes into one edit and keep oldText as small as possible while still unique. Call open_workspace first and pass workspaceId.`,
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .describe("File path to edit, relative to the workspace root."),
        edits: z
          .array(
            z.object({
              oldText: z
                .string()
                .describe(
                  "Exact text to replace. Must match uniquely in the original file.",
                ),
              newText: z.string().describe("Replacement text."),
            }),
          )
          .min(1),
      },
      outputSchema: resultOutputSchema({
        status: z.literal("applied"),
      }),
      ...toolWidgetDescriptorMeta(config, "edit"),
      annotations: EDIT_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      workspaces.resolvePath(workspace, input.path);
      const response = await editFileTool(input, {
        cwd: workspace.root,
        root: workspace.root,
      });

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.edit,
          workspaceId,
          path: input.path,
        }, response.content, startedAt);
        return response;
      }

      const stats = countDiffStats(
        response.details?.patch ?? response.details?.diff,
      );
      const summary = {
        ...stats,
        editCount: input.edits.length,
      };
      const editResultText = `Edited ${input.path} (+${stats.additions} -${stats.removals}).`;
      const editContent = [textBlock(editResultText)];
      logToolCall(config, {
        tool: toolNames.edit,
        workspaceId,
        path: input.path,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        content: editContent,
        _meta: {
          tool: toolNames.edit,
          card: {
            workspaceId,
            path: input.path,
            summary,
            payload: {
              diff: response.details?.diff,
              patch: response.details?.patch,
            },
          },
        },
        structuredContent: {
          status: "applied",
          result: contentText(editContent),
        },
      };
    },
  );

  registerAppTool(
    server,
    toolNames.applyPatch,
    {
      title: "Apply patch",
      description:
        "Apply a unified diff patch inside an open workspace. Prefer this for Codex-style edits and multi-file changes. Patch paths must be relative to the workspace root and must not contain absolute paths or '..'. Call open_workspace first and pass workspaceId. Do not use shell to apply patches.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        patch: z
          .string()
          .describe("Unified diff patch to apply inside the workspace root."),
      },
      outputSchema: resultOutputSchema({
        status: z.literal("applied"),
        files: z.array(z.string()),
      }),
      ...toolWidgetDescriptorMeta(config, "patch"),
      annotations: EDIT_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const patchResult = await applyUnifiedPatch(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const stats = countDiffStats(input.patch);
        const content = [
          textBlock(`${patchResult.result} (+${stats.additions} -${stats.removals}).`),
        ];
        logToolCall(config, {
          tool: toolNames.applyPatch,
          workspaceId,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.applyPatch,
            card: {
              workspaceId,
              summary: {
                ...stats,
                files: patchResult.files.length,
              },
              payload: {
                patch: input.patch,
              },
            },
          },
          structuredContent: {
            status: "applied" as const,
            result: contentText(content),
            files: patchResult.files,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.applyPatch,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  if (config.widgets === "changes") {
    registerAppTool(
      server,
      "show_changes",
      {
        title: "Show changes",
        description:
          "Show aggregate file changes in an open workspace since the last shown checkpoint or since the workspace was opened. After you create, edit, or overwrite files, call this once when the related file changes are complete so the user can inspect the combined diff.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          since: z
            .enum(["last_shown", "workspace_open"])
            .optional()
            .describe("Defaults to last_shown. Use workspace_open to compare against the initial open_workspace checkpoint."),
          markReviewed: z
            .boolean()
            .optional()
            .describe("Defaults to true. When true, advances the last shown checkpoint to the current workspace state."),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "show_changes"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, since, markReviewed }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        const review = await reviewCheckpoints.reviewChanges({
          workspaceId,
          root: workspace.root,
          since: since ?? "last_shown",
          markReviewed: markReviewed ?? true,
        });

        const content = [textBlock(review.result)];
        logToolCall(config, {
          tool: "show_changes",
          workspaceId,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: "show_changes",
            card: {
              workspaceId,
              summary: review.summary,
              files: review.files,
              payload: {
                patch: review.patch,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
          },
        };
      },
    );
  }

  if (!config.minimalTools) {
    registerAppTool(
      server,
      toolNames.grep,
      {
        title: config.toolNaming === "short" ? "Grep" : "Grep files",
        description:
          "Search file contents inside an open workspace. Use this before broad reads when looking for symbols, text, or usage sites. Respects project ignore rules. Call open_workspace first and pass workspaceId.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          pattern: z.string().describe("Search pattern."),
          path: z
            .string()
            .optional()
            .describe(
              "Optional path or glob scope relative to the workspace root.",
            ),
          include: z.string().optional().describe("Optional include glob."),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "search"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, ...input }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        if (input.path) workspaces.resolvePath(workspace, input.path);
        const response = await grepFilesTool(input, {
          cwd: workspace.root,
          root: workspace.root,
        });

        if (response.isError) {
          logFailedToolResponse(config, {
            tool: toolNames.grep,
            workspaceId,
            path: input.path,
          }, response.content, startedAt);
          return response;
        }

        const summary = {
          pattern: input.pattern,
          scope: input.path ?? ".",
          ...textSummary(response.content),
        };
        logToolCall(config, {
          tool: toolNames.grep,
          workspaceId,
          path: input.path,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          ...response,
          _meta: {
            tool: toolNames.grep,
            card: {
              workspaceId,
              path: input.path,
              summary,
              payload: { content: response.content },
            },
          },
          structuredContent: {
            result: contentText(response.content),
          },
        };
      },
    );

    registerAppTool(
      server,
      toolNames.glob,
      {
        title: config.toolNaming === "short" ? "Glob" : "Find files",
        description:
          "Find files by glob pattern inside an open workspace. Use this to discover filenames or narrow file sets before reading. Respects project ignore rules. Call open_workspace first and pass workspaceId.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          pattern: z.string().describe("File glob pattern."),
          path: z
            .string()
            .optional()
            .describe("Optional path scope relative to the workspace root."),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "search"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, ...input }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        if (input.path) workspaces.resolvePath(workspace, input.path);
        const response = await findFilesTool(input, {
          cwd: workspace.root,
          root: workspace.root,
        });

        if (response.isError) {
          logFailedToolResponse(config, {
            tool: toolNames.glob,
            workspaceId,
            path: input.path,
          }, response.content, startedAt);
          return response;
        }

        const summary = {
          pattern: input.pattern,
          scope: input.path ?? ".",
          ...textSummary(response.content),
        };
        logToolCall(config, {
          tool: toolNames.glob,
          workspaceId,
          path: input.path,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          ...response,
          _meta: {
            tool: toolNames.glob,
            card: {
              workspaceId,
              path: input.path,
              summary,
              payload: { content: response.content },
            },
          },
          structuredContent: {
            result: contentText(response.content),
          },
        };
      },
    );

    registerAppTool(
      server,
      toolNames.ls,
      {
        title: config.toolNaming === "short" ? "Ls" : "List directory",
        description:
          "List a directory inside an open workspace. Use this for directory inspection and file/folder name listings before reading files. Prefer this over shell for Windows paths, Desktop folders, and Japanese filenames because it returns names through the filesystem API instead of terminal output. Call open_workspace first and pass workspaceId.",
        inputSchema: {
          workspaceId: z
            .string()
            .describe("Workspace identifier returned by open_workspace."),
          path: z
            .string()
            .describe(
              "Directory path to list, relative to the workspace root.",
            ),
        },
        outputSchema: resultOutputSchema(),
        ...toolWidgetDescriptorMeta(config, "directory"),
        annotations: { readOnlyHint: true },
      },
      async ({ workspaceId, ...input }) => {
        const startedAt = performance.now();
        const workspace = workspaces.getWorkspace(workspaceId);
        workspaces.resolvePath(workspace, input.path);
        const response = await listDirectoryTool(input, {
          cwd: workspace.root,
          root: workspace.root,
        });

        if (response.isError) {
          logFailedToolResponse(config, {
            tool: toolNames.ls,
            workspaceId,
            path: input.path,
          }, response.content, startedAt);
          return response;
        }

        const summary = textSummary(response.content);
        logToolCall(config, {
          tool: toolNames.ls,
          workspaceId,
          path: input.path,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          ...response,
          _meta: {
            tool: toolNames.ls,
            card: {
              workspaceId,
              path: input.path,
              summary,
              payload: { content: response.content },
            },
          },
          structuredContent: {
            result: contentText(response.content),
          },
        };
      },
    );
  }

  registerAppTool(
    server,
    toolNames.sizeTop,
    {
      title: "Size top",
      description:
        "Safely list the largest direct children under a file or folder inside an open workspace. Use this instead of shell for folder size, disk usage, cleanup-candidate, or largest-file questions. Read-only, bounded, and does not delete anything. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .optional()
          .describe("File or folder path relative to the workspace root. Defaults to the workspace root."),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("Number of largest direct children to return. Defaults to 10, max 50."),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .max(8)
          .optional()
          .describe("Maximum recursive depth used to estimate each entry size. Defaults to 4, max 8."),
      },
      outputSchema: resultOutputSchema({
        root: z.string(),
        entries: z.array(z.object({
          path: z.string(),
          type: z.enum(["file", "directory", "other"]),
          bytes: z.number(),
          size: z.string(),
          truncated: z.boolean(),
        })),
        truncated: z.boolean(),
        visited: z.number(),
      }),
      ...toolWidgetDescriptorMeta(config, "size"),
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await sizeTop(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.sizeTop,
          workspaceId,
          path: input.path ?? ".",
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.sizeTop,
            card: {
              workspaceId,
              path: input.path ?? ".",
              summary: {
                entries: response.entries.length,
                truncated: response.truncated,
                visited: response.visited,
              },
              payload: {
                result: response.result,
                entries: response.entries,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            root: response.root,
            entries: response.entries,
            truncated: response.truncated,
            visited: response.visited,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.sizeTop,
          workspaceId,
          path: input.path ?? ".",
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.gitStatus,
    {
      title: "Git status",
      description:
        "Show concise git status for an open workspace. Use this instead of shell for checking whether the working tree is clean before and after changes. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .optional()
          .describe("Optional path relative to the workspace root. Defaults to the workspace root."),
      },
      outputSchema: resultOutputSchema({
        root: z.string(),
        porcelain: z.string(),
        branch: z.string(),
        clean: z.boolean(),
      }),
      ...toolWidgetDescriptorMeta(config, "git"),
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await gitStatus(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.gitStatus,
          workspaceId,
          path: input.path ?? ".",
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.gitStatus,
            card: {
              workspaceId,
              path: input.path ?? ".",
              summary: {
                clean: response.clean,
                branch: response.branch,
              },
              payload: {
                result: response.result,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            root: response.root,
            porcelain: response.porcelain,
            branch: response.branch,
            clean: response.clean,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.gitStatus,
          workspaceId,
          path: input.path ?? ".",
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.gitDiff,
    {
      title: "Git diff",
      description:
        "Show git diff for an open workspace. Use this instead of shell for reviewing local changes before reporting or committing. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        path: z
          .string()
          .optional()
          .describe("Optional path relative to the workspace root. Defaults to the workspace root."),
        staged: z
          .boolean()
          .optional()
          .describe("When true, show staged changes with git diff --cached."),
        stat: z
          .boolean()
          .optional()
          .describe("When true, show diffstat instead of the full patch."),
      },
      outputSchema: resultOutputSchema({
        root: z.string(),
        diff: z.string(),
        truncated: z.boolean(),
      }),
      ...toolWidgetDescriptorMeta(config, "git"),
      annotations: { readOnlyHint: true },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await gitDiff(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.gitDiff,
          workspaceId,
          path: input.path ?? ".",
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.gitDiff,
            card: {
              workspaceId,
              path: input.path ?? ".",
              summary: {
                staged: input.staged ?? false,
                stat: input.stat ?? false,
                truncated: response.truncated,
              },
              payload: {
                diff: response.diff,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            root: response.root,
            diff: response.diff,
            truncated: response.truncated,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.gitDiff,
          workspaceId,
          path: input.path ?? ".",
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.gitStage,
    {
      title: "Git stage",
      description:
        "Stage or unstage reviewed changes in an open workspace, matching the Codex review flow. Use action=status to inspect the index, action=stage to stage paths or all changes, and action=unstage to unstage paths or all changes. This never reverts file contents. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        action: z
          .enum(["status", "stage", "unstage"])
          .describe("Use status to inspect, stage to add changes to the index, or unstage to remove changes from the index."),
        paths: z
          .array(z.string())
          .optional()
          .describe("File paths to stage or unstage, relative to the workspace root. Required unless all=true for stage/unstage."),
        all: z
          .boolean()
          .optional()
          .describe("When true, stage or unstage all workspace changes. For action=status this is ignored."),
      },
      outputSchema: resultOutputSchema({
        root: z.string(),
        action: z.enum(["status", "stage", "unstage"]),
        porcelain: z.string(),
        staged: z.array(z.string()),
        unstaged: z.array(z.string()),
        untracked: z.array(z.string()),
      }),
      ...toolWidgetDescriptorMeta(config, "git"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await gitStage(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.gitStage,
          workspaceId,
          path: input.paths?.join(",") ?? (input.all ? "<all>" : "."),
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.gitStage,
            card: {
              workspaceId,
              path: input.paths?.join(",") ?? (input.all ? "<all>" : "."),
              summary: {
                action: response.action,
                staged: response.staged.length,
                unstaged: response.unstaged.length,
                untracked: response.untracked.length,
              },
              payload: {
                result: response.result,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            root: response.root,
            action: response.action,
            porcelain: response.porcelain,
            staged: response.staged,
            unstaged: response.unstaged,
            untracked: response.untracked,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.gitStage,
          workspaceId,
          path: input.paths?.join(",") ?? (input.all ? "<all>" : "."),
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.gitCommit,
    {
      title: "Git commit",
      description:
        "Create a local Git commit from reviewed staged changes, matching the Codex review flow after staging. Use action=status to inspect commit readiness. Use action=commit with a non-empty message after reviewing changes. This never pushes to a remote and does not create empty commits. Pass stageAll=true only when the user wants all current changes included. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        action: z
          .enum(["status", "commit"])
          .describe("Use status to inspect commit readiness or commit to create a local commit."),
        message: z
          .string()
          .optional()
          .describe("Commit message. Required when action=commit."),
        stageAll: z
          .boolean()
          .optional()
          .describe("When true and action=commit, stage all current changes before committing. Defaults to false."),
      },
      outputSchema: resultOutputSchema({
        root: z.string(),
        action: z.enum(["status", "commit"]),
        committed: z.boolean(),
        commit: z.string().optional(),
        porcelain: z.string(),
        staged: z.array(z.string()),
        unstaged: z.array(z.string()),
        untracked: z.array(z.string()),
      }),
      ...toolWidgetDescriptorMeta(config, "git"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await gitCommit(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.gitCommit,
          workspaceId,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.gitCommit,
            card: {
              workspaceId,
              summary: {
                action: response.action,
                committed: response.committed,
                commit: response.commit,
                staged: response.staged.length,
                unstaged: response.unstaged.length,
                untracked: response.untracked.length,
              },
              payload: {
                result: response.result,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            root: response.root,
            action: response.action,
            committed: response.committed,
            commit: response.commit,
            porcelain: response.porcelain,
            staged: response.staged,
            unstaged: response.unstaged,
            untracked: response.untracked,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.gitCommit,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.gitPublish,
    {
      title: "Git publish preflight",
      description:
        "Inspect whether a local branch is ready for a future push or pull request step. This is a read-only preflight for the Codex review flow after stage and commit: it reports branch, upstream, remote URL, ahead/behind counts, commits that would be published, dirty working tree state, blockers, warnings, and required explicit approval. It never pushes, creates a pull request, or contacts the remote. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        action: z
          .enum(["preflight"])
          .describe("Only preflight is supported. It inspects readiness without publishing."),
        remote: z
          .string()
          .optional()
          .describe("Optional target remote name. Defaults to the upstream remote or origin."),
        branch: z
          .string()
          .optional()
          .describe("Optional target branch name. Defaults to the current branch."),
      },
      outputSchema: resultOutputSchema({
        root: z.string(),
        action: z.enum(["preflight"]),
        ready: z.boolean(),
        requiresApproval: z.boolean(),
        currentBranch: z.string(),
        targetRemote: z.string(),
        targetBranch: z.string(),
        upstream: z.string().optional(),
        remoteUrl: z.string().optional(),
        head: z.string(),
        porcelain: z.string(),
        staged: z.array(z.string()),
        unstaged: z.array(z.string()),
        untracked: z.array(z.string()),
        ahead: z.number(),
        behind: z.number(),
        commitsToPublish: z.array(z.string()),
        blockers: z.array(z.string()),
        warnings: z.array(z.string()),
        instructions: z.array(z.string()),
      }),
      ...toolWidgetDescriptorMeta(config, "git"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await gitPublish(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.gitPublish,
          workspaceId,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.gitPublish,
            card: {
              workspaceId,
              summary: {
                ready: response.ready,
                target: `${response.targetRemote}/${response.targetBranch}`,
                ahead: response.ahead,
                behind: response.behind,
                blockers: response.blockers.length,
                warnings: response.warnings.length,
              },
              payload: {
                result: response.result,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            root: response.root,
            action: response.action,
            ready: response.ready,
            requiresApproval: response.requiresApproval,
            currentBranch: response.currentBranch,
            targetRemote: response.targetRemote,
            targetBranch: response.targetBranch,
            upstream: response.upstream,
            remoteUrl: response.remoteUrl,
            head: response.head,
            porcelain: response.porcelain,
            staged: response.staged,
            unstaged: response.unstaged,
            untracked: response.untracked,
            ahead: response.ahead,
            behind: response.behind,
            commitsToPublish: response.commitsToPublish,
            blockers: response.blockers,
            warnings: response.warnings,
            instructions: response.instructions,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.gitPublish,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.runChecks,
    {
      title: "Run checks",
      description:
        "Run package verification scripts in an open workspace, such as typecheck, test, build, and lint. Use this instead of shell for normal post-edit verification. Defaults to available package.json scripts in the order typecheck, test, build, lint. Call open_workspace first and pass workspaceId.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        scripts: z
          .array(z.string())
          .optional()
          .describe("Optional package.json script names to run. Defaults to available typecheck, test, build, lint."),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(600)
          .optional()
          .describe("Timeout per script in seconds. Defaults to 300, max 600."),
      },
      outputSchema: resultOutputSchema({
        ok: z.boolean(),
        runs: z.array(z.object({
          script: z.string(),
          ok: z.boolean(),
          output: z.string(),
        })),
      }),
      ...toolWidgetDescriptorMeta(config, "checks"),
      annotations: CHECK_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await runChecks(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.runChecks,
          workspaceId,
          success: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          isError: response.ok ? undefined : true,
          _meta: {
            tool: toolNames.runChecks,
            card: {
              workspaceId,
              summary: {
                ok: response.ok,
                scripts: response.runs.map((run) => run.script),
              },
              payload: {
                runs: response.runs,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            ok: response.ok,
            runs: response.runs,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.runChecks,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.selfTest,
    {
      title: "Self test",
      description:
        "Run a lightweight Kastor workspace self-test. Use this when checking whether ChatGPT or another MCP host can reach Kastor and whether the current workspace has git and package verification scripts available. By default this does not run package scripts; pass runChecks=true when the user asks for verification.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        runChecks: z
          .boolean()
          .optional()
          .describe("When true, also run package verification scripts. Defaults to false."),
        scripts: z
          .array(z.string())
          .optional()
          .describe("Optional package.json script names to run when runChecks=true."),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(600)
          .optional()
          .describe("Timeout per script in seconds when runChecks=true. Defaults to 300, max 600."),
      },
      outputSchema: resultOutputSchema({
        ok: z.boolean(),
        checks: z.array(z.object({
          name: z.string(),
          ok: z.boolean(),
          detail: z.string(),
        })),
        expectedTools: z.array(z.string()),
        packageScripts: z.array(z.string()),
        checkRuns: z.array(z.object({
          script: z.string(),
          ok: z.boolean(),
          output: z.string(),
        })).optional(),
      }),
      ...toolWidgetDescriptorMeta(config, "self_test"),
      annotations: CHECK_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await selfTest({
          ...input,
          expectedTools: registeredToolNames(config, toolNames),
        }, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.selfTest,
          workspaceId,
          success: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          isError: response.ok ? undefined : true,
          _meta: {
            tool: toolNames.selfTest,
            card: {
              workspaceId,
              summary: {
                ok: response.ok,
                checks: response.checks.length,
              },
              payload: {
                checks: response.checks,
                expectedTools: response.expectedTools,
                packageScripts: response.packageScripts,
                checkRuns: response.checkRuns,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            ok: response.ok,
            checks: response.checks,
            expectedTools: response.expectedTools,
            packageScripts: response.packageScripts,
            checkRuns: response.checkRuns,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.selfTest,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.ruleCheck,
    {
      title: "Rule check",
      description:
        "Run a Codex-style hook/rule safety check for ChatGPT workflows. Use this before risky tool calls, after edits, or before final handoff. It evaluates events like PreToolUse, PostToolUse, UserPromptSubmit, and Stop, returning allow/warn/block plus evidence and next instructions. This is read-only and does not modify project files.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        event: z
          .enum(["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"])
          .describe("Codex-style lifecycle event to evaluate."),
        toolName: z
          .string()
          .optional()
          .describe("Tool being evaluated, such as bash, apply_patch, edit, write, or an MCP tool name."),
        command: z
          .string()
          .optional()
          .describe("Command text when checking shell use."),
        summary: z
          .string()
          .optional()
          .describe("Prompt or action summary for secret scanning and final review context."),
        checksPassed: z
          .boolean()
          .optional()
          .describe("For Stop checks, pass true only when relevant verification passed; false when checks failed."),
        reviewed: z
          .boolean()
          .optional()
          .describe("For Stop checks, whether the current diff has been reviewed or checkpointed."),
        userApproved: z
          .boolean()
          .optional()
          .describe("Whether the user explicitly approved a destructive-looking action."),
      },
      outputSchema: resultOutputSchema({
        decision: z.enum(["allow", "warn", "block"]),
        gates: z.array(z.object({
          name: z.string(),
          decision: z.enum(["allow", "warn", "block"]),
          detail: z.string(),
        })),
        instructions: z.array(z.string()),
        gitStatus: z.object({
          root: z.string(),
          porcelain: z.string(),
          branch: z.string(),
          clean: z.boolean(),
        }),
        diffStat: z.object({
          root: z.string(),
          diff: z.string(),
          truncated: z.boolean(),
        }),
      }),
      ...toolWidgetDescriptorMeta(config, "rule_check"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = await ruleCheck(input, {
          cwd: workspace.root,
          root: workspace.root,
        });
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.ruleCheck,
          workspaceId,
          success: true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.ruleCheck,
            card: {
              workspaceId,
              summary: {
                decision: response.decision,
                gates: response.gates.length,
              },
              payload: response,
            },
          },
          structuredContent: {
            result: contentText(content),
            decision: response.decision,
            gates: response.gates,
            instructions: response.instructions,
            gitStatus: response.gitStatus,
            diffStat: response.diffStat,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.ruleCheck,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerAppTool(
    server,
    toolNames.taskPlan,
    {
      title: "Task plan",
      description:
        "Persist or read a workspace task plan for autonomous multi-step development. Use this to save the current objective, ordered work items, progress, and resume notes so ChatGPT can continue after interruption or rate limits. Use action=checkpoint at start/progress/pre-review/final handoff points to summarize the saved plan, git status, diff stat, and optional package checks. Use action=review to create a Codex-style review packet with diff, gates, checks, and review instructions. Use action=resume after interruption, rate limits, or tool failures to get the next task, retry timing, git state, and recovery instructions. Use action=delegate to create Codex-style subagent/delegation packets for parallel read-heavy review, exploration, test planning, or triage while keeping ChatGPT as the required parent brain. Use action=summary to return a stable JSON work summary for non-interactive handoff to a CLI, scheduler, or another local agent. This writes only Kastor state, not project files.",
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        action: z
          .enum(["get", "set", "add_items", "update_item", "clear", "checkpoint", "review", "resume", "delegate", "summary"])
          .describe("get reads the current plan; set replaces it; add_items appends items; update_item changes one item; clear resets it; checkpoint summarizes plan/git/diff/check state; review creates a review packet; resume creates a recovery packet after interruptions; delegate creates subagent-style work packets; summary returns a stable JSON work summary for non-interactive handoff."),
        objective: z
          .string()
          .optional()
          .describe("Overall objective. Used with action=set."),
        items: z
          .array(z.object({
            id: z.string().optional(),
            text: z.string(),
            status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional(),
          }))
          .optional()
          .describe("Plan items for set or add_items."),
        itemId: z
          .string()
          .optional()
          .describe("Item id to update when action=update_item."),
        status: z
          .enum(["pending", "in_progress", "completed", "blocked"])
          .optional()
          .describe("New item status when action=update_item."),
        text: z
          .string()
          .optional()
          .describe("New item text when action=update_item."),
        note: z
          .string()
          .optional()
          .describe("Optional resume note to append to the plan."),
        phase: z
          .enum(["start", "progress", "pre_review", "final"])
          .optional()
          .describe("Checkpoint phase when action=checkpoint. Defaults to progress."),
        runChecks: z
          .boolean()
          .optional()
          .describe("When action=checkpoint or summary and true, also run package verification scripts. Defaults to false."),
        scripts: z
          .array(z.string())
          .optional()
          .describe("Optional package.json script names to run when action=checkpoint and runChecks=true."),
        timeoutSeconds: z
          .number()
          .int()
          .positive()
          .max(600)
          .optional()
          .describe("Timeout per script in seconds when action=checkpoint/review and runChecks=true. Defaults to 300, max 600."),
        includeDiff: z
          .boolean()
          .optional()
          .describe("When action=review, include the full git diff. Defaults to true."),
        failure: z
          .string()
          .optional()
          .describe("When action=resume, describe the failure or interruption that caused the pause."),
        retryAfterSeconds: z
          .number()
          .int()
          .positive()
          .max(86400)
          .optional()
          .describe("When action=resume, suggested seconds to wait before retrying a temporary failure. Max 86400."),
        delegates: z
          .array(z.object({
            id: z.string().optional(),
            role: z.string(),
            task: z.string(),
            mode: z.enum(["explore", "review", "test", "implement"]).optional(),
          }))
          .optional()
          .describe("When action=delegate, optional delegate packets to create. Defaults to reviewer/tester/maintainer."),
        waitForAll: z
          .boolean()
          .optional()
          .describe("When action=delegate, whether the parent should wait for every delegate result before consolidating. Defaults to true."),
      },
      outputSchema: resultOutputSchema({
        workspaceRoot: z.string(),
        objective: z.string(),
        items: z.array(z.object({
          id: z.string(),
          text: z.string(),
          status: z.enum(["pending", "in_progress", "completed", "blocked"]),
        })),
        notes: z.array(z.string()),
        updatedAt: z.string(),
        phase: z.enum(["start", "progress", "pre_review", "final"]).optional(),
        gitStatus: z.object({
          root: z.string(),
          porcelain: z.string(),
          branch: z.string(),
          clean: z.boolean(),
        }).optional(),
        diffStat: z.object({
          root: z.string(),
          diff: z.string(),
          truncated: z.boolean(),
        }).optional(),
        checks: z.object({
          ok: z.boolean(),
          runs: z.array(z.object({
            script: z.string(),
            ok: z.boolean(),
            output: z.string(),
          })),
        }).optional(),
        reviewGates: z.array(z.object({
          name: z.string(),
          ok: z.boolean(),
          detail: z.string(),
        })).optional(),
        reviewInstructions: z.array(z.string()).optional(),
        fullDiff: z.object({
          root: z.string(),
          diff: z.string(),
          truncated: z.boolean(),
        }).optional(),
        nextItems: z.array(z.object({
          id: z.string(),
          text: z.string(),
          status: z.enum(["pending", "in_progress", "completed", "blocked"]),
        })).optional(),
        retryAfterAt: z.string().optional(),
        resumeInstructions: z.array(z.string()).optional(),
        delegatePackets: z.array(z.object({
          id: z.string(),
          role: z.string(),
          task: z.string(),
          mode: z.enum(["explore", "review", "test", "implement"]),
          prompt: z.string(),
        })).optional(),
        orchestrationInstructions: z.array(z.string()).optional(),
        consolidationChecklist: z.array(z.string()).optional(),
        automationSummary: z.object({
          schemaVersion: z.literal(1),
          kind: z.literal("kastor.work_summary"),
          generatedAt: z.string(),
          workspaceRoot: z.string(),
          objective: z.string(),
          plan: z.object({
            updatedAt: z.string(),
            totalItems: z.number(),
            openItems: z.number(),
            completedItems: z.number(),
            blockedItems: z.number(),
            nextItems: z.array(z.object({
              id: z.string(),
              text: z.string(),
              status: z.enum(["pending", "in_progress", "completed", "blocked"]),
            })),
            recentNotes: z.array(z.string()),
          }),
          git: z.object({
            branch: z.string(),
            clean: z.boolean(),
            porcelain: z.string(),
          }),
          diffStat: z.string(),
          checks: z.object({
            requested: z.boolean(),
            ok: z.boolean().optional(),
            runs: z.array(z.object({
              script: z.string(),
              ok: z.boolean(),
              output: z.string(),
            })),
          }),
          recommendedNextActions: z.array(z.string()),
        }).optional(),
      }),
      ...toolWidgetDescriptorMeta(config, "task_plan"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ workspaceId, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);

      try {
        const response = input.action === "checkpoint"
          ? await workCheckpoint(input, {
            cwd: workspace.root,
            root: workspace.root,
            stateDir: config.stateDir,
          })
          : input.action === "review"
            ? await workReview(input, {
              cwd: workspace.root,
              root: workspace.root,
              stateDir: config.stateDir,
            })
            : input.action === "resume"
              ? await workResume(input, {
                cwd: workspace.root,
                root: workspace.root,
                stateDir: config.stateDir,
              })
              : input.action === "delegate"
                ? await workDelegate(input, {
                  cwd: workspace.root,
                  root: workspace.root,
                  stateDir: config.stateDir,
                })
                : input.action === "summary"
                  ? await workSummary(input, {
                    cwd: workspace.root,
                    root: workspace.root,
                    stateDir: config.stateDir,
                  })
          : await taskPlan({
            action: input.action,
            objective: input.objective,
            items: input.items,
            itemId: input.itemId,
            status: input.status,
            text: input.text,
            note: input.note,
          } satisfies TaskPlanInput, {
            stateDir: config.stateDir,
            workspaceRoot: workspace.root,
          });
        const plan = "plan" in response ? response.plan : response;
        const content = [textBlock(response.result)];
        logToolCall(config, {
          tool: toolNames.taskPlan,
          workspaceId,
          success: "checks" in response ? response.checks?.ok ?? true : true,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          content,
          _meta: {
            tool: toolNames.taskPlan,
            card: {
              workspaceId,
              summary: {
                action: input.action,
                items: plan.items.length,
                notes: plan.notes.length,
              },
              payload: {
                plan,
                checkpoint: "plan" in response ? response : undefined,
                review: "reviewGates" in response ? response : undefined,
                resume: "resumeInstructions" in response ? response : undefined,
                delegate: "delegatePackets" in response ? response : undefined,
                summary: "automationSummary" in response ? response.automationSummary : undefined,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            workspaceRoot: plan.workspaceRoot,
            objective: plan.objective,
            items: plan.items,
            notes: plan.notes,
            updatedAt: plan.updatedAt,
            phase: "phase" in response ? response.phase : undefined,
            gitStatus: "gitStatus" in response ? response.gitStatus : undefined,
            diffStat: "diffStat" in response ? response.diffStat : undefined,
            checks: "checks" in response ? response.checks : undefined,
            reviewGates: "reviewGates" in response ? response.reviewGates : undefined,
            reviewInstructions: "reviewInstructions" in response ? response.reviewInstructions : undefined,
            fullDiff: "fullDiff" in response ? response.fullDiff : undefined,
            nextItems: "nextItems" in response ? response.nextItems : undefined,
            retryAfterAt: "retryAfterAt" in response ? response.retryAfterAt : undefined,
            resumeInstructions: "resumeInstructions" in response ? response.resumeInstructions : undefined,
            delegatePackets: "delegatePackets" in response ? response.delegatePackets : undefined,
            orchestrationInstructions: "orchestrationInstructions" in response ? response.orchestrationInstructions : undefined,
            consolidationChecklist: "consolidationChecklist" in response ? response.consolidationChecklist : undefined,
            automationSummary: "automationSummary" in response ? response.automationSummary : undefined,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.taskPlan,
          workspaceId,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );

  registerComputerUseTool(server, config, toolNames);

  registerAppTool(
    server,
    toolNames.shell,
    {
      title: config.toolNaming === "short" ? "Bash" : "Run shell",
      description: config.minimalTools
        ? `Run a short shell command inside an open workspace. Use only for tests, builds, git inspection, package scripts, search, file discovery, and directory inspection. In minimal tool mode, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} are disabled; use simple bounded command-line tools such as grep, rg, find, ls, tree, dir, and where for read-only inspection. On Windows, prefer simple commands or explicit cmd /c commands; avoid complex PowerShell one-liners with nested quotes, script blocks, or variables unless there is no simpler command. Do not run whole-home recursive scans by default. Do not use ${toolNames.shell} to create or modify files. Do not use shell redirection, heredocs, tee, sed -i, perl -i, node/python/ruby scripts, or generated scripts to write project files; use ${toolNames.edit} for targeted changes and ${toolNames.write} for new files or full rewrites. Prefer ${toolNames.read} for direct file reads. Call open_workspace first and pass workspaceId. This is powerful local execution and should only be exposed behind strong authentication.`
        : `Run a short shell command inside an open workspace. Use only for tests, builds, git inspection, package scripts, and commands that are better executed by the shell. Do not use this for ordinary file/folder name listings; use ${toolNames.ls} instead, especially on Windows, Desktop folders, or Japanese filenames, because terminal output can be locale-dependent. On Windows, prefer simple commands or explicit cmd /c commands; avoid complex PowerShell one-liners with nested quotes, script blocks, or variables unless there is no simpler command. Do not run whole-home recursive scans by default. Do not use ${toolNames.shell} to create or modify files. Do not use shell redirection, heredocs, tee, sed -i, perl -i, node/python/ruby scripts, or generated scripts to write project files; use ${toolNames.edit} for targeted changes and ${toolNames.write} for new files or full rewrites. Prefer ${toolNames.read}, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} for file inspection. Call open_workspace first and pass workspaceId. This is powerful local execution and should only be exposed behind strong authentication.`,
      inputSchema: {
        workspaceId: z
          .string()
          .describe("Workspace identifier returned by open_workspace."),
        command: z
          .string()
          .describe(
            `Shell command to run. Must not create or modify project files; use ${toolNames.edit} or ${toolNames.write} for file changes.`,
          ),
        workingDirectory: z
          .string()
          .optional()
          .describe(
            "Optional working directory relative to the workspace root. Defaults to the workspace root.",
          ),
        timeout: z
          .number()
          .positive()
          .max(60)
          .optional()
          .describe("Timeout in seconds. Defaults to 20, max 60. Use 20 seconds or less for normal inspection."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: SHELL_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, workingDirectory, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      const cwd = workspaces.resolveWorkingDirectory(
        workspace,
        workingDirectory,
      );
      const response = await runShellTool(input, {
        cwd,
        root: workspace.root,
      });

      if (response.isError) {
        logFailedToolResponse(config, {
          tool: toolNames.shell,
          workspaceId,
          workingDirectory: workingDirectory ?? ".",
          command: input.command,
          commandLength: input.command.length,
        }, response.content, startedAt);
        return response;
      }

      const summary = {
        command: input.command,
        workingDirectory: workingDirectory ?? ".",
        ...textSummary(response.content),
      };
      logToolCall(config, {
        tool: toolNames.shell,
        workspaceId,
        workingDirectory: workingDirectory ?? ".",
        command: input.command,
        commandLength: input.command.length,
        success: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return {
        ...response,
        _meta: {
          tool: toolNames.shell,
          card: {
            workspaceId,
            path: workingDirectory,
            summary,
            payload: { content: response.content },
          },
        },
        structuredContent: {
          result: contentText(response.content),
        },
      };
    },
  );

  return server;
}

export function createServer(config = loadConfig()): RunningServer {
  const allowedHosts = config.allowedHosts.includes("*")
    ? undefined
    : Array.from(new Set([config.host, ...config.allowedHosts]));
  const app = createMcpExpressApp({
    host: config.host,
    ...(allowedHosts ? { allowedHosts } : {}),
  });
  const transports = new Map<string, Transport>();
  const mcpUrl = new URL("/mcp", config.publicBaseUrl);
  const resourceServerUrl = resourceUrlFromServerUrl(mcpUrl);
  const oauthProvider = new SingleUserOAuthProvider(config.oauth, mcpUrl, config.stateDir);
  const bearerAuth = requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: [config.oauth.scopes[0] ?? "devspace"],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });
  const workspaceStore = createWorkspaceStore(config.stateDir);
  const workspaces = new WorkspaceRegistry(config, workspaceStore);
  const reviewCheckpoints = createReviewCheckpointManager();

  if (config.logging.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;

    res.on("finish", () => {
      const path = requestPath(req);
      if (!config.logging.requests) return;
      if (!config.logging.assets && path.startsWith("/mcp-app-assets")) return;

      logEvent(config.logging, "info", "http_request", {
        requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
        ...requestLogFields(req, config),
      });
    });

    next();
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(config.publicBaseUrl),
      baseUrl: new URL(config.publicBaseUrl),
      resourceServerUrl,
      scopesSupported: config.oauth.scopes,
      resourceName: APP_NAME,
    }),
  );

  const oauthMetadata = createOAuthMetadata({
    provider: oauthProvider,
    issuerUrl: new URL(config.publicBaseUrl),
    baseUrl: new URL(config.publicBaseUrl),
    scopesSupported: config.oauth.scopes,
  });
  const protectedResourceMetadata = {
    resource: resourceServerUrl.href,
    authorization_servers: [config.publicBaseUrl],
    scopes_supported: config.oauth.scopes,
    resource_name: APP_NAME,
  };
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.json(oauthMetadata);
  });
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(protectedResourceMetadata);
  });

  app.options("/mcp-app-assets/{*asset}", (_req, res) => {
    setAssetHeaders(res);
    res.sendStatus(204);
  });

  app.use(
    "/mcp-app-assets",
    express.static(uiBuildDirectory(), {
      immutable: true,
      maxAge: "1y",
      fallthrough: false,
      setHeaders: setAssetHeaders,
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: APP_ID, title: APP_NAME });
  });

  app.all("/mcp", async (req, res) => {
    const requestId = res.locals.requestId as string | undefined;
    const sessionId = req.header("mcp-session-id");
    const initializeRequest = req.method === "POST" && isInitializeRequest(req.body);

    await new Promise<void>((resolve, reject) => {
      bearerAuth(req, res, (error?: unknown) => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (res.headersSent) return;

    if (!req.auth?.resource || !checkResourceAllowed({ requestedResource: req.auth.resource, configuredResource: resourceServerUrl })) {
      logEvent(config.logging, "warn", "auth_denied", {
        requestId,
        method: req.method,
        path: requestPath(req),
        reason: "invalid_oauth_resource",
        ...requestLogFields(req, config),
      });
      sendJsonRpcError(res, 401, -32001, "Unauthorized");
      return;
    }

    logEvent(config.logging, "debug", "mcp_request", {
      requestId,
      method: req.method,
      sessionIdPresent: Boolean(sessionId),
      sessionIdPrefix: sessionIdPrefix(sessionId),
      isInitialize: initializeRequest,
    });

    try {
      let transport: Transport | undefined;

      if (sessionId) {
        transport = transports.get(sessionId);
        if (!transport) {
          sendJsonRpcError(res, 404, -32000, "Unknown MCP session");
          return;
        }
      } else if (initializeRequest) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) transports.set(newSessionId, transport);
            logEvent(config.logging, "info", "mcp_session_created", {
              requestId,
              sessionIdPrefix: sessionIdPrefix(newSessionId),
              ...requestLogFields(req, config),
            });
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            transports.delete(closedSessionId);
            logEvent(config.logging, "info", "mcp_session_closed", {
              sessionIdPrefix: sessionIdPrefix(closedSessionId),
            });
          }
        };

        const server = createMcpServer(config, workspaces, reviewCheckpoints);
        await server.connect(transport);
      } else {
        sendJsonRpcError(res, 400, -32000, "No valid MCP session");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logEvent(config.logging, "error", "mcp_request_error", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  let closed = false;
  return {
    app,
    config,
    close: () => {
      if (closed) return;
      closed = true;
      oauthProvider.close();
      workspaceStore.close?.();
    },
  };
}

async function isMainModule(): Promise<boolean> {
  if (!process.argv[1]) return false;

  const modulePath = await realpath(fileURLToPath(import.meta.url));
  const entrypointPath = await realpath(process.argv[1]);
  return modulePath === entrypointPath;
}

if (await isMainModule()) {
  const { app, config, close } = createServer();
  const httpServer = app.listen(config.port, config.host, () => {
    console.log(
      `kastor listening on http://${config.host}:${config.port}/mcp`,
    );
    console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log("auth: oauth owner-token flow required");
    console.log(`logging: ${config.logging.level} ${config.logging.format}`);
    console.log(`request logging: ${config.logging.requests ? "enabled" : "disabled"}`);
    console.log(`asset logging: ${config.logging.assets ? "enabled" : "disabled"}`);
    console.log(`trust proxy: ${config.logging.trustProxy ? "enabled" : "disabled"}`);
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

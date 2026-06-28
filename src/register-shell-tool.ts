import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "./config.js";
import { runShellTool } from "./pi-tools.js";
import { ruleCheck } from "./rule-check.js";
import {
  SHELL_TOOL_ANNOTATIONS,
  toolWidgetDescriptorMeta,
  type ToolNames,
} from "./server-tool-meta.js";
import {
  contentText,
  logFailedToolResponse,
  logToolCall,
  resultOutputSchema,
  textBlock,
  textSummary,
} from "./server-tool-runtime.js";
import type { WorkspaceRegistry } from "./workspaces.js";

export function registerShellTool(
  server: McpServer,
  config: ServerConfig,
  toolNames: ToolNames,
  workspaces: WorkspaceRegistry,
): void {
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
        userApproved: z
          .boolean()
          .optional()
          .describe("Set true only when the user explicitly approved a risky shell action in the same turn."),
      },
      outputSchema: resultOutputSchema(),
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: SHELL_TOOL_ANNOTATIONS,
    },
    async ({ workspaceId, workingDirectory, userApproved, ...input }) => {
      const startedAt = performance.now();
      const workspace = workspaces.getWorkspace(workspaceId);
      const cwd = workspaces.resolveWorkingDirectory(
        workspace,
        workingDirectory,
      );
      const preflight = await ruleCheck({
        event: "PreToolUse",
        toolName: toolNames.shell,
        command: input.command,
        userApproved,
      }, {
        cwd: workspace.root,
        root: workspace.root,
      });
      if (preflight.decision === "block") {
        const content = [textBlock(preflight.result)];
        logFailedToolResponse(config, {
          tool: toolNames.shell,
          workspaceId,
          workingDirectory: workingDirectory ?? ".",
          command: input.command,
          commandLength: input.command.length,
        }, content, startedAt);
        return {
          content,
          isError: true,
          structuredContent: {
            result: contentText(content),
          },
        };
      }
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
}

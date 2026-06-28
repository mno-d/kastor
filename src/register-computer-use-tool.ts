import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { computerUse } from "./computer-use.js";
import type { ServerConfig } from "./config.js";
import {
  toolWidgetDescriptorMeta,
  type ToolNames,
} from "./server-tool-meta.js";
import {
  contentText,
  imageBlock,
  logFailedToolResponse,
  logToolCall,
  resultOutputSchema,
  textBlock,
  type ToolContent,
} from "./server-tool-runtime.js";

export function registerComputerUseTool(
  server: McpServer,
  config: ServerConfig,
  toolNames: ToolNames,
): void {
  registerAppTool(
    server,
    toolNames.computerUse,
    {
      title: "Computer Use",
      description:
        "Operate visible Windows apps when normal code, file, browser, or shell tools are insufficient. Supports list_windows, screenshot, activate, click, type_text, press_key, and launch_app. Use list_windows first, then pass a specific windowId. This tool blocks terminal apps, ChatGPT/Codex self-control, Windows-key shortcuts, security/privacy settings, authentication handoff tasks, and risky communication/destructive/permission/payment/install actions unless the user gave explicit action-time confirmation and confirmed=true is passed.",
      inputSchema: {
        action: z
          .enum(["list_windows", "screenshot", "activate", "click", "type_text", "press_key", "launch_app"])
          .describe("Computer Use action to perform."),
        windowId: z
          .number()
          .optional()
          .describe("Window id from list_windows. Required for screenshot, activate, click, type_text, and press_key."),
        app: z
          .string()
          .optional()
          .describe("App process/path filter for window selection, or executable path for launch_app."),
        title: z
          .string()
          .optional()
          .describe("Optional window title filter when selecting a window without windowId."),
        x: z
          .number()
          .optional()
          .describe("Window-relative x coordinate for click."),
        y: z
          .number()
          .optional()
          .describe("Window-relative y coordinate for click."),
        text: z
          .string()
          .optional()
          .describe("Literal text for type_text."),
        key: z
          .string()
          .optional()
          .describe("Key or chord for press_key, such as Return, Escape, Tab, Control_L+s, or Alt+F4. Windows-key shortcuts are blocked."),
        includeImage: z
          .boolean()
          .optional()
          .describe("For screenshot, include base64 image content. Defaults to true."),
        purpose: z
          .string()
          .optional()
          .describe("Short reason for the UI action. Required in practice for risky actions so safety checks can classify it."),
        confirmed: z
          .boolean()
          .optional()
          .describe("Set true only when the user gave explicit action-time confirmation for a risky UI action."),
      },
      outputSchema: resultOutputSchema({
        action: z.enum(["list_windows", "screenshot", "activate", "click", "type_text", "press_key", "launch_app"]),
        ok: z.boolean(),
        requiresConfirmation: z.boolean(),
        windows: z.array(z.object({
          id: z.number(),
          title: z.string(),
          processName: z.string(),
          processId: z.number(),
          path: z.string().optional(),
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        })).optional(),
        window: z.object({
          id: z.number(),
          title: z.string(),
          processName: z.string(),
          processId: z.number(),
          path: z.string().optional(),
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }).optional(),
        screenshot: z.object({
          width: z.number(),
          height: z.number(),
          mimeType: z.literal("image/png"),
          data: z.string().optional(),
        }).optional(),
        blockedReasons: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
      ...toolWidgetDescriptorMeta(config, "shell"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const startedAt = performance.now();

      try {
        const response = await computerUse(input);
        const content: ToolContent[] = [textBlock(response.result)];
        if (response.screenshot?.data) {
          content.push(imageBlock(response.screenshot.data, response.screenshot.mimeType));
        }
        logToolCall(config, {
          tool: toolNames.computerUse,
          success: response.ok,
          durationMs: Math.round(performance.now() - startedAt),
          error: response.ok ? undefined : response.blockedReasons.join("; "),
        });

        return {
          content,
          isError: !response.ok,
          _meta: {
            tool: toolNames.computerUse,
            card: {
              summary: {
                action: response.action,
                ok: response.ok,
                window: response.window ? `${response.window.processName}: ${response.window.title}` : undefined,
                windows: response.windows?.length,
                blockedReasons: response.blockedReasons.length,
                warnings: response.warnings.length,
              },
            },
          },
          structuredContent: {
            result: contentText(content),
            action: response.action,
            ok: response.ok,
            requiresConfirmation: response.requiresConfirmation,
            windows: response.windows,
            window: response.window,
            screenshot: response.screenshot
              ? {
                  width: response.screenshot.width,
                  height: response.screenshot.height,
                  mimeType: response.screenshot.mimeType,
                  data: response.screenshot.data,
                }
              : undefined,
            blockedReasons: response.blockedReasons,
            warnings: response.warnings,
          },
        };
      } catch (error) {
        const content = [textBlock(error instanceof Error ? error.message : String(error))];
        logFailedToolResponse(config, {
          tool: toolNames.computerUse,
        }, content, startedAt);
        return { content, isError: true };
      }
    },
  );
}

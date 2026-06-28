import type { ServerConfig, WidgetMode } from "./config.js";
import { WORKSPACE_APP_URI } from "./server-ui.js";

export const WRITE_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export const EDIT_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export const SHELL_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const CHECK_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export type ToolWidgetKind =
  | "workspace"
  | "read"
  | "write"
  | "edit"
  | "patch"
  | "search"
  | "directory"
  | "size"
  | "git"
  | "checks"
  | "self_test"
  | "task_plan"
  | "rule_check"
  | "shell"
  | "show_changes";

interface ToolDefinitionMeta extends Record<string, unknown> {
  securitySchemes: Array<{
    type: "oauth2";
    scopes: string[];
  }>;
  ui?: {
    resourceUri?: string;
    visibility: ["model"];
  };
}

type EmptyToolDefinitionMeta = Record<string, unknown> & {
  securitySchemes?: Array<{
    type: "oauth2";
    scopes: string[];
  }>;
  ui?: {
    visibility: ["model"];
  };
  "ui/resourceUri"?: string;
};

interface ToolWidgetDescriptorMeta {
  _meta: ToolDefinitionMeta | EmptyToolDefinitionMeta;
}

function shouldAttachWidget(mode: WidgetMode, kind: ToolWidgetKind): boolean {
  switch (mode) {
    case "off":
      return false;
    case "changes":
      return kind === "workspace" || kind === "show_changes";
    case "full":
      return true;
  }
}

export function toolWidgetDescriptorMeta(
  config: ServerConfig,
  kind: ToolWidgetKind,
): ToolWidgetDescriptorMeta {
  const oauthMeta = {
    securitySchemes: [
      {
        type: "oauth2" as const,
        scopes: config.oauth.scopes,
      },
    ],
    ui: {
      visibility: ["model"] as ["model"],
    },
    "openai/toolInvocation/invoking": "Running Kastor",
    "openai/toolInvocation/invoked": "Kastor finished",
  };

  if (!shouldAttachWidget(config.widgets, kind)) return { _meta: oauthMeta };

  return {
    _meta: {
      ...oauthMeta,
      ui: {
        ...oauthMeta.ui,
        resourceUri: WORKSPACE_APP_URI,
      },
    },
  };
}

export interface ToolNames {
  openWorkspace: "open_workspace";
  read: "read_file" | "read";
  write: "write_file" | "write";
  edit: "edit_file" | "edit";
  applyPatch: "apply_patch";
  grep: "grep_files" | "grep";
  glob: "find_files" | "glob";
  ls: "list_directory" | "ls";
  sizeTop: "size_top";
  gitStatus: "git_status";
  gitDiff: "git_diff";
  gitStage: "git_stage";
  gitCommit: "git_commit";
  gitPublish: "git_publish";
  runChecks: "run_checks";
  selfTest: "self_test";
  taskPlan: "task_plan";
  ruleCheck: "rule_check";
  computerUse: "computer_use";
  shell: "run_shell" | "bash";
}

export function toolNamesFor(config: ServerConfig): ToolNames {
  return config.toolNaming === "short"
    ? {
        openWorkspace: "open_workspace",
        read: "read",
        write: "write",
        edit: "edit",
        applyPatch: "apply_patch",
        grep: "grep",
        glob: "glob",
        ls: "ls",
        sizeTop: "size_top",
        gitStatus: "git_status",
        gitDiff: "git_diff",
        gitStage: "git_stage",
        gitCommit: "git_commit",
        gitPublish: "git_publish",
        runChecks: "run_checks",
        selfTest: "self_test",
        taskPlan: "task_plan",
        ruleCheck: "rule_check",
        computerUse: "computer_use",
        shell: "bash",
      }
    : {
        openWorkspace: "open_workspace",
        read: "read_file",
        write: "write_file",
        edit: "edit_file",
        applyPatch: "apply_patch",
        grep: "grep_files",
        glob: "find_files",
        ls: "list_directory",
        sizeTop: "size_top",
        gitStatus: "git_status",
        gitDiff: "git_diff",
        gitStage: "git_stage",
        gitCommit: "git_commit",
        gitPublish: "git_publish",
        runChecks: "run_checks",
        selfTest: "self_test",
        taskPlan: "task_plan",
        ruleCheck: "rule_check",
        computerUse: "computer_use",
        shell: "run_shell",
      };
}

export function registeredToolNames(config: ServerConfig, toolNames: ToolNames): string[] {
  const names: string[] = [
    toolNames.openWorkspace,
    toolNames.read,
    toolNames.write,
    toolNames.edit,
    toolNames.applyPatch,
    toolNames.sizeTop,
    toolNames.gitStatus,
    toolNames.gitDiff,
    toolNames.gitStage,
    toolNames.gitCommit,
    toolNames.gitPublish,
    toolNames.runChecks,
    toolNames.selfTest,
    toolNames.taskPlan,
    toolNames.ruleCheck,
    toolNames.computerUse,
    toolNames.shell,
  ];

  if (!config.minimalTools) {
    names.push(toolNames.grep, toolNames.glob, toolNames.ls);
  }
  if (config.widgets === "changes") {
    names.push("show_changes");
  }

  return [...new Set(names)].sort();
}

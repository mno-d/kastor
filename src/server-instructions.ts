import type { ServerConfig } from "./config.js";
import type { ToolNames } from "./server-tool-meta.js";

export function serverInstructions(config: ServerConfig, toolNames: ToolNames): string {
  const personalWholePcRoot = findWholePcRoot(config.allowedRoots);
  const personalWholePc =
    personalWholePcRoot
      ? `This Kastor server is configured as a trusted personal whole-PC profile. When the user asks about this PC, Desktop, Downloads, Documents, or does not name a narrower project folder, begin by calling ${toolNames.openWorkspace} with path ${personalWholePcRoot}. Do not ask the user to choose a folder first. Still require action-time confirmation before destructive, large overwrite, upload, external send, permission, install, payment, or publish actions. `
      : "";

  const inspection = config.minimalTools
    ? `In minimal tool mode, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} are disabled; use ${toolNames.shell} with short, bounded command-line tools such as grep, rg, find, ls, tree, dir, and where for search and directory inspection. `
    : `Prefer ${toolNames.read}, ${toolNames.grep}, ${toolNames.glob}, and ${toolNames.ls} for file inspection. `;

  const skills = config.skillsEnabled
    ? `When ${toolNames.openWorkspace} returns available skills and a task matches a skill, use ${toolNames.read} to read that skill's path before proceeding. Skill paths may be outside the workspace, but ${toolNames.read} only permits advertised SKILL.md files and files under already-loaded skill directories. `
    : "";

  const agentsMd = `Follow instructions returned by ${toolNames.openWorkspace}. Before working under a path listed in availableAgentsFiles, use ${toolNames.read} to inspect that instruction file and follow it. `;

  const showChanges =
    config.widgets === "changes"
      ? " After creating, editing, or overwriting files, call show_changes once after the related file changes are complete so the user can see the aggregate diff."
      : "";

  return `Use Kastor as a Codex-style local coding workspace for ChatGPT or another trusted MCP host. ${personalWholePc}Call ${toolNames.openWorkspace} once per project folder or worktree to obtain a workspaceId. Reuse that same workspaceId for all later file, search, edit, write, show-changes, git, check, self-test, task-plan, rule-check, and shell tools in that folder; do not call ${toolNames.openWorkspace} again unless switching folders/worktrees, changing checkout/worktree mode, the workspaceId is rejected as unknown, or the user explicitly asks to reopen. ${agentsMd}${skills}${inspection}Prefer ${toolNames.edit} for small targeted modifications, ${toolNames.applyPatch} for Codex-style unified diff edits or multi-file changes, ${toolNames.write} only for new files or complete rewrites, ${toolNames.gitStatus} and ${toolNames.gitDiff} for git inspection, ${toolNames.gitStage} for Codex review-style staging or unstaging after reviewing changes, ${toolNames.gitCommit} for local commits after reviewed changes are staged, ${toolNames.gitPublish} for safe publish preflight before any push or PR step, ${toolNames.runChecks} for typecheck/test/build verification, ${toolNames.selfTest} for a one-call health check of the current Kastor workspace, ${toolNames.taskPlan} for saving/resuming multi-step work and for start/progress/pre-review/final checkpoints, ${toolNames.ruleCheck} for Codex-style PreToolUse/PostToolUse/Stop safety gates, ${toolNames.computerUse} for Windows app and screen operation when code tools are insufficient, and ${toolNames.shell} only when no dedicated tool fits. Use ${toolNames.sizeTop} instead of shell for folder size, disk usage, cleanup-candidate, or largest-file questions. For coding tasks, work in the loop: inspect relevant files, save or update a ${toolNames.taskPlan} for multi-step work, call ${toolNames.ruleCheck} before risky shell use or final handoff, call ${toolNames.taskPlan} with action=checkpoint at major handoff points, modify with ${toolNames.applyPatch} or ${toolNames.edit}, run ${toolNames.runChecks} when package scripts exist, inspect ${toolNames.gitDiff}, optionally stage reviewed files with ${toolNames.gitStage}, optionally create a local commit with ${toolNames.gitCommit} when the user wants a commit, run ${toolNames.gitPublish} before any publish discussion, then report what changed and what passed. Use ${toolNames.computerUse} only for visible Windows UI tasks such as screenshot, app launch, activate, click, key press, and text entry; do not use it for terminal apps, ChatGPT/Codex self-control, authentication dialogs, Windows security/privacy settings, password managers, or actions that need explicit user confirmation unless that confirmation is present in the same turn. Never push or create a pull request without explicit user approval in the action-time turn. Keep ${toolNames.shell} calls short and bounded: inspect one directory or one question at a time, avoid recursive whole-home scans unless the user explicitly asks, and use timeout values of 20 seconds or less for normal inspection. Do not create or modify files with ${toolNames.shell}; avoid shell redirection, heredocs, tee, sed -i, perl -i, node/python/ruby scripts, or any command whose purpose is to write project files.${showChanges}`;
}

function findWholePcRoot(allowedRoots: string[]): string | undefined {
  return allowedRoots.find((root) => /^[A-Za-z]:\\?$/.test(root) || root === "/");
}

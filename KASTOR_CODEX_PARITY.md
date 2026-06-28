# Kastor Codex Parity Ledger

This file tracks how Kastor maps public Codex capabilities into one ChatGPT/MCP app.

## Sources

- OpenAI Codex OSS repository: https://github.com/openai/codex
- OpenAI Codex documentation: https://developers.openai.com/codex
- Codex App Server OSS path: https://github.com/openai/codex/tree/main/codex-rs/app-server
- Codex SDK OSS path: https://github.com/openai/codex/tree/main/sdk

## Current Codex OSS Delta Notes

- Codex has a first-class permission model with read/write/deny style filesystem rules. Kastor still has coarse `allowedRoots` plus action-time guidance. For this PC, `C:\` is intentionally allowed; for public/shared use, ship narrow roots by default.
- Codex server instructions are treated as server-wide guidance, and the beginning must be self-contained. Kastor instructions should keep the most important rule first: open the right workspace/root, use purpose-built tools before shell, and ask before destructive actions.
- Codex has stronger Windows sandbox concepts. Kastor does not currently provide a Codex-equivalent sandbox; safety comes from allowed roots, tool design, logs, and confirmation rules.
- Codex can run as a local agent surface and app server. Kastor is an MCP server for ChatGPT-style hosts, so some behavior differences come from the host model choosing when/how to call tools.
- Operational parity target: when the user asks about this PC, personal Kastor should feel like Codex on local files; when the user asks for public distribution, Kastor should default to a narrow, low-risk file scope.

## Public Codex Capability Map

| Capability | Kastor status | Notes |
| --- | --- | --- |
| Local workspace access | Implemented | `open_workspace` opens allowed local roots. |
| File read | Implemented | `read` / `read_file`. |
| File search | Implemented | `grep`, `glob`, `ls` when full tools are enabled; shell fallback in minimal mode. |
| Patch editing | Implemented | `apply_patch` applies unified diffs inside the workspace. |
| Targeted edit | Implemented | `edit` / `edit_file`. |
| File creation/overwrite | Implemented | `write` / `write_file`. |
| Git status | Implemented in current phase | `git_status`. |
| Git diff | Implemented in current phase | `git_diff`. |
| Git staging | Implemented in current phase | `git_stage` supports Codex review-style status, stage, and unstage operations without reverting file contents. |
| Local commit | Implemented in current phase | `git_commit` supports commit readiness checks and local commits after review/staging; it never pushes to a remote. |
| Publish preflight | Implemented in current phase | `git_publish(action=preflight)` checks branch, upstream, remote URL, ahead/behind counts, commits to publish, dirty state, blockers, warnings, and approval requirements without pushing or creating a pull request. |
| Test/build verification | Implemented in current phase | `run_checks` runs available package scripts. |
| Aggregate change review | Implemented | `show_changes` when widgets are set to `changes`. |
| Bounded shell | Implemented | `bash` remains as last resort. |
| Size and cleanup inspection | Implemented | `size_top` avoids risky shell scans. |
| Skills/instructions | Implemented | Reads AGENTS/CLAUDE and advertised skills. |
| Worktrees | Existing support | `open_workspace` has checkout/worktree mode. |
| ChatGPT real-machine use | Operational requirement | Verify through ChatGPT web, ChatGPT desktop, or another MCP host after MCP surface changes. |
| Windows autostart | Implemented in current phase | `scripts/install-kastor-autostart.ps1` registers an enabled `Kastor-Local` logon task for the fixed ngrok/ChatGPT client startup path. |
| Self-test tool | Implemented | `self_test` checks authenticated tool reachability, expected tool surface, git status, package scripts, and optional package verification runs. |
| Persistent task plan | Implemented in current phase | `task_plan` stores objective, ordered items, statuses, and resume notes per workspace in Kastor state. |
| Work checkpoints | Implemented in current phase | `task_plan(action=checkpoint)` summarizes saved plan state, git status, diff stat, and optional package checks for start/progress/pre-review/final handoffs without adding another visible app action. |
| Review workflow | Implemented in current phase | `task_plan(action=review)` creates a review packet with diff, checks, review gates, and review instructions for ChatGPT to review like Codex `/review`. |
| Rate-limit resume ledger | Implemented in current phase | `task_plan(action=resume)` records failure/retry context and returns next items, retry timing, git state, diff stat, optional checks, and recovery instructions. Automatic waiting is still handled by the controlling agent. |
| Subagents | Implemented in current phase | `task_plan(action=delegate)` creates Codex-style delegate packets for parallel read-heavy exploration, review, test planning, and triage while keeping ChatGPT as the required parent brain. |
| Non-interactive handoff summary | Implemented in current phase | `task_plan(action=summary)` returns a stable JSON work summary with plan counts, next items, git state, diff stat, optional checks, and recommended next actions for CLI, scheduler, or local-agent handoff. |
| Hooks/rules enforcement | Implemented in current phase | `rule_check` provides Codex-style PreToolUse, PostToolUse, UserPromptSubmit, and Stop gates for ChatGPT workflows. It returns allow/warn/block decisions without modifying project files. |
| Computer Use | Implemented in current phase | `computer_use` exposes Windows `list_windows`, `screenshot`, `activate`, `click`, `type_text`, `press_key`, and `launch_app` with safety blocks for terminal apps, ChatGPT/Codex self-control, Windows-key shortcuts, authentication/security handoff tasks, and risky actions without action-time confirmation. |
| Cloud task / PR creation | Out of scope for first phase | Requires GitHub/cloud credentials and explicit user approval. |

## Phase 1 Done Criteria

- The public README and publishing checklist describe the release state.
- MCP server identifies as Kastor.
- `apply_patch`, `size_top`, `git_status`, `git_diff`, and `run_checks` are available.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT connector metadata is refreshed.
- ChatGPT or another MCP host makes a real call to at least one newly added tool.

## Phase 2 Done Criteria

- `self_test` is available in ChatGPT after connector refresh.
- `self_test` reports authenticated reachability, expected tools, git status, and package scripts.
- Optional `self_test(runChecks=true)` can run selected package scripts.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `self_test`.

## Phase 3 Done Criteria

- `task_plan` is available in ChatGPT after connector refresh.
- `task_plan` can set, read, append, update, and clear a per-workspace plan.
- `task_plan` writes only Kastor state, not project files.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `task_plan`.

## Phase 4 Done Criteria

- `task_plan` includes `action=checkpoint` in ChatGPT after connector refresh.
- `task_plan(action=checkpoint)` returns the saved task plan, git status, diff stat, and optional package check results.
- `task_plan(action=checkpoint)` can append a resume note to Kastor state without changing project files.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `task_plan(action=checkpoint)`.

## Phase 5 Done Criteria

- `task_plan` includes `action=review` in ChatGPT after connector refresh.
- `task_plan(action=review)` returns a review packet with saved plan, git status, diff stat, optional full diff, checks, review gates, and review instructions.
- `task_plan(action=review)` can run selected package checks when requested.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `task_plan(action=review)`.

## Phase 6 Done Criteria

- `task_plan` includes `action=resume` in ChatGPT after connector refresh.
- `task_plan(action=resume)` records failure or retry context without changing project files.
- `task_plan(action=resume)` returns next task-plan items, retry timing, git status, diff stat, optional checks, and recovery instructions.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `task_plan(action=resume)`.

## Phase 7 Done Criteria

- `task_plan` includes `action=delegate` in ChatGPT after connector refresh.
- `task_plan(action=delegate)` records delegate context without changing project files.
- `task_plan(action=delegate)` returns delegate packets, orchestration instructions, consolidation checklist, git status, and diff stat.
- Delegation guidance matches current public Codex subagent guidance: explicit triggering, wait-for-results consolidation, read-heavy default, and caution with parallel write-heavy work.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `task_plan(action=delegate)`.

## Phase 8 Done Criteria

- `rule_check` is available in ChatGPT after connector refresh.
- `rule_check` returns allow/warn/block decisions, gates, instructions, git status, and diff stat.
- `rule_check(event=PreToolUse)` blocks shell-based file writes and destructive-looking commands unless the user explicitly approves the risk.
- `rule_check(event=UserPromptSubmit)` blocks obvious API-token-like prompt content.
- `rule_check(event=Stop)` warns or blocks when completion evidence is missing or checks are known failing.
- Guidance matches current public Codex hook/rule guidance: lifecycle events, matcher-like tool scope, conservative command handling, and most-restrictive decision wins.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts.
- ChatGPT makes a real call to `rule_check`.

## Phase 9 Done Criteria

- `scripts/install-kastor-autostart.ps1` registers an enabled `Kastor-Local` scheduled task.
- The task launches `scripts/start-kastor-and-chatgpt.ps1` with the fixed ngrok domain.
- Legacy `DevSpace-Local` autostart is disabled to avoid duplicate startup races.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts and `/healthz` responds through both local and public URLs.
- ChatGPT makes a real call to the current Kastor tool surface after the autostart hardening.

## Phase 10 Done Criteria

- `git_stage` is available in ChatGPT after connector refresh.
- `git_stage(action=status)` reports staged, unstaged, and untracked paths.
- `git_stage(action=stage)` stages only explicit `paths` or all changes when `all=true`.
- `git_stage(action=unstage)` unstages only explicit `paths` or all staged changes when `all=true`.
- `git_stage` rejects paths outside the workspace and does not revert file contents.
- Guidance matches current public Codex review guidance for staging and unstaging reviewed changes while keeping destructive revert out of this phase.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts and `/healthz` responds through both local and public URLs.
- ChatGPT makes a real call to `git_stage`.

## Phase 11 Done Criteria

- `git_commit` is available in ChatGPT after connector refresh.
- `git_commit(action=status)` reports local commit readiness without modifying files or Git history.
- `git_commit(action=commit)` requires a non-empty message and staged changes.
- `git_commit(action=commit, stageAll=true)` stages all current changes before creating a local commit.
- `git_commit` does not push to a remote and does not create empty commits.
- Guidance matches current public Codex review guidance for stage, commit, and push, while keeping push out of this local-only phase.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts and `/healthz` responds through both local and public URLs.
- ChatGPT makes a real call to `git_commit`.

## Phase 12 Done Criteria

- `task_plan` includes `action=summary` in ChatGPT after connector refresh.
- `task_plan(action=summary)` returns a stable `kastor.work_summary` JSON payload.
- The summary includes plan counts, next open items, recent notes, git branch/clean/porcelain state, diff stat, optional package checks, and recommended next actions.
- `task_plan(action=summary)` does not modify project files or Git history.
- Guidance matches current public Codex non-interactive guidance for machine-readable output and final-message handoff while keeping ChatGPT as the required reasoning surface.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts and `/healthz` responds through both local and public URLs.
- ChatGPT makes a real call to `task_plan(action=summary)`.

## Phase 13 Done Criteria

- `git_publish` is available in ChatGPT after connector refresh.
- `git_publish(action=preflight)` reports current branch, target remote/branch, upstream, remote URL, HEAD, ahead/behind counts, commits to publish, working tree/index state, blockers, warnings, and instructions.
- `git_publish(action=preflight)` never pushes, creates a pull request, contacts the remote, or modifies files or Git history.
- Dirty working trees, missing remotes, detached HEAD, missing target branches, and behind-upstream branches are reported as blockers.
- The output requires explicit action-time approval before any future push or PR creation.
- Guidance matches current public Codex review guidance for stage, commit, and push while keeping actual external publication out of this phase.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts and `/healthz` responds through both local and public URLs.
- ChatGPT makes a real call to `git_publish`.

## Phase 14 Done Criteria

- `computer_use` is available in ChatGPT after connector refresh.
- `computer_use(action=list_windows)` reports targetable Windows app windows.
- `computer_use(action=screenshot)` returns a window screenshot as image content plus structured metadata.
- `computer_use` supports `activate`, `click`, `type_text`, `press_key`, and `launch_app`.
- `computer_use` blocks terminal apps, ChatGPT/Codex self-control, Windows-key shortcuts, authentication/security handoff tasks, and risky UI actions unless action-time confirmation is present.
- `computer_use` is positioned as a Windows UI fallback when normal code/file/browser tools are insufficient, not as a replacement for dedicated code tools.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- Fixed ngrok service starts and `/healthz` responds through both local and public URLs.
- ChatGPT makes a real call to `computer_use`.

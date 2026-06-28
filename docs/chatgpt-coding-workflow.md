# ChatGPT Coding Workflow

Kastor brings a Codex-style coding-agent loop to ChatGPT and other MCP hosts:
inspect the repo, follow local instructions, make scoped edits, run
verification, and show the user what changed.

## Open One Workspace

ChatGPT should call `open_workspace` once for a project folder:

```json
{
  "path": "~/work/my-project"
}
```

The result includes a `workspaceId`. All later file, search, edit, show-changes,
and shell calls should reuse that same `workspaceId`.

Do not reopen the same folder unless:

- the `workspaceId` is rejected as unknown
- the user switches to another folder
- the user switches between checkout and worktree mode
- the user explicitly asks to reopen

## Checkout Mode

Checkout mode is the default. Kastor opens the actual directory:

```json
{
  "path": "~/work/my-project"
}
```

Use this when the user wants ChatGPT to work in the current checkout.

## Worktree Mode

Use worktree mode for isolated parallel work:

```json
{
  "path": "~/work/my-project",
  "mode": "worktree"
}
```

Managed worktrees are created under:

```text
~/.kastor/worktrees
```

Worktree mode requires a Git repository with at least one commit. It starts from
`HEAD` unless `baseRef` is provided.

Uncommitted source checkout changes are not copied into the managed worktree.
Kastor reports when the source checkout was dirty so the model can decide how
to proceed with the user.

## Project Instructions

When a workspace opens, Kastor loads root-level instruction files:

- `AGENTS.md`
- `AGENTS.MD`
- `CLAUDE.md`
- `CLAUDE.MD`

Nested instruction files are returned as `availableAgentsFiles`. The model
should read the relevant nested file before working under that directory.

This keeps instructions explicit and inspectable instead of silently injecting
new context during later tool calls.

## Skills

Skills are enabled by default for coding-agent workflows.

Kastor discovers skills from:

- `KASTOR_AGENT_DIR`, which defaults to `~/.codex`
- project `.pi/skills`
- optional paths from `KASTOR_SKILL_PATHS`

When `open_workspace` returns matching skills, the model should read the
advertised `SKILL.md` before following that skill.

Skill paths may be outside the workspace. Kastor only permits reading:

- advertised `SKILL.md` files
- files under a skill directory after that skill's `SKILL.md` has been read

Set `KASTOR_SKILLS=0` to hide skills from workspace output.

## Tool Names

Short names are the default:

- `open_workspace`
- `read`
- `write`
- `edit`
- `bash`

By default, Kastor also runs in `KASTOR_TOOL_MODE=minimal`, so dedicated
`grep`, `glob`, and `ls` tools are hidden. Use `bash` with command-line tools
such as `rg`, `find`, and `ls` for search and directory inspection.

Legacy names are available with `KASTOR_TOOL_NAMING=legacy`:

- `open_workspace`
- `read_file`
- `write_file`
- `edit_file`
- `run_shell`

Use `KASTOR_TOOL_MODE=full` to restore dedicated search and directory tools.

## Show Changes

By default, `KASTOR_WIDGETS=full`.

In that mode, Kastor attaches widget UI to the exposed workspace, file, edit,
and shell tools. The aggregate `show_changes` tool is not exposed by default.

Use `KASTOR_WIDGETS=off` to disable widget UI, or `KASTOR_WIDGETS=changes`
to expose the aggregate show-changes flow.

## Shell Use

The shell tool is for commands that belong in a terminal:

- tests
- builds
- git inspection
- package scripts
- environment checks

File writes should go through the edit/write tools rather than shell
redirection, heredocs, `tee`, `sed -i`, or generated scripts.

## ChatGPT Web Connection

1. Run `kastor doctor`.
2. Confirm the public MCP URL ends in `/mcp`.
3. Register that URL in ChatGPT.
4. Approve the Owner password in the Kastor approval page.
5. Ask ChatGPT to call `open_workspace` once for the project folder.
6. After changing Kastor tools or the public URL, reconnect or refresh the connector in ChatGPT.

## Risky Work

Kastor can edit local files inside configured roots. Deletions, large overwrites,
uploads, external sends, installs, permission changes, payments, and publishing
should be approved in the same turn before they happen.

For shell commands, Kastor also enforces this in code: commands that look like
installs, publishes, external sends, or destructive operations are blocked
unless the host passes `userApproved=true` after same-turn user approval.

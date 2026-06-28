# Troubleshooting Gotchas

This page collects the setup issues users are most likely to hit.

## `kastor` Command Not Found

Use `npx`:

```bash
npx kastor init
npx kastor serve
```

If you installed globally, confirm npm's global bin directory is on `PATH`.

## Unsupported Node Version

Kastor requires Node `>=20.12 <27`.

Check:

```bash
node --version
```

Install Node 22 LTS with your preferred version manager such as `nvm`, `fnm`, or
`mise`.

## `better-sqlite3` Could Not Load

This usually means native dependencies were installed under a different Node
runtime.

Try:

```bash
npm rebuild better-sqlite3
```

Then run:

```bash
npx kastor doctor
```

Release starts run a native dependency check before launching.

## Public URL Includes `/mcp`

Use the origin for setup:

```text
https://your-tunnel-host.example.com
```

Use the MCP endpoint in the client:

```text
https://your-tunnel-host.example.com/mcp
```

If you saved the wrong value:

```bash
npx kastor config set publicBaseUrl https://your-tunnel-host.example.com
```

## Tunnel URL Changed

Temporary tunnels often change URLs between runs.

For a one-off run:

```bash
KASTOR_PUBLIC_BASE_URL="https://new-tunnel.example.com" npx kastor serve
```

For a stable URL:

```bash
npx kastor config set publicBaseUrl https://kastor.example.com
```

## Host Header Or 403 Problems

Kastor derives allowed hosts from the configured public URL.

Run:

```bash
npx kastor doctor
```

Confirm the public URL hostname appears in allowed hosts. If you changed tunnel
URLs, update `publicBaseUrl`.

Use this only for intentional local debugging:

```bash
KASTOR_ALLOWED_HOSTS="*" npx kastor serve
```

## OAuth Redirect Host Rejected

By default, Kastor allows redirects for:

```text
chatgpt.com
localhost
127.0.0.1
```

If another MCP client uses a different redirect host, configure:

```bash
KASTOR_OAUTH_ALLOWED_REDIRECT_HOSTS="chatgpt.com,example.com" npx kastor serve
```

## Owner Password Not Accepted

Make sure you are entering the Owner password from:

```text
~/.kastor/auth.json
```

To regenerate setup:

```bash
npx kastor init --force
```

## Unknown `workspaceId`

`workspaceId` values are session identifiers. If the server restarts and the
client receives an unknown workspace error, call `open_workspace` again for that
project.

Workspace session metadata is persisted, but clients should still treat
`open_workspace` as the way to begin a fresh working session.

## Workspace Path Rejected

The path must be inside one of the allowed roots configured during setup.

Run:

```bash
npx kastor config get
```

Then either open a project under an allowed root or rerun setup:

```bash
npx kastor init --force
```

## Worktree Mode Fails

Worktree mode requires:

- Git installed
- the path is inside a Git repository
- the repository has at least one commit
- the requested `baseRef` resolves to a commit

For a new repository, create the first commit or use checkout mode.

Uncommitted source checkout changes are not copied into the managed worktree.
Commit, stash, or ask the model to work in checkout mode if those changes are
needed.

## Windows Shell Commands Fail

Kastor shell execution requires Bash. Native PowerShell and `cmd.exe` command
execution are not supported yet.

Install Git for Windows and use Git Bash, or use WSL, MSYS2, or Cygwin Bash.

Run:

```bash
npx kastor doctor
```

Confirm Bash is detected.

## Skills Do Not Appear

Skills are enabled by default. Check:

```bash
KASTOR_SKILLS=1 npx kastor serve
```

Kastor looks in:

- `KASTOR_AGENT_DIR`, defaulting to `~/.codex`
- project `.pi/skills`
- `KASTOR_SKILL_PATHS`

If a skill appears in `open_workspace`, the model must read that skill's
`SKILL.md` before reading other files inside the skill directory.

## Review Card Does Not Appear

Per-tool widget cards are enabled by default with:

```bash
KASTOR_WIDGETS=full
```

The aggregate `show_changes` tool is only exposed with
`KASTOR_WIDGETS=changes`. Plain MCP clients may ignore ChatGPT Apps widget
metadata and only show text results.

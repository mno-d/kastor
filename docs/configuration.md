# Configuration Reference

Kastor can be configured through `kastor init`, persisted config files, or
environment variables.

The default files are:

```text
~/.kastor/config.json
~/.kastor/auth.json
```

Use another config directory with:

```bash
KASTOR_CONFIG_DIR=/path/to/config npx kastor serve
```

## Commands

```bash
npx kastor init
npx kastor setup-guide
npx kastor serve
npx kastor doctor
npx kastor config get
npx kastor config set publicBaseUrl https://kastor.example.com
```

## Core Environment Variables

| Variable | Purpose |
| --- | --- |
| `HOST` | Local bind host. Defaults to `127.0.0.1`. |
| `PORT` | Local port. Defaults to `7676`. |
| `KASTOR_ALLOWED_ROOTS` | Comma-separated local roots that workspaces may open. |
| `KASTOR_PUBLIC_BASE_URL` | Public origin for the server, without `/mcp`. |
| `KASTOR_ALLOWED_HOSTS` | Optional Host header allowlist override. |
| `KASTOR_OAUTH_OWNER_TOKEN` | Owner password for OAuth approval. Must be at least 16 characters. |
| `KASTOR_WORKTREE_ROOT` | Directory for managed Git worktrees. Defaults to `~/.kastor/worktrees`. |
| `KASTOR_STATE_DIR` | Directory for SQLite state. Defaults to `~/.local/share/kastor`. |

## OAuth

Kastor uses a single-user OAuth approval flow.

| Variable | Default |
| --- | --- |
| `KASTOR_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` |
| `KASTOR_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` |
| `KASTOR_OAUTH_SCOPES` | `kastor` |
| `KASTOR_OAUTH_ALLOWED_REDIRECT_HOSTS` | `chatgpt.com,localhost,127.0.0.1` |

MCP clients discover metadata from:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

## Tool Modes

`KASTOR_TOOL_NAMING` controls tool names.

| Value | Behavior |
| --- | --- |
| `short` | Default. Uses `read`, `edit`, `bash`, and related names. |
| `legacy` | Uses `read_file`, `edit_file`, `run_shell`, and related names. |

`KASTOR_TOOL_MODE` controls the tool surface.

| Value | Behavior |
| --- | --- |
| `minimal` | Default. Disables dedicated search and list tools. Clients use the shell tool with `rg`, `grep`, `find`, `ls`, or `tree` for inspection. |
| `full` | Enables dedicated `grep`, `glob`, and `ls` tools. |

## Widgets

`KASTOR_WIDGETS` controls ChatGPT Apps iframe usage.

| Value | Behavior |
| --- | --- |
| `full` | Default. Widget UI is attached to exposed workspace, file, edit, and shell tools. |
| `changes` | Enables the aggregate `show_changes` tool and attaches widget UI to `open_workspace` and `show_changes`. |
| `off` | Disables widget UI. |

## Skills

| Variable | Purpose |
| --- | --- |
| `KASTOR_SKILLS` | Set to `0` to hide skills. Enabled by default. |
| `KASTOR_AGENT_DIR` | Defaults to `~/.codex`. |
| `KASTOR_SKILL_PATHS` | Optional comma-separated skill directories. |

Example:

```bash
KASTOR_SKILL_PATHS="$HOME/.codex/skills,$HOME/.claude/skills" \
npx kastor serve
```

## Logging

| Variable | Default |
| --- | --- |
| `KASTOR_LOG_LEVEL` | `info` |
| `KASTOR_LOG_FORMAT` | `json` |
| `KASTOR_LOG_REQUESTS` | `1` |
| `KASTOR_LOG_ASSETS` | `0` |
| `KASTOR_LOG_TOOL_CALLS` | `1` |
| `KASTOR_LOG_SHELL_COMMANDS` | `0` |
| `KASTOR_TRUST_PROXY` | `0` |

Set `KASTOR_LOG_FORMAT=pretty` for local debugging.

Set `KASTOR_LOG_SHELL_COMMANDS=1` only when you intentionally want command
previews in logs.

## Env-Only Example

```bash
KASTOR_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)" \
KASTOR_ALLOWED_ROOTS="$HOME/personal,$HOME/work" \
KASTOR_PUBLIC_BASE_URL="https://kastor.example.com" \
KASTOR_WORKTREE_ROOT="$HOME/.kastor/worktrees" \
KASTOR_TOOL_MODE="minimal" \
KASTOR_TOOL_NAMING="short" \
KASTOR_WIDGETS="changes" \
npx kastor serve
```

The environment assignments must be part of the same command invocation, or
exported first.

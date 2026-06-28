# Setup Guide

This guide is for users who want ChatGPT or another MCP host to work in local
projects through Kastor.

## Requirements

- Node `>=20.12 <27`; Node 22 LTS is recommended
- npm
- Git
- Bash, including Git Bash or WSL on Windows
- a public HTTPS URL that forwards to the local Kastor server

Kastor does not create the public tunnel for you. Use Cloudflare Tunnel,
ngrok, Pinggy, Tailscale Funnel, or your own HTTPS reverse proxy.

## Install And Configure

Run:

```bash
kastor init
kastor doctor
```

The setup flow asks one question at a time. If you are unsure what to choose,
run:

```bash
kastor setup-guide
```

## Permission Preset

Choose one:

- `project`: current project only. Safest first run.
- `projects`: one or more project folders.
- `power`: broader private-machine access. Not for public/shared examples.

### Project Roots

Choose the folders ChatGPT is allowed to open through Kastor. Keep this
narrow.

Examples:

```text
~/personal,~/work
```

```text
/Users/alice/dev,/Users/alice/work
```

```text
C:\Users\alice\dev,C:\Users\alice\work
```

### Local Port

The default is `7676`.

The local MCP URL is:

```text
http://127.0.0.1:7676/mcp
```

### Public Base URL

Start your tunnel or reverse proxy before entering this value. Point the tunnel
at:

```text
http://127.0.0.1:7676
```

Enter the public origin without `/mcp`:

```text
https://your-tunnel-host.example.com
```

Configure the MCP client with the full MCP endpoint:

```text
https://your-tunnel-host.example.com/mcp
```

## Start The Server

Run:

```bash
kastor serve
```

If your tunnel URL changes for one run, override it without rewriting config:

```bash
KASTOR_PUBLIC_BASE_URL="https://new-tunnel.example.com" kastor serve
```

For a stable public URL, persist it:

```bash
kastor config set publicBaseUrl https://kastor.example.com
kastor serve
```

## Approve The Client

When ChatGPT, Claude, or another MCP client connects, Kastor shows an Owner
password approval page. Enter the Owner password printed during setup.

The default config files are:

```text
~/.devspace/config.json
~/.devspace/auth.json
```

Keep `auth.json` private.

## Check Your Setup

Run:

```bash
kastor doctor
```

The doctor command reports the resolved config, Node version, Node ABI, platform,
Git, Bash, public URL, allowed hosts, and SQLite native dependency status.

## Running From A Local Checkout

If you are developing Kastor itself instead of using the published package:

```bash
npm install --include=dev
npm run dev
```

The same setup rules apply.

## ChatGPT Web

ChatGPT web can connect to remote MCP servers through ChatGPT Apps/connectors when the feature is available for your workspace. Use the public HTTPS MCP endpoint:

```text
https://your-tunnel-host.example.com/mcp
```

After connecting, approve the Kastor owner password page, then refresh connector metadata whenever tools or descriptions change. If your ChatGPT plan or workspace does not expose custom MCP/App connectors, use another MCP-capable host or wait until the capability is available for that workspace.

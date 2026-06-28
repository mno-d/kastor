# Publishing Checklist

Use this before sharing Kastor publicly.

## Supported Clients

Kastor is an MCP server. It can be used from ChatGPT web, ChatGPT Desktop, Claude, or another MCP-capable host when that host supports remote HTTP MCP servers and OAuth.

ChatGPT web availability depends on the user's ChatGPT plan and workspace settings. If custom MCP/App connectors are not visible in ChatGPT, Kastor is still valid as an MCP server, but that ChatGPT account cannot connect it yet.

## Do Not Publish

Do not publish:

- `.env`
- `.devspace/auth.json`
- real owner tokens
- real tunnel domains tied to a private machine
- logs under `~/.devspace`
- broad allowed roots such as `C:\`, `/`, or a whole home folder

## Preflight

Run:

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
npm pack --dry-run
```

Check for obvious secrets:

```bash
git grep -n "sk-\\|xoxb\\|ghp_\\|GHp"
```

The grep may return documentation examples. It must not return a real token or a private tunnel URL.

## Windows ChatGPT App Outage Fallback

If the Windows ChatGPT Desktop app is broken, start Kastor with ChatGPT web:

```powershell
.\scripts\start-kastor-and-chatgpt.ps1 `
  -NgrokDomain "your-domain.example.com" `
  -ChatGptClient chrome
```

This opens `https://chatgpt.com` with a dedicated Chrome profile. Connect the same public MCP endpoint from ChatGPT:

```text
https://your-domain.example.com/mcp
```

## Publish

Publish only after the preflight passes and the package contents are clean:

```bash
npm publish --access public
```

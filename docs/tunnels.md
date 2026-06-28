# Tunnel Setup

Remote MCP clients need a public HTTPS URL that forwards to Kastor.

Kastor itself listens locally:

```text
http://127.0.0.1:7676
```

The MCP endpoint exposed to the client is:

```text
https://your-domain.example.com/mcp
```

Use the origin only for `KASTOR_PUBLIC_BASE_URL`:

```text
https://your-domain.example.com
```

## Options

| Option | Good For | Notes |
| --- | --- | --- |
| ngrok | easiest stable public URL | Use a reserved domain for fewer reconnects. |
| Cloudflare Tunnel | Cloudflare users | Add Cloudflare Access if you want another identity layer. |
| Tailscale Funnel | private identity-oriented setups | Good when all users are in your tailnet. |
| Reverse proxy | servers you control | Best for production-style hosting. |

## ngrok Example

```bash
ngrok http --domain=your-domain.example.com 7676
KASTOR_PUBLIC_BASE_URL=https://your-domain.example.com kastor serve
```

## Cloudflare Tunnel Example

```bash
cloudflared tunnel --url http://127.0.0.1:7676
KASTOR_PUBLIC_BASE_URL=https://your-cloudflare-url.example.com kastor serve
```

## After Starting The Tunnel

Run:

```bash
kastor doctor
```

Then connect your MCP host to:

```text
https://your-domain.example.com/mcp
```

Approve the Owner password only for clients you trust.

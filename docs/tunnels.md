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

If you only want the fastest test, use ngrok or a quick Cloudflare Tunnel.
If you want a URL that keeps working tomorrow, use a reserved ngrok domain,
a named Cloudflare Tunnel, or your own reverse proxy.

## ngrok Example

```bash
ngrok http --domain=your-domain.example.com 7676
KASTOR_PUBLIC_BASE_URL=https://your-domain.example.com kastor serve
```

Quick temporary test:

```bash
ngrok http 7676
KASTOR_PUBLIC_BASE_URL=https://the-ngrok-url.example.ngrok-free.app kastor serve
```

## Cloudflare Tunnel Example

```bash
cloudflared tunnel --url http://127.0.0.1:7676
KASTOR_PUBLIC_BASE_URL=https://your-cloudflare-url.example.com kastor serve
```

Temporary Cloudflare URLs change. If ChatGPT stops connecting after a restart,
run `kastor config set publicBaseUrl https://new-url.example.com`, restart
Kastor, then reconnect the ChatGPT connector.

## Tailscale Funnel Example

```bash
tailscale funnel 7676
KASTOR_PUBLIC_BASE_URL=https://your-device.your-tailnet.ts.net kastor serve
```

Use this when the client can reach your tailnet URL.

## Reverse Proxy Shape

Forward HTTPS traffic from your domain to:

```text
http://127.0.0.1:7676
```

Then run:

```bash
KASTOR_PUBLIC_BASE_URL=https://kastor.example.com kastor serve
```

Do not expose another service on the same path as `/mcp`.

## After Starting The Tunnel

Run:

```bash
kastor doctor
```

Check that:

- the ChatGPT MCP endpoint ends with `/mcp`
- the public base URL is HTTPS and has no `/mcp`
- the allowed hosts match the tunnel host
- the allowed roots are not your whole machine

Then connect your MCP host to:

```text
https://your-domain.example.com/mcp
```

Approve the Owner password only for clients you trust.

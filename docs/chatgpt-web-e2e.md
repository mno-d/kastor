# ChatGPT Web E2E Check

This page is a practical checklist for checking Kastor from ChatGPT Web.

The repository tests verify the MCP and OAuth endpoints. This checklist verifies
the real browser connection.

## Before Opening ChatGPT

Run:

```bash
kastor doctor
kastor public-check
kastor serve
```

Check these values:

- `ChatGPT MCP endpoint` ends with `/mcp`
- `KASTOR_PUBLIC_BASE_URL` does not end with `/mcp`
- The public URL is HTTPS
- The allowed roots point to a small test project first

## In ChatGPT

1. Add a custom MCP connector.
2. Paste the endpoint shown by `kastor doctor`.
3. Approve the Kastor Owner password page.
4. Ask ChatGPT to open a tiny test workspace.
5. Ask it to read one harmless file.
6. Ask it to run `self_test`.
7. Only then use a real project.

## What A Good First Test Looks Like

Ask:

```text
Open the test workspace, list the top-level files, read README.md, then run self_test.
Do not edit anything.
```

A good result should mention the files it saw and the self-test result. It should
not ask for access to your whole home folder.

## If It Fails

- If ChatGPT cannot reach the server, check the tunnel first.
- If the Owner password page does not open, check the public URL and allowed hosts.
- If tools appear stale, reconnect the connector in ChatGPT.
- If file access fails, check `KASTOR_ALLOWED_ROOTS`.

For server-side debugging, run:

```bash
kastor doctor --json
```


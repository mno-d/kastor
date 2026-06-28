import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const configDir = mkdtempSync(join(tmpdir(), "kastor-e2e-config-"));
const stateDir = mkdtempSync(join(tmpdir(), "kastor-e2e-state-"));
const workspaceRoot = mkdtempSync(join(tmpdir(), "kastor-e2e-workspace-"));

const config = loadConfig({
  KASTOR_CONFIG_DIR: configDir,
  KASTOR_ALLOWED_ROOTS: workspaceRoot,
  KASTOR_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  KASTOR_PUBLIC_BASE_URL: "http://127.0.0.1:7676",
  KASTOR_STATE_DIR: stateDir,
  KASTOR_WIDGETS: "off",
  KASTOR_LOG_REQUESTS: "0",
  KASTOR_LOG_TOOL_CALLS: "0",
});

const running = createServer(config);
const httpServer = running.app.listen(0, "127.0.0.1");

try {
  await new Promise<void>((resolve) => httpServer.once("listening", resolve));
  const address = httpServer.address() as AddressInfo | null;
  if (!address) throw new Error("Test server did not expose a listen address.");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, name: "kastor", title: "Kastor" });

  const openId = await fetch(`${baseUrl}/.well-known/openid-configuration`);
  assert.equal(openId.status, 200);
  const openIdBody = await openId.json() as { issuer?: string };
  assert.equal(openIdBody.issuer, `${config.publicBaseUrl}/`);

  const protectedResource = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
  assert.equal(protectedResource.status, 200);
  const protectedBody = await protectedResource.json() as { resource_name?: string };
  assert.equal(protectedBody.resource_name, "Kastor");

  const assetPreflight = await fetch(`${baseUrl}/mcp-app-assets/anything.js`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://chatgpt.com",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(assetPreflight.status, 204);
  assert.equal(assetPreflight.headers.get("access-control-allow-origin"), "*");

  const mcpWithoutAuth = await fetch(`${baseUrl}/mcp`, { method: "POST" });
  assert.equal(mcpWithoutAuth.status, 401);

  const mcpUnknownSession = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: "Bearer invalid",
      "mcp-session-id": "missing-session",
    },
  });
  assert.equal(mcpUnknownSession.status, 401);
} finally {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
  });
  running.close();
}

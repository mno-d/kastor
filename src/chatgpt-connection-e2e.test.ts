import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const configDir = mkdtempSync(join(tmpdir(), "kastor-chatgpt-e2e-config-"));
const stateDir = mkdtempSync(join(tmpdir(), "kastor-chatgpt-e2e-state-"));
const workspaceRoot = mkdtempSync(join(tmpdir(), "kastor-chatgpt-e2e-workspace-"));

const config = loadConfig({
  KASTOR_CONFIG_DIR: configDir,
  KASTOR_ALLOWED_ROOTS: workspaceRoot,
  KASTOR_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  KASTOR_PUBLIC_BASE_URL: "https://kastor.example.test",
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

  const protectedResource = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
  assert.equal(protectedResource.status, 200);
  const protectedBody = await protectedResource.json() as {
    resource?: string;
    authorization_servers?: string[];
    scopes_supported?: string[];
    resource_name?: string;
  };
  assert.equal(protectedBody.resource, "https://kastor.example.test/mcp");
  assert.deepEqual(protectedBody.authorization_servers, ["https://kastor.example.test"]);
  assert.equal(protectedBody.resource_name, "Kastor");
  assert.ok(protectedBody.scopes_supported?.length);

  const openId = await fetch(`${baseUrl}/.well-known/openid-configuration`);
  assert.equal(openId.status, 200);
  const openIdBody = await openId.json() as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
  };
  assert.equal(openIdBody.issuer, "https://kastor.example.test/");
  assert.match(openIdBody.authorization_endpoint ?? "", /^https:\/\/kastor\.example\.test\//);
  assert.match(openIdBody.token_endpoint ?? "", /^https:\/\/kastor\.example\.test\//);

  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as { ok?: boolean }).ok, true);

  const invalidMcp = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "chatgpt-e2e", version: "0.0.0" },
      },
    }),
  });
  assert.equal(invalidMcp.status, 401);
} finally {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
  });
  running.close();
}

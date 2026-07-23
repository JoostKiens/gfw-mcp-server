import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

import { createGfwClient } from "./gfw-client/client.js";
import { registerFindVesselsTool } from "./tools/find-vessels.js";

// Shared across every McpServer instance so Ajv's setup (registering ajv-formats)
// happens once per process rather than once per HTTP request.
const jsonSchemaValidator = new AjvJsonSchemaValidator();

// Constructed once per process, at module scope — shared across every
// createMcpServer() call, including the HTTP transport's per-request McpServer
// instances. Constructing it inside the factory below would break any tool that
// depends on process-lifetime state (queues, caches per architecture.md).
const gfwClient = createGfwClient();

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "gfw-mcp-server", version: "0.1.0" }, { jsonSchemaValidator });
  registerFindVesselsTool(server, gfwClient);
  return server;
}

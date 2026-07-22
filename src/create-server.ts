import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";

// Shared across every McpServer instance so Ajv's setup (registering ajv-formats)
// happens once per process rather than once per HTTP request.
const jsonSchemaValidator = new AjvJsonSchemaValidator();

// ponytail: tool registration is stateless today (no tools exist yet), so a fresh
// McpServer per call is fine — required for the HTTP transport's per-request use.
// If a process-lifetime singleton (report queue, caches per architecture.md) is
// ever needed, construct it at module scope here and inject it into tool closures,
// not inside this factory — constructing it per-call would break the queue's
// single-concurrency guarantee across concurrent HTTP requests.
export function createMcpServer(): McpServer {
  return new McpServer({ name: "gfw-mcp-server", version: "0.1.0" }, { jsonSchemaValidator });
}

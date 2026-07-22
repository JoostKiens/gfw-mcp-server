import http from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpServer } from "../create-server.js";

export async function startHttp(options: { port: number }): Promise<Server> {
  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Stateless mode: the SDK requires a fresh transport (and server) per request.
      // No pre-parsed body is passed — the SDK reads and JSON-parses the request
      // itself, correctly, with proper Content-Type checks and JSON-RPC error shapes.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => transport.close());
      await createMcpServer().connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    }
  });

  httpServer.listen(options.port, () => {
    console.log(`GFW MCP (http) listening on ${options.port}`);
  });

  return httpServer;
}

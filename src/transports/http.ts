import http from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";

type MCPRequest = { method?: string; params?: unknown; id?: string | number };

export function startHttp(options: { port: number }): Server {
  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("Only POST supported\n");
      return;
    }

    let body = "";
    for await (const chunk of req) body += String(chunk);

    try {
      const reqObj: MCPRequest = JSON.parse(body);
      if (reqObj.method === "list_tools") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: reqObj.id ?? null, result: { tools: [] } }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: reqObj.id ?? null, error: { message: "unknown method" } }));
    } catch {
      res.statusCode = 400;
      res.end("invalid json\n");
    }
  });

  server.listen(options.port, () => {
    console.log(`GFW MCP (http) listening on ${options.port}`);
  });

  return server;
}

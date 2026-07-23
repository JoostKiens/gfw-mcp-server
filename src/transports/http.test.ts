import type http from "node:http";
import { afterEach, expect, test } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startHttp } from "./http.js";

let server: http.Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

test("http server lists tools via the MCP client", async () => {
  server = await startHttp({ port: 0 });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : Number(addr);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`)));

  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toContain("find_vessels");
});

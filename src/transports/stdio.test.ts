import { afterEach, expect, test } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
});

test("stdio server lists tools via the MCP client", async () => {
  // Ensure dist exists — tests run after build in our workflow
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, GFW_API_TOKEN: "dummy" },
  });

  client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toContain("find_vessels");
});

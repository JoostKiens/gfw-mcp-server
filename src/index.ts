import { createMcpServer } from "./create-server.js";
import { loadEnvironment, requireEnv } from "./env.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

loadEnvironment();

try {
  requireEnv("GFW_API_TOKEN");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}

const args = process.argv.slice(2);
const isHttp = args.includes("--http");
const portFlagIndex = args.findIndex((a: string) => a === "--port");
const port = portFlagIndex >= 0 && args[portFlagIndex + 1] ? Number(args[portFlagIndex + 1]) : 3000;

if (isHttp) {
  await startHttp({ port });
} else {
  await startStdio(createMcpServer());
}

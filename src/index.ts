import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. Set it in the environment or .env`);
    process.exit(2);
  }
  return v;
}

// Ensure required env var exists at startup (per conventions)
requireEnv("GFW_API_TOKEN");

const args = process.argv.slice(2);
const isHttp = args.includes("--http");
const portFlagIndex = args.findIndex((a: string) => a === "--port");
const port = portFlagIndex >= 0 && args[portFlagIndex + 1] ? Number(args[portFlagIndex + 1]) : 3000;

if (isHttp) {
  startHttp({ port });
} else {
  startStdio();
}

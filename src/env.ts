import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

export function loadEnvironment(): void {
  const envFiles = [".env.local", ".env"];

  for (const file of envFiles) {
    const envPath = resolve(process.cwd(), file);
    if (!existsSync(envPath)) {
      continue;
    }

    const result = config({ path: envPath, override: false });
    if (result.error) {
      throw result.error;
    }
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Set it in the environment or .env`);
  }
  return value;
}

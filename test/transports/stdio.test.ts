import { spawn } from "child_process";
import readline from "node:readline";
import { afterEach, expect, test } from "vitest";

let cp: ReturnType<typeof spawn> | null = null;

afterEach(() => {
  if (cp && !cp.killed) cp.kill();
});

test("stdio list_tools via child process", async () => {
  // Ensure dist exists — tests run after build in our workflow
  cp = spawn(process.execPath, ["dist/index.js"], {
    env: { ...process.env, GFW_API_TOKEN: "dummy" },
    stdio: ["pipe", "pipe", "ignore"],
  });

  const rl = readline.createInterface({ input: cp.stdout });

  let gotResponse: unknown = null;

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line as string);
      if (obj && obj.event === "ready") {
        cp.stdin.write(JSON.stringify({ method: "list_tools", id: 1 }) + "\n");
      } else if (obj && obj.id === 1) {
        gotResponse = obj;
        break;
      }
    } catch {
      // ignore non-json
    }
  }

  expect(gotResponse).toEqual({ id: 1, result: { tools: [] } });
});

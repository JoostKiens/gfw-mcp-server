import { createInterface } from "node:readline";

type MCPRequest = { method?: string; params?: unknown; id?: string | number };

export function startStdio(): void {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  rl.on("line", (line: string) => {
    try {
      const req: MCPRequest = JSON.parse(line);
      handle(req);
    } catch {
      // ignore non-json lines
    }
  });

  function send(obj: unknown) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }

  function handle(req: MCPRequest) {
    if (req.method === "list_tools") {
      send({ id: req.id ?? null, result: { tools: [] } });
      return;
    }
    // default: echo unknown method
    send({ id: req.id ?? null, error: { message: "unknown method" } });
  }

  // notify ready
  send({ event: "ready" });
}

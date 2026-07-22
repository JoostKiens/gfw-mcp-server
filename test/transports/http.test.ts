import http from "node:http";
import { afterEach, beforeEach, expect, test } from "vitest";
import { startHttp } from "../../src/transports/http.js";

let server: http.Server | null = null;

beforeEach(() => {
  server = null;
});

afterEach(() => {
  if (server) server.close();
});

test("http list_tools returns empty tools", async () => {
  server = startHttp({ port: 0 });
  await new Promise((r) => server!.once("listening", r));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : Number(addr);

  const res = await new Promise<{ status: number | null; body: string }>((resolve, reject) => {
    const req = http.request({ method: "POST", port, path: "/" }, (r) => {
      let body = "";
      r.on("data", (c) => (body += String(c)));
      r.on("end", () => resolve({ status: r.statusCode ?? null, body }));
    });
    req.on("error", reject);
    req.setHeader("content-type", "application/json");
    req.write(JSON.stringify({ method: "list_tools", id: 1 }));
    req.end();
  });

  expect(JSON.parse(res.body)).toEqual({ id: 1, result: { tools: [] } });
});

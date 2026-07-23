import { afterEach, describe, expect, it, vi } from "vitest";

import { createGfwClient } from "./client.js";

describe("createGfwClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GFW_API_TOKEN;
  });

  it("returns a typed success result with rate-limit metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "x-ratelimit-remaining": "42" }),
      json: async () => ({ data: { id: "abc" } }),
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.GFW_API_TOKEN = "test-token";

    const client = createGfwClient();
    const result = await client.get("/v3/endpoint");

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected success result");
    }

    expect(result.value).toEqual({ data: { id: "abc" } });
    expect(result.rateLimitRemaining).toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.api.globalfishingwatch.org/v3/endpoint",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          Accept: "application/json",
        }),
      }),
    );
  });

  it("uses GFW_API_TOKEN from the environment when present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    });

    vi.stubGlobal("fetch", fetchMock);
    delete process.env.GFW_API_TOKEN;
    process.env.GFW_API_TOKEN = "token-from-env";

    const client = createGfwClient();
    await client.get("/v3/endpoint");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.api.globalfishingwatch.org/v3/endpoint",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-from-env",
        }),
      }),
    );
  });

  it("returns an actionable unauthorized error when the token is missing", async () => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.GFW_API_TOKEN;

    const client = createGfwClient();
    const result = await client.get("/v3/endpoint");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unauthorized result");
    }

    expect(result.error.kind).toBe("http-error");
    expect(result.error.message).toContain("GFW_API_TOKEN");
  });

  it("distinguishes rate-limit failures from other errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers({ "x-ratelimit-remaining": "0" }),
      text: async () => JSON.stringify({ message: "quota exceeded" }),
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.GFW_API_TOKEN = "test-token";

    const client = createGfwClient();
    const result = await client.get("/v3/endpoint");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected rate-limited result");
    }

    expect(result.error.kind).toBe("rate-limited");
    expect(result.rateLimitRemaining).toBe(0);
    expect(result.error.message).toContain("rate limit");
    expect(result.error.message).toContain("quota exceeded");
  });

  it("returns a generic error for unexpected upstream failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      text: async () => JSON.stringify({ message: "boom" }),
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.GFW_API_TOKEN = "test-token";

    const client = createGfwClient();
    const result = await client.post("/v3/endpoint", { foo: "bar" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected request error");
    }

    expect(result.error.kind).toBe("request");
    expect(result.error.message).toContain("request to GFW failed");
    expect(result.error.message).toContain("boom");
  });

  it("returns a typed error instead of throwing when a 200 response body isn't valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.GFW_API_TOKEN = "test-token";

    const client = createGfwClient();
    const result = await client.get("/v3/endpoint");

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected request error");
    }

    expect(result.error.kind).toBe("request");
    expect(result.error.message).toContain("could not be parsed");
  });
});

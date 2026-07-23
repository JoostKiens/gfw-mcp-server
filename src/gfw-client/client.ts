import type { Result } from "../result.js";

export type GfwHttpMethod = "GET" | "POST";

export type GfwResult<T> = Result<T, GfwError> & { readonly rateLimitRemaining?: number };

export type GfwError =
  | {
      readonly kind: "http-error";
      readonly status: 401 | 403 | 404 | 422 | 524;
      readonly message: string;
    }
  | {
      readonly kind: "rate-limited";
      readonly status: 429;
      readonly message: string;
    }
  | {
      readonly kind: "request";
      readonly status: number;
      readonly message: string;
    };

export interface GfwClient {
  readonly get: <T = unknown>(path: string) => Promise<GfwResult<T>>;
  readonly post: <T = unknown>(path: string, body?: unknown) => Promise<GfwResult<T>>;
}

const GFW_BASE_URL = "https://gateway.api.globalfishingwatch.org";

function parseRateLimitRemaining(headers: Headers): number | undefined {
  const remaining = headers.get("x-ratelimit-remaining");
  if (!remaining) {
    return undefined;
  }

  const parsed = Number.parseInt(remaining, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const HTTP_ERROR_MESSAGES: Record<401 | 403 | 404 | 422 | 524, string> = {
  401: "GFW authentication failed. Check that GFW_API_TOKEN is set correctly and has access to the requested endpoint.",
  403: "GFW denied the request. The token may not have permission for this endpoint.",
  404: "GFW could not find the requested resource.",
  422: "The request was rejected by GFW validation.",
  524: "GFW request timed out.",
};

// Extracts only a `message` string field from the GFW error body, never the raw
// body text itself — GFW response bodies aren't a contract we want to pass through
// unfiltered to tool callers (see docs/claude/architecture.md's error-classification row).
function extractGfwMessage(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Not JSON — no message to extract.
  }
  return undefined;
}

function normalizeError(status: number, bodyText: string, statusText: string): GfwError {
  const gfwMessage = extractGfwMessage(bodyText) ?? statusText;

  if (status === 429) {
    return { kind: "rate-limited", status: 429, message: `GFW rate limit exceeded. Retry later. (${gfwMessage})` };
  }

  const genericMessage = HTTP_ERROR_MESSAGES[status as keyof typeof HTTP_ERROR_MESSAGES];
  if (genericMessage) {
    return { kind: "http-error", status: status as 401 | 403 | 404 | 422 | 524, message: `${genericMessage} (${gfwMessage})` };
  }

  return {
    kind: "request",
    status,
    message: `request to GFW failed with status ${status}. (${gfwMessage})`,
  };
}

export function createGfwClient(): GfwClient {
  async function request<T>(method: GfwHttpMethod, path: string, body?: unknown): Promise<GfwResult<T>> {
    const token = process.env.GFW_API_TOKEN;
    if (!token) {
      return {
        ok: false,
        error: {
          kind: "http-error",
          status: 401,
          message: "GFW_API_TOKEN is missing. Set it in the environment or .env before calling GFW.",
        },
      };
    }

    const url = `${GFW_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };

    const requestInit: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, requestInit);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch error";
      return {
        ok: false,
        error: {
          kind: "request",
          status: 0,
          message: `request to GFW failed: ${message}`,
        },
      };
    }

    const rateLimitRemaining = parseRateLimitRemaining(response.headers);

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      return {
        ok: false,
        error: normalizeError(response.status, bodyText, response.statusText || "No response body"),
        rateLimitRemaining,
      };
    }

    let value: T;
    try {
      value = (await response.json()) as T;
    } catch {
      return {
        ok: false,
        error: {
          kind: "request",
          status: response.status,
          message: "GFW returned a response that could not be parsed as JSON.",
        },
        rateLimitRemaining,
      };
    }
    return {
      ok: true,
      value,
      rateLimitRemaining,
    };
  }

  return {
    get: <T = unknown>(path: string) => request<T>("GET", path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>("POST", path, body),
  };
}

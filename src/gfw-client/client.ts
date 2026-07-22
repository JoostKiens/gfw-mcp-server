import { loadEnvironment } from "../env.js";

loadEnvironment();

export type GfwHttpMethod = "GET" | "POST";

export type GfwResult<T> =
  | { readonly ok: true; readonly value: T; readonly rateLimitRemaining?: number }
  | {
      readonly ok: false;
      readonly error: GfwError;
      readonly rateLimitRemaining?: number;
    };

export type GfwError =
  | {
      readonly kind: "unauthorized";
      readonly status: 401;
      readonly message: string;
    }
  | {
      readonly kind: "forbidden";
      readonly status: 403;
      readonly message: string;
    }
  | {
      readonly kind: "not-found";
      readonly status: 404;
      readonly message: string;
    }
  | {
      readonly kind: "validation";
      readonly status: 422;
      readonly message: string;
    }
  | {
      readonly kind: "rate-limited";
      readonly status: 429;
      readonly message: string;
      readonly rateLimitRemaining?: number;
    }
  | {
      readonly kind: "timeout";
      readonly status: 524;
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

interface GfwClientConfig {
  readonly baseUrl?: string;
}

function getAuthToken(): string | undefined {
  return process.env.GFW_API_TOKEN;
}

function parseRateLimitRemaining(headers: Headers): number | undefined {
  const remaining = headers.get("x-ratelimit-remaining");
  if (!remaining) {
    return undefined;
  }

  const parsed = Number.parseInt(remaining, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function normalizeError(status: number, message: string, rateLimitRemaining?: number): GfwError {
  switch (status) {
    case 401:
      return {
        kind: "unauthorized",
        status: 401,
        message: "GFW authentication failed. Check that GFW_API_TOKEN is set correctly and has access to the requested endpoint.",
      };
    case 403:
      return {
        kind: "forbidden",
        status: 403,
        message: "GFW denied the request. The token may not have permission for this endpoint.",
      };
    case 404:
      return {
        kind: "not-found",
        status: 404,
        message: "GFW could not find the requested resource.",
      };
    case 422:
      return {
        kind: "validation",
        status: 422,
        message: "The request was rejected by GFW validation.",
      };
    case 429:
      return {
        kind: "rate-limited",
        status: 429,
        message: "GFW rate limit exceeded. Retry later.",
        rateLimitRemaining,
      };
    case 524:
      return {
        kind: "timeout",
        status: 524,
        message: "GFW request timed out.",
      };
    default:
      return {
        kind: "request",
        status,
        message: `request to GFW failed with status ${status}.`,
      };
  }
}

export function createGfwClient(config: GfwClientConfig = {}): GfwClient {
  const baseUrl = config.baseUrl ?? "https://gateway.api.globalfishingwatch.org";

  async function request<T>(method: GfwHttpMethod, path: string, body?: unknown): Promise<GfwResult<T>> {
    const token = getAuthToken();
    if (!token) {
      return {
        ok: false,
        error: {
          kind: "unauthorized",
          status: 401,
          message: "GFW_API_TOKEN is missing. Set it in the environment or .env before calling GFW.",
        },
      };
    }

    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
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
      const bodyText = await readResponseBody(response);
      const message = bodyText ? bodyText : response.statusText || "No response body";
      return {
        ok: false,
        error: normalizeError(response.status, message, rateLimitRemaining),
        rateLimitRemaining,
      };
    }

    const value = (await response.json()) as T;
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

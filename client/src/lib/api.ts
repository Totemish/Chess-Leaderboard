/** Public Express API (leaderboard, players, sockets). Authenticated calls go through `/api/backend`. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  return `Request failed with status ${status}`;
}

/**
 * Fetches JSON and throws an `ApiError` for HTTP errors or a `{ success: false }`
 * body, so SWR's `error` and mutation `catch` blocks see one consistent shape.
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Empty or non-JSON body; the status code decides.
  }

  const failed =
    !res.ok || (body !== null && typeof body === 'object' && 'success' in body && body.success === false);
  if (failed) throw new ApiError(errorMessage(body, res.status), res.status);

  return body as T;
}

/** POST/DELETE helper for the authenticated backend proxy. */
export function sendJson<T>(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

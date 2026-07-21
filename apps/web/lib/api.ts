import type { ApiResponse } from '@rezo/shared-types';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface RequestOptions {
  token?: string | null;
  method?: string;
  body?: unknown;
}

/**
 * Calls the Rezo API and unwraps the standard envelope. On a failure envelope
 * (or non-2xx) it throws ApiClientError with the server's code/message.
 */
export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { json } = await apiFetchEnvelope<T>(path, opts);
  if (json.error) throw new ApiClientError(json.error.code, json.error.message, 0);
  return json.data as T;
}

/** Like apiFetch but returns the full parsed envelope (incl. list `next_cursor`). */
export async function apiFetchEnvelope<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<{ json: ApiResponse<T> & { next_cursor?: string | null }; status: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    cache: 'no-store',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let json: ApiResponse<T> & { next_cursor?: string | null };
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError('network_error', `Unexpected response (HTTP ${res.status}).`, res.status);
  }
  return { json, status: res.status };
}

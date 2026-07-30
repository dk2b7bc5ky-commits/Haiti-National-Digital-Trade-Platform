import { apiFetch, apiFetchEnvelope, ApiClientError } from './api';

/** Builds a mock fetch Response with a JSON body (or a non-JSON body). */
function mockResponse(body: unknown, status = 200, jsonThrows = false): Response {
  return {
    status,
    json: async () => {
      if (jsonThrows) throw new Error('not json');
      return body;
    },
  } as unknown as Response;
}

describe('apiFetch', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('unwraps a success envelope and returns data', async () => {
    global.fetch = jest.fn(async () => mockResponse({ data: { id: 'c1' }, error: null })) as unknown as typeof fetch;
    await expect(apiFetch<{ id: string }>('/containers/c1')).resolves.toEqual({ id: 'c1' });
  });

  it('throws ApiClientError with the server code/message on a failure envelope', async () => {
    global.fetch = jest.fn(async () =>
      mockResponse({ data: null, error: { code: 'forbidden', message: 'Nope.' } }, 403),
    ) as unknown as typeof fetch;
    await expect(apiFetch('/containers')).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'forbidden',
      message: 'Nope.',
    });
  });

  it('throws network_error when the body is not JSON', async () => {
    global.fetch = jest.fn(async () => mockResponse(null, 502, true)) as unknown as typeof fetch;
    await expect(apiFetch('/health')).rejects.toBeInstanceOf(ApiClientError);
    await expect(apiFetch('/health')).rejects.toMatchObject({ code: 'network_error', status: 502 });
  });

  it('attaches the bearer token when provided', async () => {
    const spy = jest.fn(async () => mockResponse({ data: true, error: null }));
    global.fetch = spy as unknown as typeof fetch;
    await apiFetch('/auth/me', { token: 'tok123' });
    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
  });

  it('does not attach an Authorization header without a token', async () => {
    const spy = jest.fn(async () => mockResponse({ data: true, error: null }));
    global.fetch = spy as unknown as typeof fetch;
    await apiFetch('/health');
    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('apiFetchEnvelope', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the full envelope including next_cursor and status', async () => {
    global.fetch = jest.fn(async () =>
      mockResponse({ data: [{ id: 'a' }], error: null, next_cursor: 'cur2' }, 200),
    ) as unknown as typeof fetch;
    const { json, status } = await apiFetchEnvelope<{ id: string }[]>('/containers');
    expect(status).toBe(200);
    expect(json.next_cursor).toBe('cur2');
    expect(json.data).toEqual([{ id: 'a' }]);
  });
});

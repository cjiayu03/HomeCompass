import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getApiBase, requestJson } from '../lib/api-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('requestJson', () => {
  it('returns JSON from a successful response', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ homes: [{ id: 'home-1' }] }), { status: 200 })));

    await expect(requestJson('/api/v1/homes')).resolves.toEqual({ homes: [{ id: 'home-1' }] });
    expect(fetch).toHaveBeenCalledWith('https://api.example.test/api/v1/homes', {});
  });

  it('throws an ApiError with HTTP status and detail code for a structured error', async () => {
    const payload = { detail: { code: 'SEARCH_UNAVAILABLE', message: 'internal details' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 503 })));

    const error = await requestJson('/api/v1/search').catch((error) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SEARCH_UNAVAILABLE',
      payload,
    });
    expect(error.message).not.toContain('internal details');
  });

  it('throws an ApiError with a stable network code when Fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('socket details')));

    await expect(requestJson('/api/v1/homes')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NETWORK_ERROR',
      status: null,
    });
  });

  it('throws an ApiError with a malformed-payload code when a response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

    await expect(requestJson('/api/v1/homes')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'MALFORMED_PAYLOAD',
      status: 200,
    });
  });

  it('forwards an AbortSignal and other FetchInit options', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));

    await requestJson('/api/v1/search', { signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

    expect(fetch).toHaveBeenCalledWith('/api/v1/search', {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it('preserves AbortError identity for intentional cancellation', async () => {
    const abortError = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(requestJson('/api/v1/homes')).rejects.toBe(abortError);
  });

  it('preserves AbortError identity when cancellation occurs while reading JSON', async () => {
    const abortError = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockRejectedValue(abortError) }));

    await expect(requestJson('/api/v1/homes')).rejects.toBe(abortError);
  });
});

describe('getApiBase', () => {
  it('removes trailing slashes from the configured base', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.test///');
    expect(getApiBase()).toBe('https://api.example.test');
  });
});

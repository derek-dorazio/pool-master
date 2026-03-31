import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '@/lib/api-client';

describe('api-client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('api.get() sends GET request with correct path', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    await api.get('/users/1');
    expect(fetchSpy).toHaveBeenCalledWith('/api/users/1', expect.objectContaining({ method: 'GET' }));
  });

  it('api.get() adds Authorization header when access_token exists', async () => {
    localStorage.setItem('access_token', 'my-token');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await api.get('/me');
    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['Authorization']).toBe('Bearer my-token');
  });

  it('no auth header when no token in localStorage', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await api.get('/public');
    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['Authorization']).toBeUndefined();
  });

  it('api.post() sends POST with JSON body', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await api.post('/users', { name: 'Alice' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Alice' }) }),
    );
  });

  it('api.put() sends PUT with JSON body', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await api.put('/users/1', { name: 'Bob' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/users/1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ name: 'Bob' }) }),
    );
  });

  it('api.delete() sends DELETE request', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    await api.delete('/users/1');
    expect(fetchSpy).toHaveBeenCalledWith('/api/users/1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('returns parsed JSON on success', async () => {
    const data = { id: 42, name: 'Test' };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    const result = await api.get('/items/42');
    expect(result).toEqual(data);
  });

  it('returns undefined on 204 No Content', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await api.delete('/items/1');
    expect(result).toBeUndefined();
  });

  it('throws ApiError with status and message on non-2xx', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404, statusText: 'Not Found' }),
    );
    await expect(api.get('/missing')).rejects.toThrow(ApiError);
    try {
      await api.get('/missing');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.message).toBe('Not Found');
      expect(err.details).toEqual({ message: 'Not Found' });
    }
  });

  it('ApiError has correct name and properties', () => {
    const err = new ApiError(500, 'Server Error', { code: 'INTERNAL' });
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(500);
    expect(err.message).toBe('Server Error');
    expect(err.details).toEqual({ code: 'INTERNAL' });
    expect(err).toBeInstanceOf(Error);
  });
});

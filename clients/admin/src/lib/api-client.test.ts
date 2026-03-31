import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { adminApi, ApiError } from '@/lib/api-client';

describe('admin api-client', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adminApi.get() sends GET request with correct path', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await adminApi.get('/admin/users');
    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({ method: 'GET' }));
  });

  it('uses admin_token from localStorage for Authorization header', async () => {
    localStorage.setItem('admin_token', 'admin-secret');
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await adminApi.get('/admin/dashboard');
    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['Authorization']).toBe('Bearer admin-secret');
  });

  it('no auth header when no admin_token in localStorage', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await adminApi.get('/admin/public');
    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(callHeaders['Authorization']).toBeUndefined();
  });

  it('adminApi.post() sends POST with JSON body', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    await adminApi.post('/admin/users', { email: 'admin@test.com' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/admin/users',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'admin@test.com' }) }),
    );
  });

  it('adminApi.put() sends PUT with JSON body', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await adminApi.put('/admin/users/1', { role: 'superadmin' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/admin/users/1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ role: 'superadmin' }) }),
    );
  });

  it('adminApi.delete() sends DELETE request', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    await adminApi.delete('/admin/users/1');
    expect(fetchSpy).toHaveBeenCalledWith('/api/admin/users/1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('returns parsed JSON on success', async () => {
    const data = { users: [{ id: 1 }] };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
    const result = await adminApi.get('/admin/users');
    expect(result).toEqual(data);
  });

  it('throws ApiError on non-2xx response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, statusText: 'Forbidden' }),
    );
    await expect(adminApi.get('/admin/secret')).rejects.toThrow(ApiError);
    try {
      await adminApi.get('/admin/secret');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(403);
      expect(err.message).toBe('Forbidden');
    }
  });
});

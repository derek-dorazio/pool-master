import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { useAdminMetrics, useTenantList, useUserSearch } from './use-admin-api';

describe('useAdminMetrics', () => {
  // useAdminMetrics calls /v1/admin/health/metrics (no default MSW handler)
  // and /v1/admin/health/services. Since /health/metrics is unhandled,
  // the fetch fails and the catch block returns hardcoded mock data.
  it('returns metrics with expected shape', async () => {
    const { result } = renderHook(() => useAdminMetrics());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.metrics).toBeDefined();
    expect(data.metrics.totalUsers).toEqual({ value: 1245, trend: 8 });
    expect(data.metrics.activeTenants).toEqual({ value: 24, trend: 12 });
    expect(data.metrics.activeContests).toEqual({ value: 156, trend: 15 });
    expect(data.metrics.liveDrafts).toEqual({ value: 3, trend: -3 });
    expect(data.metrics.notificationRate).toEqual({ value: 98.5, trend: 0.5 });
  });

  it('returns services array', async () => {
    const { result } = renderHook(() => useAdminMetrics());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data!.services).toBeInstanceOf(Array);
    expect(result.current.data!.services.length).toBeGreaterThan(0);
    expect(result.current.data!.services[0]).toHaveProperty('name');
    expect(result.current.data!.services[0]).toHaveProperty('status');
  });

  it('returns alerts array', async () => {
    const { result } = renderHook(() => useAdminMetrics());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data!.alerts).toBeInstanceOf(Array);
    expect(result.current.data!.alerts.length).toBeGreaterThan(0);
  });

  it('returns audit entries', async () => {
    const { result } = renderHook(() => useAdminMetrics());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data!.audit).toBeInstanceOf(Array);
    expect(result.current.data!.audit.length).toBeGreaterThan(0);
  });
});

describe('useTenantList', () => {
  it('returns tenants array with pagination', async () => {
    server.use(
      http.get('/api/v1/admin/tenants', () => {
        return HttpResponse.json({
          items: [
            { id: 't1', name: 'Fantasy Kings', slug: 'fantasy-kings', plan: 'Pro', members: 148, leagues: 12, contests: 34, status: 'Active', lastActive: '2026-03-26T14:00:00Z', createdAt: '2025-06-15T00:00:00Z' },
            { id: 't2', name: 'Draft Masters', slug: 'draft-masters', plan: 'League+', members: 312, leagues: 28, contests: 89, status: 'Active', lastActive: '2026-03-26T13:45:00Z', createdAt: '2025-03-01T00:00:00Z' },
          ],
          total: 2,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHook(() => useTenantList({}));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.items).toBeInstanceOf(Array);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('each tenant has required fields', async () => {
    server.use(
      http.get('/api/v1/admin/tenants', () => {
        return HttpResponse.json({
          items: [
            { id: 't1', name: 'Fantasy Kings', slug: 'fantasy-kings', plan: 'Pro', members: 148, leagues: 12, contests: 34, status: 'Active', lastActive: '2026-03-26T14:00:00Z', createdAt: '2025-06-15T00:00:00Z' },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHook(() => useTenantList({}));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const tenant = result.current.data!.items[0];
    expect(tenant).toHaveProperty('id');
    expect(tenant).toHaveProperty('name');
    expect(tenant).toHaveProperty('slug');
    expect(tenant).toHaveProperty('plan');
    expect(tenant).toHaveProperty('members');
    expect(tenant).toHaveProperty('status');
  });

  it('filters tenants by search query', async () => {
    server.use(
      http.get('/api/v1/admin/tenants', ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search')?.toLowerCase() ?? '';
        const allTenants = [
          { id: 't1', name: 'Fantasy Kings', slug: 'fantasy-kings', plan: 'Pro', members: 148, leagues: 12, contests: 34, status: 'Active', lastActive: '2026-03-26T14:00:00Z', createdAt: '2025-06-15T00:00:00Z' },
          { id: 't2', name: 'Draft Masters', slug: 'draft-masters', plan: 'League+', members: 312, leagues: 28, contests: 89, status: 'Active', lastActive: '2026-03-26T13:45:00Z', createdAt: '2025-03-01T00:00:00Z' },
        ];
        const filtered = search
          ? allTenants.filter((t) => t.name.toLowerCase().includes(search) || t.slug.toLowerCase().includes(search))
          : allTenants;
        return HttpResponse.json({
          items: filtered,
          total: filtered.length,
          page: 1,
          pageSize: 10,
          totalPages: 1,
        });
      }),
    );

    const { result } = renderHook(() => useTenantList({ search: 'fantasy' }));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.items.length).toBeGreaterThan(0);
    expect(
      data.items.every(
        (t: { name: string; slug: string }) =>
          t.name.toLowerCase().includes('fantasy') ||
          t.slug.toLowerCase().includes('fantasy'),
      ),
    ).toBe(true);
  });
});

describe('useUserSearch', () => {
  it('returns users array when query is provided', async () => {
    server.use(
      http.get('/api/v1/admin/users', () => {
        return HttpResponse.json([
          { id: 'u1', email: 'alice@fantasykings.com', displayName: 'Alice Thompson', tenants: ['Fantasy Kings'], lastLogin: '2026-03-26T14:00:00Z', status: 'Active' },
          { id: 'u2', email: 'bob@example.com', displayName: 'Bob Martinez', tenants: ['Fantasy Kings'], lastLogin: '2026-03-26T13:00:00Z', status: 'Active' },
        ]);
      }),
    );

    const { result } = renderHook(() => useUserSearch('test'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toBeInstanceOf(Array);
    expect(data.length).toBeGreaterThan(0);
  });

  it('each user has required fields', async () => {
    server.use(
      http.get('/api/v1/admin/users', () => {
        return HttpResponse.json([
          { id: 'u1', email: 'alice@fantasykings.com', displayName: 'Alice Thompson', tenants: ['Fantasy Kings'], lastLogin: '2026-03-26T14:00:00Z', status: 'Active' },
        ]);
      }),
    );

    const { result } = renderHook(() => useUserSearch('test'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const user = result.current.data![0];
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('displayName');
    expect(user).toHaveProperty('tenants');
    expect(user).toHaveProperty('status');
  });

  it('does not fetch when query is empty', () => {
    const { result } = renderHook(() => useUserSearch(''));

    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

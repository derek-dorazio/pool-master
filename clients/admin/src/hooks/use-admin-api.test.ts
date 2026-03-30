import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useAdminMetrics, useTenantList, useUserSearch } from './use-admin-api';

describe('useAdminMetrics', () => {
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
    const { result } = renderHook(() => useTenantList({ search: 'fantasy' }));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.items.length).toBeGreaterThan(0);
    expect(
      data.items.every(
        (t) =>
          t.name.toLowerCase().includes('fantasy') ||
          t.slug.toLowerCase().includes('fantasy'),
      ),
    ).toBe(true);
  });
});

describe('useUserSearch', () => {
  it('returns users array when query is provided', async () => {
    const { result } = renderHook(() => useUserSearch('test'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toBeInstanceOf(Array);
    expect(data.length).toBeGreaterThan(0);
  });

  it('each user has required fields', async () => {
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

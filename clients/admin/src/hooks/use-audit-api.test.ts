import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useAuditLog } from './use-audit-api';
import type { AuditFilters } from './use-audit-api';

const defaultFilters: AuditFilters = {
  admin: 'All',
  action: 'All',
  resourceType: 'All',
  dateFrom: '',
  dateTo: '',
  search: '',
  page: 1,
};

describe('useAuditLog', () => {
  it('returns paginated audit entries', async () => {
    const { result } = renderHook(() => useAuditLog(defaultFilters));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.entries).toBeInstanceOf(Array);
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('each entry has expected shape', async () => {
    const { result } = renderHook(() => useAuditLog(defaultFilters));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const entry = result.current.data!.entries[0];
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('admin');
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('resourceType');
    expect(entry).toHaveProperty('resourceId');
    expect(entry).toHaveProperty('description');
  });

  it('filters by admin', async () => {
    const filters: AuditFilters = { ...defaultFilters, admin: 'sarah.chen@poolmaster.io' };
    const { result } = renderHook(() => useAuditLog(filters));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const entries = result.current.data!.entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.admin === 'sarah.chen@poolmaster.io')).toBe(true);
  });

  it('filters by search query', async () => {
    const filters: AuditFilters = { ...defaultFilters, search: 'bracket' };
    const { result } = renderHook(() => useAuditLog(filters));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const entries = result.current.data!.entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(
      entries.every(
        (e) =>
          e.description.toLowerCase().includes('bracket') ||
          (e.reason && e.reason.toLowerCase().includes('bracket')),
      ),
    ).toBe(true);
  });

  it('filters by resource type', async () => {
    const filters: AuditFilters = { ...defaultFilters, resourceType: 'TENANT' };
    const { result } = renderHook(() => useAuditLog(filters));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const entries = result.current.data!.entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.resourceType === 'TENANT')).toBe(true);
  });
});

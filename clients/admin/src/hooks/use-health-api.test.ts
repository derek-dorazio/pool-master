import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useHealthDashboard, useErrorLog, useAlertRules } from './use-health-api';

describe('useHealthDashboard', () => {
  it('returns health data with services array', async () => {
    const { result } = renderHook(() => useHealthDashboard());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.services).toBeInstanceOf(Array);
    expect(data.services.length).toBeGreaterThan(0);
  });

  it('each service has required fields', async () => {
    const { result } = renderHook(() => useHealthDashboard());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const service = result.current.data!.services[0];
    expect(service).toHaveProperty('name');
    expect(service).toHaveProperty('status');
    expect(service).toHaveProperty('uptime');
    expect(service).toHaveProperty('errorRate');
    expect(service).toHaveProperty('p95Latency');
    expect(service).toHaveProperty('version');
  });

  it('returns infrastructure data', async () => {
    const { result } = renderHook(() => useHealthDashboard());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data!.infrastructure).toBeInstanceOf(Array);
    expect(result.current.data!.infrastructure.length).toBeGreaterThan(0);
  });

  it('returns key metrics', async () => {
    const { result } = renderHook(() => useHealthDashboard());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data!.keyMetrics).toBeInstanceOf(Array);
    expect(result.current.data!.keyMetrics.length).toBeGreaterThan(0);
  });

  it('includes lastRefreshed timestamp', async () => {
    const { result } = renderHook(() => useHealthDashboard());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data!.lastRefreshed).toBeInstanceOf(Date);
  });
});

describe('useErrorLog', () => {
  it('returns error entries with pagination', async () => {
    const { result } = renderHook(() =>
      useErrorLog({ service: 'All', severity: 'All', dateFrom: '', dateTo: '', page: 1 }),
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.entries).toBeInstanceOf(Array);
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.total).toBeGreaterThan(0);
    expect(data.page).toBe(1);
    expect(data.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('each error entry has required fields', async () => {
    const { result } = renderHook(() =>
      useErrorLog({ service: 'All', severity: 'All', dateFrom: '', dateTo: '', page: 1 }),
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    const entry = result.current.data!.entries[0];
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('service');
    expect(entry).toHaveProperty('severity');
    expect(entry).toHaveProperty('message');
    expect(entry).toHaveProperty('stackTrace');
  });

  it('filters by service', async () => {
    const { result } = renderHook(() =>
      useErrorLog({ service: 'Scoring Engine', severity: 'All', dateFrom: '', dateTo: '', page: 1 }),
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.entries.every((e) => e.service === 'Scoring Engine')).toBe(true);
  });

  it('filters by severity', async () => {
    const { result } = renderHook(() =>
      useErrorLog({ service: 'All', severity: 'Critical', dateFrom: '', dateTo: '', page: 1 }),
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.entries.every((e) => e.severity === 'Critical')).toBe(true);
  });
});

describe('useAlertRules', () => {
  it('returns alert rules array', async () => {
    const { result } = renderHook(() => useAlertRules());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toBeInstanceOf(Array);
    expect(data.length).toBeGreaterThan(0);
  });

  it('each alert rule has required fields', async () => {
    const { result } = renderHook(() => useAlertRules());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const rule = result.current.data![0];
    expect(rule).toHaveProperty('id');
    expect(rule).toHaveProperty('name');
    expect(rule).toHaveProperty('condition');
    expect(rule).toHaveProperty('threshold');
    expect(rule).toHaveProperty('channels');
    expect(rule).toHaveProperty('severity');
    expect(rule).toHaveProperty('status');
  });

  it('contains rules with different severities', async () => {
    const { result } = renderHook(() => useAlertRules());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const severities = new Set(result.current.data!.map((r) => r.severity));
    expect(severities.size).toBeGreaterThan(1);
  });
});

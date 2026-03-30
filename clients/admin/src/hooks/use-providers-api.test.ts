import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useProviderList, useIngestionJobs } from './use-providers-api';

describe('useProviderList', () => {
  it('returns providers array', async () => {
    const { result } = renderHook(() => useProviderList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data).toBeInstanceOf(Array);
    expect(result.current.data.length).toBeGreaterThan(0);
  });

  it('each provider has required fields', async () => {
    const { result } = renderHook(() => useProviderList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const provider = result.current.data[0];
    expect(provider).toHaveProperty('id');
    expect(provider).toHaveProperty('name');
    expect(provider).toHaveProperty('status');
    expect(provider).toHaveProperty('errorRate');
    expect(provider).toHaveProperty('avgLatency');
    expect(provider).toHaveProperty('activeEvents');
  });

  it('contains providers with different statuses', async () => {
    const { result } = renderHook(() => useProviderList());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const statuses = new Set(result.current.data.map((p) => p.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('returns isLoading state', () => {
    const { result } = renderHook(() => useProviderList());

    expect(typeof result.current.isLoading).toBe('boolean');
  });
});

describe('useIngestionJobs', () => {
  it('returns jobs array', async () => {
    const { result } = renderHook(() => useIngestionJobs());

    await waitFor(() => expect(result.current.jobs.length).toBeGreaterThan(0));

    expect(result.current.jobs).toBeInstanceOf(Array);
  });

  it('each job has required fields', async () => {
    const { result } = renderHook(() => useIngestionJobs());

    await waitFor(() => expect(result.current.jobs.length).toBeGreaterThan(0));

    const job = result.current.jobs[0];
    expect(job).toHaveProperty('id');
    expect(job).toHaveProperty('provider');
    expect(job).toHaveProperty('sport');
    expect(job).toHaveProperty('event');
    expect(job).toHaveProperty('progress');
  });

  it('returns errors array', async () => {
    const { result } = renderHook(() => useIngestionJobs());

    await waitFor(() => expect(result.current.errors.length).toBeGreaterThan(0));

    expect(result.current.errors).toBeInstanceOf(Array);
    expect(result.current.errors[0]).toHaveProperty('timestamp');
    expect(result.current.errors[0]).toHaveProperty('errorType');
    expect(result.current.errors[0]).toHaveProperty('message');
  });

  it('returns throughput value', async () => {
    const { result } = renderHook(() => useIngestionJobs());

    await waitFor(() => expect(result.current.throughput).toBeGreaterThan(0));

    expect(typeof result.current.throughput).toBe('number');
    expect(result.current.throughput).toBe(1245);
  });

  it('returns isLoading state', () => {
    const { result } = renderHook(() => useIngestionJobs());

    expect(typeof result.current.isLoading).toBe('boolean');
  });
});

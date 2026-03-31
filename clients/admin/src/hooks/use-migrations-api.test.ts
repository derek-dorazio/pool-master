import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useMigrations, useMigrationDetail } from './use-migrations-api';

describe('useMigrations', () => {
  it('returns available migrations list', async () => {
    const { result } = renderHook(() => useMigrations());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.available).toBeInstanceOf(Array);
    expect(data.available.length).toBeGreaterThan(0);
  });

  it('each migration has expected shape', async () => {
    const { result } = renderHook(() => useMigrations());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const migration = result.current.data!.available[0];
    expect(migration).toHaveProperty('id');
    expect(migration).toHaveProperty('name');
    expect(migration).toHaveProperty('description');
    expect(migration).toHaveProperty('lastStatus');
  });

  it('returns active runs array', async () => {
    const { result } = renderHook(() => useMigrations());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.activeRuns).toBeInstanceOf(Array);
    expect(data.activeRuns.length).toBeGreaterThan(0);
    expect(data.activeRuns[0]).toHaveProperty('status');
    expect(data.activeRuns[0]).toHaveProperty('progress');
  });

  it('returns recent history', async () => {
    const { result } = renderHook(() => useMigrations());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.recentHistory).toBeInstanceOf(Array);
    expect(data.recentHistory.length).toBeGreaterThan(0);
  });
});

describe('useMigrationDetail', () => {
  it('returns run detail by id', async () => {
    const { result } = renderHook(() => useMigrationDetail('run-001'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.id).toBe('run-001');
    expect(data.migrationName).toBe('backfill-analytics');
    expect(data.status).toBe('Running');
    expect(data.progress).toBe(65);
  });

  it('run detail includes error entries', async () => {
    const { result } = renderHook(() => useMigrationDetail('run-001'));

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.errors).toBeInstanceOf(Array);
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.errors[0]).toHaveProperty('recordId');
    expect(data.errors[0]).toHaveProperty('error');
  });
});

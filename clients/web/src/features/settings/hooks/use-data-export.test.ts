import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useDataExportStatus, useRequestDataExport } from './use-data-export';

describe('useDataExportStatus', () => {
  it('returns export status data', async () => {
    const { result } = renderHook(() => useDataExportStatus());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('requestedAt');
    expect(data).toHaveProperty('downloadUrl');
    expect(data).toHaveProperty('expiresAt');
    expect(data).toHaveProperty('nextAllowedAt');
  });

  it('status is a valid enum value', async () => {
    const { result } = renderHook(() => useDataExportStatus());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(['none', 'pending', 'ready']).toContain(result.current.data!.status);
  });

  it('falls back to "none" status when backend is unavailable', async () => {
    const { result } = renderHook(() => useDataExportStatus());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data!;
    expect(data.status).toBe('none');
    expect(data.downloadUrl).toBeNull();
  });
});

describe('useRequestDataExport', () => {
  it('exposes a mutate function', () => {
    const { result } = renderHook(() => useRequestDataExport());

    expect(result.current.mutate).toBeDefined();
    expect(typeof result.current.mutate).toBe('function');
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useRequestDataExport());

    expect(result.current.isIdle).toBe(true);
    expect(result.current.isPending).toBe(false);
  });
});

import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import { useDataExportStatus, useRequestDataExport } from './use-data-export';

const getDataExportStatus = vi.fn();
const requestDataExport = vi.fn();

vi.mock('@/lib/api', () => ({
  client: {},
  getDataExportStatus: (...args: unknown[]) => getDataExportStatus(...args),
  requestDataExport: (...args: unknown[]) => requestDataExport(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

describe('useDataExportStatus', () => {
  beforeEach(() => {
    getDataExportStatus.mockResolvedValue({
      data: {
        status: 'none',
        requestedAt: null,
        downloadUrl: null,
        expiresAt: null,
        nextAllowedAt: null,
      },
      error: null,
    });
  });

  it('returns export status data via the generated SDK function', async () => {
    const { result } = renderHook(() => useDataExportStatus());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getDataExportStatus).toHaveBeenCalledWith(expect.objectContaining({ client: expect.anything() }));

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

  it('reports an error when the backend returns one', async () => {
    getDataExportStatus.mockResolvedValue({ data: undefined, error: new Error('Forbidden') });

    const { result } = renderHook(() => useDataExportStatus());

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRequestDataExport', () => {
  beforeEach(() => {
    requestDataExport.mockResolvedValue({ error: null });
  });

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

  it('calls requestDataExport with the configured client', async () => {
    const { result } = renderHook(() => useRequestDataExport());

    result.current.mutate();

    await waitFor(() => {
      expect(requestDataExport).toHaveBeenCalledWith(expect.objectContaining({ client: expect.anything() }));
    });
  });
});

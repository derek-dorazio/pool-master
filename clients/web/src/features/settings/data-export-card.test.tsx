import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataExportCard } from './data-export-card';

const getDataExportStatus = vi.fn();
const requestDataExport = vi.fn();

vi.mock('./hooks/use-data-export', async () => {
  const { useQuery, useMutation, useQueryClient } = await import('@tanstack/react-query');
  return {
    useDataExportStatus: () =>
      useQuery({
        queryKey: ['settings', 'data-export'],
        queryFn: async () => {
          const { data, error } = await getDataExportStatus();
          if (error) throw error;
          return data;
        },
      }),
    useRequestDataExport: () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: async () => {
          const { error } = await requestDataExport();
          if (error) throw error;
        },
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['settings', 'data-export'] });
        },
      });
    },
  };
});

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DataExportCard />
    </QueryClientProvider>,
  );
}

describe('DataExportCard', () => {
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
    requestDataExport.mockResolvedValue({ error: null });
  });

  it('renders the idle state with request button enabled', async () => {
    renderCard();

    expect(await screen.findByRole('button', { name: /request my data/i })).toBeEnabled();
  });

  it('calls requestDataExport when the user clicks request', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /request my data/i }));

    await waitFor(() => {
      expect(requestDataExport).toHaveBeenCalled();
    });
  });

  it('shows pending export status with disabled button', async () => {
    getDataExportStatus.mockResolvedValue({
      data: {
        status: 'pending',
        requestedAt: '2026-04-03T12:00:00.000Z',
        downloadUrl: null,
        expiresAt: null,
        nextAllowedAt: null,
      },
      error: null,
    });

    renderCard();

    expect(await screen.findByText(/export in progress/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export requested/i })).toBeDisabled();
  });

  it('shows a ready export with a download link', async () => {
    getDataExportStatus.mockResolvedValue({
      data: {
        status: 'ready',
        requestedAt: '2026-04-03T12:00:00.000Z',
        downloadUrl: 'https://example.com/export.zip',
        expiresAt: '2026-04-10T12:00:00.000Z',
        nextAllowedAt: null,
      },
      error: null,
    });

    renderCard();

    const downloadLink = await screen.findByRole('link', { name: /download/i });
    expect(downloadLink).toHaveAttribute('href', 'https://example.com/export.zip');
    expect(screen.getByText(/expires/i)).toBeInTheDocument();
  });

  it('disables the button when rate-limited', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    getDataExportStatus.mockResolvedValue({
      data: {
        status: 'none',
        requestedAt: null,
        downloadUrl: null,
        expiresAt: null,
        nextAllowedAt: future,
      },
      error: null,
    });

    renderCard();

    expect(await screen.findByText(/you can request another export/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request my data/i })).toBeDisabled();
  });
});

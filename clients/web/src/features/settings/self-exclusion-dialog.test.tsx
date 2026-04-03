import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelfExclusionCard } from './self-exclusion-dialog';

const getActiveExclusion = vi.fn();
const createSelfExclusion = vi.fn();

vi.mock('@/lib/api', () => ({
  client: {},
  getActiveExclusion: (...args: unknown[]) => getActiveExclusion(...args),
  createSelfExclusion: (...args: unknown[]) => createSelfExclusion(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SelfExclusionCard />
    </QueryClientProvider>,
  );
}

describe('SelfExclusionCard', () => {
  beforeEach(() => {
    getActiveExclusion.mockResolvedValue({ data: { exclusion: null }, error: null });
    createSelfExclusion.mockResolvedValue({ data: { exclusionId: 'excl-1' }, error: null });
  });

  it('submits the long-term self-exclusion contract when selected', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: /take a break/i }));
    await user.click(screen.getByRole('radio', { name: /long-term self-exclusion/i }));
    await user.click(screen.getByRole('radio', { name: /until i reactivate my account/i }));
    await user.type(screen.getByPlaceholderText('CONFIRM'), 'CONFIRM');
    await user.click(screen.getByRole('button', { name: /activate self-exclusion/i }));

    await waitFor(() => {
      expect(createSelfExclusion).toHaveBeenCalledWith(expect.objectContaining({
        body: { type: 'SELF_EXCLUSION', duration: 'INDEFINITE' },
      }));
    });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as Logger from '@/lib/logger';
import { bindApiMocks } from '@/test/msw-api';
import { ProviderLeagueDialog } from './provider-league-dialog';
import type { ProviderLeagueRow } from './provider-league-columns';
import { providerSettingsFixture } from './sport-test-fixtures';

vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof Logger>()),
  getLogger: () => ({ child: () => ({ warn: vi.fn() }) }),
}));

const updateProviderLeague = vi.fn();
bindApiMocks({ updateProviderLeague });

const league: ProviderLeagueRow = {
  providerId: 'provider-1',
  providerName: 'BALLDONTLIE',
  id: 'provider-league-1',
  code: 'mlb',
  name: 'MLB',
  sport: 'BASEBALL',
  quietAfterMinutes: 210,
  typicalGameMinutes: 180,
  isEnabled: false,
};

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderLeagueDialog league={league} onClose={vi.fn()} ranges={undefined} />
    </QueryClientProvider>,
  );
}

describe('ProviderLeagueDialog', () => {
  it('shows a league that is switched off as Off', () => {
    renderDialog();

    expect(screen.getByTestId('root-admin-provider-league-dialog-enabled')).toHaveTextContent('Off');
  });

  it('saves only the switch and the quiet length when those are what changed', async () => {
    updateProviderLeague.mockResolvedValue({ data: { league: providerSettingsFixture().leagues[1] } });
    renderDialog();

    await userEvent.click(screen.getByTestId('root-admin-provider-league-dialog-edit'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-provider-league-dialog-enabled-input'), 'on');
    const quiet = screen.getByTestId('root-admin-provider-league-dialog-quiet-input');
    await userEvent.clear(quiet);
    await userEvent.type(quiet, '90');
    await userEvent.click(screen.getByTestId('root-admin-provider-league-dialog-save'));

    await waitFor(() => expect(updateProviderLeague).toHaveBeenCalledWith(expect.objectContaining({
      body: { isEnabled: true, quietAfterMinutes: 90 },
    })));
  });

  it('puts the saved values back when an edit is cancelled', async () => {
    renderDialog();

    await userEvent.click(screen.getByTestId('root-admin-provider-league-dialog-edit'));
    const typical = screen.getByTestId('root-admin-provider-league-dialog-typical-input');
    await userEvent.clear(typical);
    await userEvent.type(typical, '45');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByTestId('root-admin-provider-league-dialog-edit'));

    expect(screen.getByTestId('root-admin-provider-league-dialog-typical-input')).toHaveValue('180');
  });
});

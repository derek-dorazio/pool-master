import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderSettingRangesDto, ProviderSummaryDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { ProviderDialog } from './provider-dialog';
import { providerSettingsFixture, providerSummaryFixture } from './sport-test-fixtures';

// A provider's dialog on its own: view first, then Edit its Provider row, sending only what changed.

const mocks = vi.hoisted(() => ({ updateProviderSettings: vi.fn() }));
bindApiMocks(mocks);

const RANGES: ProviderSettingRangesDto = {
  requestsPerMinute: { min: 1, max: 6000 },
  pollMinutes: { min: 1, max: 240 },
  leagueMinutes: { min: 1, max: 1440 },
};

function renderDialog(provider: ProviderSummaryDto, overrides: { isChecking?: boolean; onCheckNow?: () => void; onClose?: () => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProviderDialog
        checkedAt="2026-11-25T08:00:00.000Z"
        isChecking={overrides.isChecking ?? false}
        onCheckNow={overrides.onCheckNow ?? vi.fn()}
        onClose={overrides.onClose ?? vi.fn()}
        provider={provider}
        ranges={RANGES}
      />
    </QueryClientProvider>,
  );
}

describe('ProviderDialog', () => {
  afterEach(() => {
    mocks.updateProviderSettings.mockReset();
  });

  it('saves every changed setting of the Provider row, and only those, then returns to the view', async () => {
    const settings = providerSettingsFixture({ webhooksEnabled: false, hasPlayerStats: false, isEnabled: true });
    mocks.updateProviderSettings.mockResolvedValue({ data: { provider: settings } });
    renderDialog(providerSummaryFixture({ settings }));

    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-edit'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-provider-dialog-enabled-input'), 'off');
    await userEvent.clear(screen.getByTestId('root-admin-provider-dialog-base-url-input'));
    await userEvent.type(screen.getByTestId('root-admin-provider-dialog-base-url-input'), 'https://feed.example.com/v2');
    await userEvent.clear(screen.getByTestId('root-admin-provider-dialog-rate-input'));
    await userEvent.type(screen.getByTestId('root-admin-provider-dialog-rate-input'), '600');
    await userEvent.selectOptions(screen.getByTestId('root-admin-provider-dialog-webhooks-input'), 'on');
    await userEvent.clear(screen.getByTestId('root-admin-provider-dialog-poll-input'));
    await userEvent.type(screen.getByTestId('root-admin-provider-dialog-poll-input'), '30');
    await userEvent.clear(screen.getByTestId('root-admin-provider-dialog-round-poll-input'));
    await userEvent.type(screen.getByTestId('root-admin-provider-dialog-round-poll-input'), '5');
    await userEvent.selectOptions(screen.getByTestId('root-admin-provider-dialog-player-stats-input'), 'yes');
    await waitFor(() => expect(screen.getByTestId('root-admin-provider-dialog-save')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-save'));

    await waitFor(() => expect(mocks.updateProviderSettings).toHaveBeenCalledWith(expect.objectContaining({
      path: { providerId: settings.id },
      body: {
        baseUrl: 'https://feed.example.com/v2',
        requestsPerMinute: 600,
        webhooksEnabled: true,
        webhookPollMinutes: 30,
        webhookRoundPollMinutes: 5,
        hasPlayerStats: true,
        isEnabled: false,
      },
    })));
    expect(await screen.findByTestId('root-admin-provider-dialog-edit')).toBeInTheDocument();
  });

  it('puts the edited values back when the edit is cancelled, and saves nothing', async () => {
    renderDialog(providerSummaryFixture());

    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-edit'));
    await userEvent.clear(screen.getByTestId('root-admin-provider-dialog-rate-input'));
    await userEvent.type(screen.getByTestId('root-admin-provider-dialog-rate-input'), '42');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('root-admin-provider-dialog-rate')).toHaveTextContent('5');
    await userEvent.click(screen.getByTestId('root-admin-provider-dialog-edit'));
    expect(screen.getByTestId('root-admin-provider-dialog-rate-input')).toHaveValue('5');
    expect(mocks.updateProviderSettings).not.toHaveBeenCalled();
  });

  it('offers no Edit for a provider running without a Provider row, and shows Check now as checking while it runs', () => {
    renderDialog(providerSummaryFixture({ settings: null, requestsPerMinute: null, webhooksEnabled: false }), { isChecking: true });

    expect(screen.queryByTestId('root-admin-provider-dialog-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-provider-dialog-base-url')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-provider-dialog-check')).toHaveTextContent('Checking...');
    expect(screen.getByTestId('root-admin-provider-dialog-check')).toBeDisabled();
  });
});

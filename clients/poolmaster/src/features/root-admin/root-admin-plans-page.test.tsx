import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanConfig, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { planGroupFixture } from './sport-test-fixtures';
import { RootAdminPlansPage } from './root-admin-plans-page';

const { listSettingsGroupsMock, updateSettingsGroupMock } = vi.hoisted(() => ({
  listSettingsGroupsMock: vi.fn(),
  updateSettingsGroupMock: vi.fn(),
}));

bindApiMocks({
  listSettingsGroups: listSettingsGroupsMock,
  updateSettingsGroup: updateSettingsGroupMock,
});

const ADMIN = { id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a01', name: 'Ada Admin' };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RootAdminPlansPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function savedGroup(value: PlanConfig): SettingsGroup {
  return { ...planGroupFixture(), source: 'stored', updatedAt: '2026-10-24T08:00:00.000Z', updatedBy: ADMIN, value };
}

function savedValue(): PlanConfig {
  const [request] = updateSettingsGroupMock.mock.calls[0] as [{ body: { value: PlanConfig } }];
  return request.body.value;
}

function setLimit(testId: string, limit: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value: limit } });
}

describe('RootAdminPlansPage', () => {
  beforeEach(() => {
    listSettingsGroupsMock.mockReset();
    updateSettingsGroupMock.mockReset();
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [planGroupFixture()] } });
  });

  it('shows each cap\'s limit on Free, Pro and Premium, with Platinum fixed at unlimited and not editable', async () => {
    renderPage();

    const entries = within(await screen.findByTestId('root-admin-plans-cap-ENTRIES_PER_CONTEST'));
    expect(entries.getByTestId('root-admin-plans-ENTRIES_PER_CONTEST-FREE-limit')).toHaveValue('20');
    expect(entries.getByTestId('root-admin-plans-ENTRIES_PER_CONTEST-PRO-limit')).toHaveValue('50');
    expect(entries.getByTestId('root-admin-plans-ENTRIES_PER_CONTEST-PREMIUM-limit')).toHaveValue('100');
    expect(entries.getByTestId('root-admin-plans-ENTRIES_PER_CONTEST-PLATINUM')).toHaveTextContent('Unlimited');
    expect(entries.queryByTestId('root-admin-plans-ENTRIES_PER_CONTEST-PLATINUM-limit')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-plans-SPORTS_LEAGUES_PER_YEAR-FREE-limit')).toHaveValue('1');
    expect(screen.getByTestId('root-admin-plans-last-change')).toHaveTextContent('Never changed: using the starting values.');
  });

  it('lists every feature under Emails, Championships or History with the plan it starts at, and the always-included rows read-only', async () => {
    renderPage();

    const emails = within(await screen.findByTestId('root-admin-plans-features-EMAILS'));
    expect(emails.getByText('Account, security and membership emails')).toBeInTheDocument();
    expect(emails.getByTestId('root-admin-plans-feature-EMAIL_CONTEST_RESULTS')).toHaveValue('FREE');
    expect(emails.getByTestId('root-admin-plans-feature-EMAIL_CONTEST_STANDINGS')).toHaveValue('PRO');
    const championships = within(screen.getByTestId('root-admin-plans-features-CHAMPIONSHIPS'));
    expect(championships.getByRole('combobox', { name: 'Sports league cups starts at' })).toHaveValue('PRO');
    const history = within(screen.getByTestId('root-admin-plans-features-HISTORY'));
    expect(history.getByText('Contest results and places, and the Contests page History view')).toBeInTheDocument();
    expect(history.getByRole('combobox', { name: 'Record book starts at' })).toHaveValue('PLATINUM');
    // Each always-included row says so and offers nothing to change.
    expect(history.getAllByRole('combobox')).toHaveLength(3);
    expect(history.getByText('Always')).toBeInTheDocument();
  });

  it('saves a changed cap, an unlimited cap and a changed feature as one PLAN_CONFIG value against the version it loaded', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: PlanConfig } }) => Promise.resolve({ data: savedGroup(body.value) }));
    renderPage();

    await screen.findByTestId('root-admin-plans-form');
    setLimit('root-admin-plans-ENTRIES_PER_CONTEST-FREE-limit', '25');
    fireEvent.click(screen.getByTestId('root-admin-plans-SPORTS_LEAGUES_PER_YEAR-PREMIUM-unlimited'));
    fireEvent.change(screen.getByTestId('root-admin-plans-feature-RECORD_BOOK'), { target: { value: 'PREMIUM' } });
    fireEvent.click(screen.getByTestId('root-admin-plans-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const [request] = updateSettingsGroupMock.mock.calls[0] as [{ path: { key: string }; body: { key: string; expectedUpdatedAt: string | null } }];
    expect(request.path.key).toBe('PLAN_CONFIG');
    expect(request.body.expectedUpdatedAt).toBeNull();
    expect(savedValue()).toEqual({
      caps: {
        ENTRIES_PER_CONTEST: { FREE: 25, PRO: 50, PREMIUM: 100 },
        SPORTS_LEAGUES_PER_YEAR: { FREE: 1, PRO: 3, PREMIUM: null },
      },
      features: { ...planGroupFixture().value.features, RECORD_BOOK: 'PREMIUM' },
    });
    expect(await screen.findByTestId('root-admin-plans-last-change')).toHaveTextContent('Last changed by Ada Admin');
    expect(screen.getByTestId('root-admin-plans-SPORTS_LEAGUES_PER_YEAR-PREMIUM-unlimited')).toBeChecked();
  });

  it('refuses to save a cap below the plan beneath it, saying so on that plan\'s cell', async () => {
    renderPage();

    await screen.findByTestId('root-admin-plans-form');
    setLimit('root-admin-plans-ENTRIES_PER_CONTEST-PRO-limit', '10');
    fireEvent.click(screen.getByTestId('root-admin-plans-save'));

    const cell = within(screen.getByTestId('root-admin-plans-cap-ENTRIES_PER_CONTEST'));
    expect(await cell.findByText('Can\'t be lower than the plan before it: a limit never falls as the plan rises.')).toBeInTheDocument();
    expect(cell.getByTestId('root-admin-plans-ENTRIES_PER_CONTEST-PRO-limit')).toHaveAttribute('aria-invalid', 'true');
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('refuses to save a number on a plan above one that is unlimited', async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-plans-SPORTS_LEAGUES_PER_YEAR-PRO-unlimited'));
    fireEvent.click(screen.getByTestId('root-admin-plans-save'));

    const cell = within(screen.getByTestId('root-admin-plans-cap-SPORTS_LEAGUES_PER_YEAR'));
    expect(await cell.findByText('Can\'t be lower than the plan before it: a limit never falls as the plan rises.')).toBeInTheDocument();
    expect(cell.getByTestId('root-admin-plans-SPORTS_LEAGUES_PER_YEAR-PREMIUM-limit')).toHaveAttribute('aria-invalid', 'true');
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('refuses to save a cap that is blank, not a whole number, or zero', async () => {
    renderPage();

    await screen.findByTestId('root-admin-plans-form');
    setLimit('root-admin-plans-ENTRIES_PER_CONTEST-FREE-limit', '');
    setLimit('root-admin-plans-ENTRIES_PER_CONTEST-PRO-limit', '2.5');
    setLimit('root-admin-plans-ENTRIES_PER_CONTEST-PREMIUM-limit', '0');
    fireEvent.click(screen.getByTestId('root-admin-plans-save'));

    const cell = within(screen.getByTestId('root-admin-plans-cap-ENTRIES_PER_CONTEST'));
    expect(await cell.findAllByText('Enter a whole number from 1 to 100,000, or choose Unlimited.')).toHaveLength(3);
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('offers to load the newer plans when someone else saved first, then saves against that version', async () => {
    const theirs = savedGroup({
      ...planGroupFixture().value,
      caps: { ...planGroupFixture().value.caps, ENTRIES_PER_CONTEST: { FREE: 30, PRO: 50, PREMIUM: 100 } },
    });
    updateSettingsGroupMock.mockResolvedValueOnce({
      error: { error: { code: 'SETTINGS_CONFLICT', message: 'Settings group PLAN_CONFIG was changed by someone else; reload and try again.' } },
    });
    updateSettingsGroupMock.mockResolvedValueOnce({ data: theirs });
    renderPage();

    fireEvent.click(await screen.findByTestId('root-admin-plans-save'));

    const error = await screen.findByTestId('root-admin-plans-error');
    expect(error).toHaveTextContent('changed by someone else');
    listSettingsGroupsMock.mockResolvedValue({ data: { groups: [theirs] } });
    fireEvent.click(within(error).getByRole('button', { name: 'Load the latest plans' }));

    await waitFor(() => expect(screen.getByTestId('root-admin-plans-ENTRIES_PER_CONTEST-FREE-limit')).toHaveValue('30'));
    expect(screen.queryByTestId('root-admin-plans-error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('root-admin-plans-save'));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(2));
    const [retry] = updateSettingsGroupMock.mock.calls[1] as [{ body: { expectedUpdatedAt: string | null } }];
    expect(retry.body.expectedUpdatedAt).toBe('2026-10-24T08:00:00.000Z');
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanConfig, SettingsGroup } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { planGroupFixture } from './sport-test-fixtures';
import { RootAdminPlansPage } from './root-admin-plans-page';

const { getSettingsGroupMock, listSettingsGroupsMock, updateSettingsGroupMock } = vi.hoisted(() => ({
  getSettingsGroupMock: vi.fn(),
  listSettingsGroupsMock: vi.fn(),
  updateSettingsGroupMock: vi.fn(),
}));

bindApiMocks({
  getSettingsGroup: getSettingsGroupMock,
  listSettingsGroups: listSettingsGroupsMock,
  updateSettingsGroup: updateSettingsGroupMock,
});

const ADMIN = { id: '6f7c1c55-58a4-4bd4-8a2a-0b8e3f1f4a01', name: 'Ada Admin' };
const CAP_DIALOG = 'root-admin-plan-cap-dialog';
const FEATURE_DIALOG = 'root-admin-plan-feature-dialog';
const FALLING = 'Can\'t be lower than the plan before it: a limit never falls as the plan rises.';
const NOT_A_LIMIT = 'Enter a whole number from 1 to 100,000, or choose Unlimited.';

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

function savedRequest(call = 0) {
  const [request] = updateSettingsGroupMock.mock.calls[call] as [{ path: { key: string }; body: { value: PlanConfig; expectedUpdatedAt: string | null } }];
  return request;
}

/** The server's 400 for a cap that falls as the plan rises: a Zod issue on that cell. */
function refuseFallingCap(cap: string, plan: string) {
  updateSettingsGroupMock.mockResolvedValueOnce({
    error: { error: { code: 'SETTINGS_INVALID', message: 'The payload for settings group PLAN_CONFIG is invalid.', details: [{ code: 'custom', path: ['caps', cap, plan], message: 'falls' }] } },
  });
}

async function openCapForEdit(cap: string) {
  await userEvent.click(await screen.findByTestId(`root-admin-plans-cap-${cap}`));
  await userEvent.click(await screen.findByTestId(`${CAP_DIALOG}-edit`));
}

async function typeLimit(plan: string, limit: string) {
  const input = screen.getByTestId(`${CAP_DIALOG}-${plan}-limit`);
  await userEvent.clear(input);
  if (limit !== '') await userEvent.type(input, limit);
}

describe('RootAdminPlansPage', () => {
  beforeEach(() => {
    getSettingsGroupMock.mockReset();
    listSettingsGroupsMock.mockReset();
    updateSettingsGroupMock.mockReset();
    getSettingsGroupMock.mockResolvedValue({ data: planGroupFixture() });
  });

  it('reads only the plans settings group, never the list of every settings group', async () => {
    renderPage();

    await screen.findByTestId('root-admin-plans-caps-table');
    expect(getSettingsGroupMock).toHaveBeenCalledTimes(1);
    const [request] = getSettingsGroupMock.mock.calls[0] as [{ path: { key: string } }];
    expect(request.path.key).toBe('PLAN_CONFIG');
    expect(listSettingsGroupsMock).not.toHaveBeenCalled();
  });

  it('says once under the header how many plans there are and who last changed them', async () => {
    getSettingsGroupMock.mockResolvedValue({ data: savedGroup(planGroupFixture().value) });
    renderPage();

    const line = await screen.findByTestId('root-admin-plans-last-change');
    expect(line).toHaveTextContent('4 plans · Last changed by Ada Admin on');
  });

  it('says the plans were never changed while they are on the starting values', async () => {
    renderPage();

    expect(await screen.findByTestId('root-admin-plans-last-change')).toHaveTextContent('4 plans · Never changed: on the starting values');
  });

  it('shows a Caps grid and a Features grid in standard sections', async () => {
    renderPage();

    expect(await screen.findByRole('region', { name: 'Caps' })).toHaveAttribute('data-testid', 'root-admin-plans-caps');
    expect(screen.getByRole('region', { name: 'Features' })).toHaveAttribute('data-testid', 'root-admin-plans-features');
  });

  it('lists each cap with its limit on every plan, Unlimited as text', async () => {
    getSettingsGroupMock.mockResolvedValue({ data: savedGroup({
      ...planGroupFixture().value,
      caps: { ...planGroupFixture().value.caps, SPORTS_LEAGUES_PER_YEAR: { FREE: 5, PRO: 15, PREMIUM: 30, PLATINUM: null } },
    }) });
    renderPage();

    const entries = within(await screen.findByTestId('root-admin-plans-cap-ENTRIES_PER_CONTEST'));
    expect(entries.getByText('Entries per contest')).toBeInTheDocument();
    for (const limit of ['20', '50', '100', '500']) expect(entries.getByText(limit)).toBeInTheDocument();
    const leagues = within(screen.getByTestId('root-admin-plans-cap-SPORTS_LEAGUES_PER_YEAR'));
    expect(leagues.getByText('Unlimited')).toBeInTheDocument();
  });

  it('sorts Unlimited as the largest limit, last going up and first going down', async () => {
    getSettingsGroupMock.mockResolvedValue({ data: savedGroup({
      ...planGroupFixture().value,
      caps: {
        ENTRIES_PER_CONTEST: { FREE: 20, PRO: 50, PREMIUM: 100, PLATINUM: null },
        SPORTS_LEAGUES_PER_YEAR: { FREE: 5, PRO: 15, PREMIUM: 30, PLATINUM: 50 },
      },
    }) });
    renderPage();
    const shownCaps = () => screen.getAllByTestId(/^root-admin-plans-cap-[A-Z_]+$/).map((row) => row.getAttribute('data-testid'));

    await screen.findByTestId('root-admin-plans-cap-ENTRIES_PER_CONTEST');
    await userEvent.click(screen.getByTestId('data-grid-sort-PLATINUM'));
    expect(shownCaps()).toEqual(['root-admin-plans-cap-SPORTS_LEAGUES_PER_YEAR', 'root-admin-plans-cap-ENTRIES_PER_CONTEST']);
    await userEvent.click(screen.getByTestId('data-grid-sort-PLATINUM'));
    expect(shownCaps()).toEqual(['root-admin-plans-cap-ENTRIES_PER_CONTEST', 'root-admin-plans-cap-SPORTS_LEAGUES_PER_YEAR']);
  });

  it('lists each feature with its group and the plan it starts at', async () => {
    renderPage();

    const results = within(await screen.findByTestId('root-admin-plans-feature-EMAIL_CONTEST_RESULTS'));
    expect(results.getByText('Contest results email')).toBeInTheDocument();
    expect(results.getByText('Emails')).toBeInTheDocument();
    expect(results.getByText('Free')).toBeInTheDocument();
    const recordBook = within(screen.getByTestId('root-admin-plans-feature-RECORD_BOOK'));
    expect(recordBook.getByText('History')).toBeInTheDocument();
    expect(recordBook.getByText('Premium')).toBeInTheDocument();
  });

  it('shows an error, not an endless loading state, when the plans group cannot be read', async () => {
    getSettingsGroupMock.mockResolvedValue({ status: 404, error: { error: { code: 'SETTINGS_GROUP_NOT_FOUND', message: 'Settings group PLAN_CONFIG was not found.' } } });
    renderPage();

    expect(await screen.findByTestId('root-admin-plans-error')).toHaveTextContent('Settings not found.');
    expect(screen.queryByText('Loading plans...')).not.toBeInTheDocument();
  });

  it('opens a cap in view with each plan\'s limit and Close and Edit, then Save sends the whole record with only that cap changed', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: PlanConfig } }) => Promise.resolve({ data: savedGroup(body.value) }));
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-plans-cap-SPORTS_LEAGUES_PER_YEAR'));
    expect(await screen.findByTestId(`${CAP_DIALOG}-FREE`)).toHaveTextContent('5');
    expect(screen.getByTestId(`${CAP_DIALOG}-PLATINUM`)).toHaveTextContent('50');
    expect(screen.queryByTestId(`${CAP_DIALOG}-FREE-limit`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-edit`));
    await typeLimit('FREE', '6');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-PLATINUM-unlimited`));
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-save`));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    const request = savedRequest();
    expect(request.path.key).toBe('PLAN_CONFIG');
    expect(request.body.expectedUpdatedAt).toBeNull();
    expect(request.body.value).toEqual({
      caps: { ...planGroupFixture().value.caps, SPORTS_LEAGUES_PER_YEAR: { FREE: 6, PRO: 15, PREMIUM: 30, PLATINUM: null } },
      features: planGroupFixture().value.features,
    });
    expect(await screen.findByTestId(`${CAP_DIALOG}-edit`)).toBeInTheDocument();
  });

  it('shows the server\'s refusal of a cap below the plan beneath it on that plan alone, not above the form', async () => {
    refuseFallingCap('ENTRIES_PER_CONTEST', 'PRO');
    renderPage();

    await openCapForEdit('ENTRIES_PER_CONTEST');
    await typeLimit('PRO', '10');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-save`));

    const dialog = within(screen.getByTestId(CAP_DIALOG));
    expect(await dialog.findByText(FALLING)).toBeInTheDocument();
    expect(dialog.getByTestId(`${CAP_DIALOG}-PRO-limit`)).toHaveAttribute('aria-invalid', 'true');
    expect(dialog.queryByTestId(`${CAP_DIALOG}-error`)).not.toBeInTheDocument();
    expect(savedRequest().body.value.caps.ENTRIES_PER_CONTEST.PRO).toBe(10);
  });

  it('shows the server\'s refusal of a number on a plan above one that is unlimited on that plan', async () => {
    refuseFallingCap('SPORTS_LEAGUES_PER_YEAR', 'PREMIUM');
    renderPage();

    await openCapForEdit('SPORTS_LEAGUES_PER_YEAR');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-PRO-unlimited`));
    expect(screen.getByTestId(`${CAP_DIALOG}-PRO-limit`)).toHaveValue('Unlimited');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-save`));

    const dialog = within(screen.getByTestId(CAP_DIALOG));
    expect(await dialog.findByText(FALLING)).toBeInTheDocument();
    expect(dialog.getByTestId(`${CAP_DIALOG}-PREMIUM-limit`)).toHaveAttribute('aria-invalid', 'true');
    expect(savedRequest().body.value.caps.SPORTS_LEAGUES_PER_YEAR.PRO).toBeNull();
  });

  it('refuses a limit that is blank, not a whole number, or zero', async () => {
    renderPage();

    await openCapForEdit('ENTRIES_PER_CONTEST');
    await typeLimit('FREE', '');
    await typeLimit('PRO', '2.5');
    await typeLimit('PREMIUM', '0');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-save`));

    expect(await within(screen.getByTestId(CAP_DIALOG)).findAllByText(NOT_A_LIMIT)).toHaveLength(3);
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('Cancel in a cap\'s form goes back to its view unsaved', async () => {
    renderPage();

    await openCapForEdit('ENTRIES_PER_CONTEST');
    await typeLimit('FREE', '25');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByTestId(`${CAP_DIALOG}-FREE`)).toHaveTextContent('20');
    expect(updateSettingsGroupMock).not.toHaveBeenCalled();
  });

  it('opens a feature in view with its group and starting plan, then Save sends the whole record with only that feature changed', async () => {
    updateSettingsGroupMock.mockImplementation(({ body }: { body: { value: PlanConfig } }) => {
      getSettingsGroupMock.mockResolvedValue({ data: savedGroup(body.value) });
      return Promise.resolve({ data: savedGroup(body.value) });
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-plans-feature-RECORD_BOOK'));
    expect(await screen.findByTestId(`${FEATURE_DIALOG}-group`)).toHaveTextContent('History');
    expect(screen.getByTestId(`${FEATURE_DIALOG}-starts-at`)).toHaveTextContent('Premium');

    await userEvent.click(screen.getByTestId(`${FEATURE_DIALOG}-edit`));
    await userEvent.selectOptions(screen.getByTestId(`${FEATURE_DIALOG}-starts-at-select`), 'PLATINUM');
    await userEvent.click(screen.getByTestId(`${FEATURE_DIALOG}-save`));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(1));
    expect(savedRequest().body.value).toEqual({
      caps: planGroupFixture().value.caps,
      features: { ...planGroupFixture().value.features, RECORD_BOOK: 'PLATINUM' },
    });
    expect(await screen.findByTestId(`${FEATURE_DIALOG}-starts-at`)).toHaveTextContent('Platinum');
  });

  it('offers to load the newer plans when someone else saved first, then saves against that version', async () => {
    const theirs = savedGroup({
      ...planGroupFixture().value,
      caps: { ...planGroupFixture().value.caps, ENTRIES_PER_CONTEST: { FREE: 30, PRO: 50, PREMIUM: 100, PLATINUM: 500 } },
    });
    updateSettingsGroupMock.mockResolvedValueOnce({
      error: { error: { code: 'SETTINGS_CONFLICT', message: 'Settings group PLAN_CONFIG was changed by someone else; reload and try again.' } },
    });
    updateSettingsGroupMock.mockResolvedValueOnce({ data: theirs });
    renderPage();

    await openCapForEdit('ENTRIES_PER_CONTEST');
    await typeLimit('PRO', '60');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-save`));

    const error = await screen.findByTestId(`${CAP_DIALOG}-error`);
    expect(error).toHaveTextContent('Someone else changed these settings.');
    getSettingsGroupMock.mockResolvedValue({ data: theirs });
    await userEvent.click(within(error).getByRole('button', { name: 'Load the latest plans' }));

    await waitFor(() => expect(screen.getByTestId(`${CAP_DIALOG}-FREE-limit`)).toHaveValue('30'));
    expect(screen.queryByTestId(`${CAP_DIALOG}-error`)).not.toBeInTheDocument();
    await typeLimit('PRO', '60');
    await userEvent.click(screen.getByTestId(`${CAP_DIALOG}-save`));

    await waitFor(() => expect(updateSettingsGroupMock).toHaveBeenCalledTimes(2));
    expect(savedRequest(1).body.expectedUpdatedAt).toBe('2026-10-24T08:00:00.000Z');
    expect(savedRequest(1).body.value.caps.ENTRIES_PER_CONTEST).toEqual({ FREE: 30, PRO: 60, PREMIUM: 100, PLATINUM: 500 });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TierProfileDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminProfilesPage } from './root-admin-profiles-page';
import { pricingProfilesFixture, sportLeagueFixture, STANDARD_PRICING_PROFILE_ID } from './sport-test-fixtures';

// /manage/sports/profiles (#1849): the tier and pricing profile grids, each row's see-then-Edit
// dialog with the sport leagues naming it, New, and Delete the server refuses while one is used.

const mocks = vi.hoisted(() => ({
  listTierProfiles: vi.fn(),
  createTierProfile: vi.fn(),
  updateTierProfile: vi.fn(),
  deleteTierProfile: vi.fn(),
  listPricingProfiles: vi.fn(),
  createPricingProfile: vi.fn(),
  updatePricingProfile: vi.fn(),
  deletePricingProfile: vi.fn(),
  listSportLeagues: vi.fn(),
}));

bindApiMocks(mocks);

const STAMPS = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const GOLF_ID = '00000000-0000-4000-8000-0000000000a1';
const CAPPED_ID = '00000000-0000-4000-8000-0000000000a2';

function tierProfile(overrides: Partial<TierProfileDto> = {}): TierProfileDto {
  return { id: GOLF_ID, name: '6 tiers of 10', tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null, sportLeagueCount: 2, ...STAMPS, ...overrides };
}

function seed(tierProfiles: TierProfileDto[] = [tierProfile(), tierProfile({ id: CAPPED_ID, name: '4 tiers of 8, capped', tierCount: 4, tierSize: 8, lastTier: 'CAPPED', lastTierMax: 12, sportLeagueCount: 0 })]) {
  mocks.listTierProfiles.mockResolvedValue({ data: { tierProfiles } });
  mocks.listPricingProfiles.mockResolvedValue({ data: { pricingProfiles: pricingProfilesFixture() } });
  mocks.listSportLeagues.mockResolvedValue({
    data: {
      sportLeagues: [
        sportLeagueFixture({ id: 'pga', name: 'PGA Tour', tierProfileId: GOLF_ID }),
        sportLeagueFixture({ id: 'lpga', name: 'LPGA Tour', tierProfileId: GOLF_ID }),
        sportLeagueFixture({ id: 'atp', name: 'ATP', sport: 'TENNIS', tierProfileId: CAPPED_ID, pricingProfileId: '00000000-0000-4000-8000-0000000000b1' }),
      ],
    },
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/profiles']}>
        <RootAdminProfilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminProfilesPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sits under the Sports page\'s header as its Profiles tab, marked, beside Sport leagues', async () => {
    seed();
    renderPage();

    expect(await screen.findByTestId('root-admin-sports-tab-profiles')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-sports-tab-leagues')).toHaveAttribute('href', '/manage/sports');
  });

  it('lists every tier profile with its layout and use, a capped last tier with its cap, and every pricing profile in dollars', async () => {
    seed();
    renderPage();

    const capped = await screen.findByTestId(`root-admin-tier-profile-${CAPPED_ID}`);
    expect(within(capped).getByText('Capped at 12')).toBeInTheDocument();
    expect(within(screen.getByTestId(`root-admin-tier-profile-${GOLF_ID}`)).getByText('All remaining')).toBeInTheDocument();
    const standard = await screen.findByTestId(`root-admin-pricing-profile-${STANDARD_PRICING_PROFILE_ID}`);
    expect(within(standard).getByText('$50,000')).toBeInTheDocument();
    expect(within(standard).getByText('$100')).toBeInTheDocument();
  });

  it('opens a tier profile in view with the sport leagues naming it, then Edit saves the whole profile and comes back to the view', async () => {
    seed();
    mocks.updateTierProfile.mockResolvedValue({ data: { tierProfile: tierProfile({ name: '6 tiers of 12', tierSize: 12 }) } });
    renderPage();

    await userEvent.click(await screen.findByTestId(`root-admin-tier-profile-${GOLF_ID}`));
    const leagues = await screen.findByTestId('root-admin-tier-profile-dialog-leagues');
    expect(within(leagues).getByText('LPGA Tour')).toBeInTheDocument();
    expect(within(leagues).getByText('PGA Tour')).toBeInTheDocument();
    expect(within(leagues).queryByText('ATP')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('root-admin-tier-profile-dialog-edit'));
    const size = await screen.findByTestId('root-admin-tier-profile-editor-tier-size');
    await userEvent.clear(size);
    await userEvent.type(size, '12');
    const name = screen.getByTestId('root-admin-tier-profile-editor-name');
    await userEvent.clear(name);
    await userEvent.type(name, '6 tiers of 12');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-save'));

    await waitFor(() => expect(mocks.updateTierProfile).toHaveBeenCalledWith(expect.objectContaining({
      path: { profileId: GOLF_ID },
      body: { name: '6 tiers of 12', tierCount: 6, tierSize: 12, lastTier: 'ALL_REMAINING', lastTierMax: null },
    })));
    expect(await screen.findByTestId('root-admin-tier-profile-dialog-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-tier-profile-editor-name')).not.toBeInTheDocument();
  });

  it('asks a new tier profile for the most in its last tier only once Capped is chosen, and creates it with that cap', async () => {
    seed();
    mocks.createTierProfile.mockResolvedValue({ data: { tierProfile: tierProfile({ id: 'new', name: '5 of 5, capped', tierCount: 5, tierSize: 5, lastTier: 'CAPPED', lastTierMax: 9, sportLeagueCount: 0 }) } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-tier-profiles-new'));
    await userEvent.type(await screen.findByTestId('root-admin-tier-profile-editor-name'), '5 of 5, capped');
    for (const [field, value] of [['tier-count', '5'], ['tier-size', '5']] as const) {
      const input = screen.getByTestId(`root-admin-tier-profile-editor-${field}`);
      await userEvent.clear(input);
      await userEvent.type(input, value);
    }
    expect(screen.queryByTestId('root-admin-tier-profile-editor-last-tier-max')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('root-admin-tier-profile-editor-last-tier'), 'CAPPED');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-save'));
    expect(await screen.findByText('A capped last tier needs the most it takes.')).toBeInTheDocument();
    expect(mocks.createTierProfile).not.toHaveBeenCalled();

    await userEvent.type(screen.getByTestId('root-admin-tier-profile-editor-last-tier-max'), '9');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-save'));

    await waitFor(() => expect(mocks.createTierProfile).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: '5 of 5, capped', tierCount: 5, tierSize: 5, lastTier: 'CAPPED', lastTierMax: 9 },
    })));
    expect(await screen.findByTestId('root-admin-tier-profile-dialog-leagues-none')).toBeInTheDocument();
  });

  it('shows the server\'s refusal to delete a tier profile a sport league names, keeping the dialog open', async () => {
    seed();
    mocks.deleteTierProfile.mockResolvedValue({
      error: { error: { code: 'TIER_PROFILE_IN_USE', message: 'Tier profile is named by 2 sport leagues, so it cannot be deleted.' } },
      response: { status: 409 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId(`root-admin-tier-profile-${GOLF_ID}-actions`));
    await userEvent.click(await screen.findByTestId(`root-admin-tier-profile-${GOLF_ID}-delete`));
    await userEvent.click(await screen.findByTestId('root-admin-tier-profile-delete-confirm'));

    expect(await screen.findByText('Tier profile is named by 2 sport leagues, so it cannot be deleted.')).toBeInTheDocument();
    expect(mocks.deleteTierProfile).toHaveBeenCalledWith(expect.objectContaining({ path: { profileId: GOLF_ID } }));
    expect(screen.getByTestId('root-admin-tier-profile-delete')).toBeInTheDocument();
  });

  it('deletes a pricing profile no sport league names and reads the list again', async () => {
    seed();
    mocks.deletePricingProfile.mockResolvedValue({ data: undefined, response: { status: 204 } });
    renderPage();
    const small = '00000000-0000-4000-8000-0000000000b1';

    await userEvent.click(await screen.findByTestId(`root-admin-pricing-profile-${small}-actions`));
    await userEvent.click(await screen.findByTestId(`root-admin-pricing-profile-${small}-delete`));
    await userEvent.click(await screen.findByTestId('root-admin-pricing-profile-delete-confirm'));

    await waitFor(() => expect(screen.queryByTestId('root-admin-pricing-profile-delete')).not.toBeInTheDocument());
    expect(mocks.deletePricingProfile).toHaveBeenCalledWith(expect.objectContaining({ path: { profileId: small } }));
    expect(mocks.listPricingProfiles).toHaveBeenCalledTimes(2);
  });

  it('creates a pricing profile, refusing a floor share above the top share before it asks the server', async () => {
    seed();
    const saved = { ...pricingProfilesFixture()[1], id: 'new', name: 'Big', salaryCap: 100000, sportLeagueCount: 0 };
    mocks.createPricingProfile.mockResolvedValue({ data: { pricingProfile: saved } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-pricing-profiles-new'));
    await userEvent.type(await screen.findByTestId('root-admin-pricing-profile-editor-name'), 'Big');
    const cap = screen.getByTestId('root-admin-pricing-profile-editor-salaryCap');
    await userEvent.clear(cap);
    await userEvent.type(cap, '100000');
    const floor = screen.getByTestId('root-admin-pricing-profile-editor-floorSharePercent');
    await userEvent.clear(floor);
    await userEvent.type(floor, '30');
    await userEvent.click(screen.getByTestId('root-admin-pricing-profile-editor-save'));
    expect(mocks.createPricingProfile).not.toHaveBeenCalled();

    await userEvent.clear(floor);
    await userEvent.type(floor, '12');
    await userEvent.click(screen.getByTestId('root-admin-pricing-profile-editor-save'));

    await waitFor(() => expect(mocks.createPricingProfile).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: 'Big', salaryCap: 100000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    })));
    expect(await screen.findByTestId('root-admin-pricing-profile-dialog-edit')).toBeInTheDocument();
  });

  it('shows the server\'s refusal of a pricing profile name another has inside the form, and Cancel goes back to the view', async () => {
    seed();
    mocks.updatePricingProfile.mockResolvedValue({
      error: { error: { code: 'PRICING_PROFILE_NAME_TAKEN', message: 'Another pricing profile is already named "Small".' } },
      response: { status: 409 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId(`root-admin-pricing-profile-${STANDARD_PRICING_PROFILE_ID}`));
    await userEvent.click(await screen.findByTestId('root-admin-pricing-profile-dialog-edit'));
    const name = await screen.findByTestId('root-admin-pricing-profile-editor-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Small');
    await userEvent.click(screen.getByTestId('root-admin-pricing-profile-editor-save'));

    expect(await screen.findByText('Another pricing profile is already named "Small".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('root-admin-pricing-profile-dialog-edit')).toBeInTheDocument();
  });
});

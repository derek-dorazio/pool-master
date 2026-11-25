import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlatformTierProfileDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminProfilesPage } from './root-admin-profiles-page';
import { platformPricingProfilesFixture, sportLeagueFixture, STANDARD_PLATFORM_PRICING_PROFILE_ID } from './sport-test-fixtures';

// /manage/sports/profiles (#1849): the tier and pricing profile grids, each row's see-then-Edit
// dialog with the sport leagues naming it, New, and Delete the server refuses while one is used.

const mocks = vi.hoisted(() => ({
  listPlatformTierProfiles: vi.fn(),
  createPlatformTierProfile: vi.fn(),
  updatePlatformTierProfile: vi.fn(),
  deletePlatformTierProfile: vi.fn(),
  listPlatformPricingProfiles: vi.fn(),
  createPlatformPricingProfile: vi.fn(),
  updatePlatformPricingProfile: vi.fn(),
  deletePlatformPricingProfile: vi.fn(),
  listSportLeagues: vi.fn(),
}));

bindApiMocks(mocks);

const STAMPS = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const GOLF_ID = '00000000-0000-4000-8000-0000000000a1';
const CAPPED_ID = '00000000-0000-4000-8000-0000000000a2';
const RANGES_ID = '00000000-0000-4000-8000-0000000000a3';

type EqualGroupsProfile = Extract<PlatformTierProfileDto, { type: 'EQUAL_GROUPS' }>;

function platformTierProfile(overrides: Partial<EqualGroupsProfile> = {}): EqualGroupsProfile {
  return { id: GOLF_ID, type: 'EQUAL_GROUPS', code: 'TIERS_6_OF_10', name: '6 tiers of 10', sources: ['ODDS', 'SEED', 'RANKING'], tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null, sportLeagueCount: 2, ...STAMPS, ...overrides };
}

/** The NFL's seed profile: tier 1 the 1 seeds, tier 2 seeds 2 to 4, tier 3 the rest. */
function seedRangesProfile(): PlatformTierProfileDto {
  return {
    id: RANGES_ID,
    type: 'RANGES',
    code: 'PLAYOFF_SEEDS_1_4_REST',
    name: 'Playoff seeds 1, 2-4, rest',
    sources: ['SEED', 'ODDS', 'RANKING'],
    ranges: [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }],
    sportLeagueCount: 0,
    ...STAMPS,
  };
}

function seed(platformTierProfiles: PlatformTierProfileDto[] = [platformTierProfile(), platformTierProfile({ id: CAPPED_ID, code: 'TIERS_4_OF_8_CAPPED', name: '4 tiers of 8, capped', tierCount: 4, tierSize: 8, lastTier: 'CAPPED', lastTierMax: 12, sportLeagueCount: 0 })]) {
  mocks.listPlatformTierProfiles.mockResolvedValue({ data: { platformTierProfiles } });
  mocks.listPlatformPricingProfiles.mockResolvedValue({ data: { platformPricingProfiles: platformPricingProfilesFixture() } });
  mocks.listSportLeagues.mockResolvedValue({
    data: {
      sportLeagues: [
        sportLeagueFixture({ id: 'pga', name: 'PGA Tour', platformTierProfileId: GOLF_ID }),
        sportLeagueFixture({ id: 'lpga', name: 'LPGA Tour', platformTierProfileId: GOLF_ID }),
        sportLeagueFixture({ id: 'atp', name: 'ATP', sport: 'TENNIS', platformTierProfileId: CAPPED_ID, platformPricingProfileId: '00000000-0000-4000-8000-0000000000b1' }),
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

  it('lists every tier profile with its sources, layout and use, a capped last tier with its cap, a ranges profile with its ranges, and every pricing profile in dollars', async () => {
    seed([platformTierProfile(), platformTierProfile({ id: CAPPED_ID, code: 'TIERS_4_OF_8_CAPPED', name: '4 tiers of 8, capped', tierCount: 4, tierSize: 8, lastTier: 'CAPPED', lastTierMax: 12, sportLeagueCount: 0 }), seedRangesProfile()]);
    renderPage();

    const capped = await screen.findByTestId(`root-admin-tier-profile-${CAPPED_ID}`);
    expect(within(capped).getByText('4 × 8, last tier capped at 12')).toBeInTheDocument();
    const golf = screen.getByTestId(`root-admin-tier-profile-${GOLF_ID}`);
    expect(within(golf).getByText('6 × 10, last tier all remaining')).toBeInTheDocument();
    expect(within(golf).getByText('Odds, Seed, Rank')).toBeInTheDocument();
    const ranges = screen.getByTestId(`root-admin-tier-profile-${RANGES_ID}`);
    expect(within(ranges).getByText('Ranges: 1 · 2–4 · 5+')).toBeInTheDocument();
    expect(within(ranges).getByText('Seed, Odds, Rank')).toBeInTheDocument();
    const standard = await screen.findByTestId(`root-admin-pricing-profile-${STANDARD_PLATFORM_PRICING_PROFILE_ID}`);
    expect(within(standard).getByText('$50,000')).toBeInTheDocument();
    expect(within(standard).getByText('$100')).toBeInTheDocument();
  });

  it('opens a tier profile in view with the sport leagues naming it, then Edit saves the whole profile and comes back to the view', async () => {
    seed();
    mocks.updatePlatformTierProfile.mockResolvedValue({ data: { platformTierProfile: platformTierProfile({ name: '6 tiers of 12', tierSize: 12 }) } });
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

    await waitFor(() => expect(mocks.updatePlatformTierProfile).toHaveBeenCalledWith(expect.objectContaining({
      path: { profileId: GOLF_ID },
      body: { type: 'EQUAL_GROUPS', code: 'TIERS_6_OF_10', name: '6 tiers of 12', sources: ['ODDS', 'SEED', 'RANKING'], tierCount: 6, tierSize: 12, lastTier: 'ALL_REMAINING', lastTierMax: null },
    })));
    expect(await screen.findByTestId('root-admin-tier-profile-dialog-edit')).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-tier-profile-editor-name')).not.toBeInTheDocument();
  });

  it('asks a new tier profile for the most in its last tier once Capped is chosen, shows the server\'s refusal of a cap left blank under the cap field alone, and creates it with that cap', async () => {
    seed();
    mocks.createPlatformTierProfile
      .mockResolvedValueOnce({
        error: { error: { code: 'PLATFORM_TIER_PROFILE_INVALID', message: 'A capped last tier needs the most it takes.' } },
        response: { status: 422 },
      })
      .mockResolvedValue({ data: { platformTierProfile: platformTierProfile({ id: 'new', code: 'TIERS_5_OF_5_CAPPED', name: '5 of 5, capped', tierCount: 5, tierSize: 5, lastTier: 'CAPPED', lastTierMax: 9, sportLeagueCount: 0 }) } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-tier-profiles-new'));
    await userEvent.type(await screen.findByTestId('root-admin-tier-profile-editor-code'), 'TIERS_5_OF_5_CAPPED');
    await userEvent.type(screen.getByTestId('root-admin-tier-profile-editor-name'), '5 of 5, capped');
    for (const [field, value] of [['tier-count', '5'], ['tier-size', '5']] as const) {
      const input = screen.getByTestId(`root-admin-tier-profile-editor-${field}`);
      await userEvent.clear(input);
      await userEvent.type(input, value);
    }
    expect(screen.queryByTestId('root-admin-tier-profile-editor-last-tier-max')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByTestId('root-admin-tier-profile-editor-last-tier'), 'CAPPED');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-save'));
    expect(await screen.findByText('Enter the most the last tier takes.')).toBeInTheDocument();
    expect(screen.queryByText('A capped last tier needs the most it takes, and one that takes everyone left has no cap.')).not.toBeInTheDocument();
    expect(mocks.createPlatformTierProfile).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByTestId('root-admin-tier-profile-editor-last-tier-max'), '9');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-save'));

    await waitFor(() => expect(mocks.createPlatformTierProfile).toHaveBeenCalledWith(expect.objectContaining({
      body: { type: 'EQUAL_GROUPS', code: 'TIERS_5_OF_5_CAPPED', name: '5 of 5, capped', sources: ['ODDS', 'SEED', 'RANKING'], tierCount: 5, tierSize: 5, lastTier: 'CAPPED', lastTierMax: 9 },
    })));
    expect(await screen.findByTestId('root-admin-tier-profile-dialog-leagues-none')).toBeInTheDocument();
  });

  it('creates a ranges tier profile ordered by seed first, each range numbered by its place, and sends no equal-groups values', async () => {
    seed();
    mocks.createPlatformTierProfile.mockResolvedValue({ data: { platformTierProfile: seedRangesProfile() } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-tier-profiles-new'));
    await userEvent.type(await screen.findByTestId('root-admin-tier-profile-editor-code'), 'PLAYOFF_SEEDS_1_4_REST');
    await userEvent.type(screen.getByTestId('root-admin-tier-profile-editor-name'), 'Playoff seeds 1, 2-4, rest');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-sources-SEED-up'));
    await userEvent.selectOptions(screen.getByTestId('root-admin-tier-profile-editor-type'), 'RANGES');
    expect(screen.queryByTestId('root-admin-tier-profile-editor-tier-count')).not.toBeInTheDocument();
    const to0 = screen.getByTestId('root-admin-tier-profile-editor-range-to-0');
    await userEvent.type(to0, '1');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-range-add'));
    const from1 = screen.getByTestId('root-admin-tier-profile-editor-range-from-1');
    await userEvent.clear(from1);
    await userEvent.type(from1, '2');
    await userEvent.type(screen.getByTestId('root-admin-tier-profile-editor-range-to-1'), '4');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-range-add'));
    const from2 = screen.getByTestId('root-admin-tier-profile-editor-range-from-2');
    await userEvent.clear(from2);
    await userEvent.type(from2, '5');
    await userEvent.click(screen.getByTestId('root-admin-tier-profile-editor-save'));

    await waitFor(() => expect(mocks.createPlatformTierProfile).toHaveBeenCalledWith(expect.objectContaining({
      body: {
        type: 'RANGES',
        code: 'PLAYOFF_SEEDS_1_4_REST',
        name: 'Playoff seeds 1, 2-4, rest',
        sources: ['SEED', 'ODDS', 'RANKING'],
        ranges: [{ tierNumber: 1, fromValue: 1, toValue: 1 }, { tierNumber: 2, fromValue: 2, toValue: 4 }, { tierNumber: 3, fromValue: 5, toValue: null }],
      },
    })));
  });

  it('shows the server\'s refusal to delete a tier profile a sport league names, keeping the dialog open', async () => {
    seed();
    mocks.deletePlatformTierProfile.mockResolvedValue({
      error: { error: { code: 'PLATFORM_TIER_PROFILE_IN_USE', message: 'Tier profile is named by 2 sport leagues, so it cannot be deleted.' } },
      response: { status: 409 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId(`root-admin-tier-profile-${GOLF_ID}-actions`));
    await userEvent.click(await screen.findByTestId(`root-admin-tier-profile-${GOLF_ID}-delete`));
    await userEvent.click(await screen.findByTestId('root-admin-tier-profile-delete-confirm'));

    expect(await screen.findByText('This tier profile is in use, so it cannot be deleted.')).toBeInTheDocument();
    expect(mocks.deletePlatformTierProfile).toHaveBeenCalledWith(expect.objectContaining({ path: { profileId: GOLF_ID } }));
    expect(screen.getByTestId('root-admin-tier-profile-delete')).toBeInTheDocument();
  });

  it('deletes a pricing profile no sport league names and reads the list again', async () => {
    seed();
    mocks.deletePlatformPricingProfile.mockResolvedValue({ data: undefined, response: { status: 204 } });
    renderPage();
    const small = '00000000-0000-4000-8000-0000000000b1';

    await userEvent.click(await screen.findByTestId(`root-admin-pricing-profile-${small}-actions`));
    await userEvent.click(await screen.findByTestId(`root-admin-pricing-profile-${small}-delete`));
    await userEvent.click(await screen.findByTestId('root-admin-pricing-profile-delete-confirm'));

    await waitFor(() => expect(screen.queryByTestId('root-admin-pricing-profile-delete')).not.toBeInTheDocument());
    expect(mocks.deletePlatformPricingProfile).toHaveBeenCalledWith(expect.objectContaining({ path: { profileId: small } }));
    expect(mocks.listPlatformPricingProfiles).toHaveBeenCalledTimes(2);
  });

  it('creates a pricing profile, refusing a floor share above the top share before it asks the server', async () => {
    seed();
    const saved = { ...platformPricingProfilesFixture()[1], id: 'new', code: 'BIG', name: 'Big', salaryCap: 100000, sportLeagueCount: 0 };
    mocks.createPlatformPricingProfile.mockResolvedValue({ data: { platformPricingProfile: saved } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-pricing-profiles-new'));
    await userEvent.type(await screen.findByTestId('root-admin-pricing-profile-editor-code'), 'BIG');
    await userEvent.type(screen.getByTestId('root-admin-pricing-profile-editor-name'), 'Big');
    const cap = screen.getByTestId('root-admin-pricing-profile-editor-salaryCap');
    await userEvent.clear(cap);
    await userEvent.type(cap, '100000');
    const floor = screen.getByTestId('root-admin-pricing-profile-editor-floorSharePercent');
    await userEvent.clear(floor);
    await userEvent.type(floor, '30');
    await userEvent.click(screen.getByTestId('root-admin-pricing-profile-editor-save'));
    expect(mocks.createPlatformPricingProfile).not.toHaveBeenCalled();

    await userEvent.clear(floor);
    await userEvent.type(floor, '12');
    await userEvent.click(screen.getByTestId('root-admin-pricing-profile-editor-save'));

    await waitFor(() => expect(mocks.createPlatformPricingProfile).toHaveBeenCalledWith(expect.objectContaining({
      body: { code: 'BIG', name: 'Big', sources: ['ODDS', 'SEED', 'RANKING'], salaryCap: 100000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 },
    })));
    expect(await screen.findByTestId('root-admin-pricing-profile-dialog-edit')).toBeInTheDocument();
  });

  it('shows the server\'s refusal of a pricing profile name another has inside the form, and Cancel goes back to the view', async () => {
    seed();
    mocks.updatePlatformPricingProfile.mockResolvedValue({
      error: { error: { code: 'PLATFORM_PRICING_PROFILE_NAME_TAKEN', message: 'Another pricing profile is already named "Small".' } },
      response: { status: 409 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId(`root-admin-pricing-profile-${STANDARD_PLATFORM_PRICING_PROFILE_ID}`));
    await userEvent.click(await screen.findByTestId('root-admin-pricing-profile-dialog-edit'));
    const name = await screen.findByTestId('root-admin-pricing-profile-editor-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Small');
    await userEvent.click(screen.getByTestId('root-admin-pricing-profile-editor-save'));

    expect(await screen.findByText('A pricing profile already uses that name.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('root-admin-pricing-profile-dialog-edit')).toBeInTheDocument();
  });
});

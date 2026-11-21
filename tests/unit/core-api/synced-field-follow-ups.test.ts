import { FieldOrderBasis } from '@poolmaster/shared/domain';
import { DISCARD_BACKGROUND_JOB } from '../../../packages/core-api/src/modules/background-jobs/background-job-outcome';
import {
  SyncedFieldFollowUps,
  type SyncEventGamesAndTiersJobPayload,
} from '../../../packages/core-api/src/modules/events/synced-field-follow-up-job';
import type { ProviderGameSlateService } from '../../../packages/core-api/src/modules/events/provider-game-slate';
import type { SyncedFieldValuationService } from '../../../packages/core-api/src/modules/events/synced-field-valuation';
import { mockFn } from '../../support/mock-fn';

// The SYNC_EVENT_GAMES_AND_TIERS job (#1952): what a field sync used to run inline after its
// write, the provider's games and then the tiers and prices, now run from the job's payload.

const KICKOFF = '2026-09-13T17:00:00.000Z';
const PAYLOAD: SyncEventGamesAndTiersJobPayload = {
  sportEventId: 'sport-event-1',
  providerId: 'balldontlie',
  externalId: 'week-2',
  games: [{ externalGameId: 'g1', roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: 'lions', scheduledAt: KICKOFF, isNeutralSite: false }],
};

const UNCHANGED_VALUATION = {
  outcome: 'VALUED' as const,
  sportEventId: 'sport-event-1',
  tiers: { result: 'UNCHANGED' as const, basis: FieldOrderBasis.ODDS, tierCount: 4 },
  prices: { result: 'UNCHANGED' as const, basis: FieldOrderBasis.ODDS, pricedCount: 32, profileName: 'Standard' },
};

function followUps(options: {
  slate?: Awaited<ReturnType<ProviderGameSlateService['afterFieldLoad']>>;
  valuation?: Awaited<ReturnType<SyncedFieldValuationService['afterFieldLoad']>>;
} = {}) {
  const steps: string[] = [];
  const providerGames = { afterFieldLoad: mockFn<ProviderGameSlateService['afterFieldLoad']>(async () => { steps.push('games'); return options.slate ?? null; }) };
  const valuation = { afterFieldLoad: mockFn<SyncedFieldValuationService['afterFieldLoad']>(async () => { steps.push('tiers'); return options.valuation ?? UNCHANGED_VALUATION; }) };
  return { steps, providerGames, valuation, service: new SyncedFieldFollowUps({ providerGames, valuation }) };
}

describe('SyncedFieldFollowUps, a field sync\'s follow-up job', () => {
  it('syncs the provider\'s games first, with their kickoffs back as instants, and then tiers and prices the field', async () => {
    const { steps, providerGames, valuation, service } = followUps({ slate: { outcome: 'LOADED', sportEventId: 'sport-event-1', matchCount: 1 } });

    await service.run(PAYLOAD);

    expect(steps).toEqual(['games', 'tiers']);
    expect(providerGames.afterFieldLoad).toHaveBeenCalledWith({
      providerId: 'balldontlie',
      externalId: 'week-2',
      games: [{ externalGameId: 'g1', roundNumber: 1, homeTeamExternalId: 'bears', awayTeamExternalId: 'lions', scheduledAt: new Date(KICKOFF), isNeutralSite: false }],
    });
    expect(valuation.afterFieldLoad).toHaveBeenCalledWith({ providerId: 'balldontlie', externalId: 'week-2' });
  });

  it('passes a bracket with no kickoff yet as null, and lists no games when the provider listed none', async () => {
    const { providerGames, service } = followUps();
    const bracket = [{ matchNumber: 1, roundNumber: 1, homeTeamExternalId: null, awayTeamExternalId: 'lions', isNeutralSite: false, scheduledAt: null, advancesTo: { matchNumber: 5, side: 'HOME' as const }, regionLabel: 'NFC' }];

    await service.run({ sportEventId: 'sport-event-1', providerId: 'balldontlie', externalId: 'postseason', bracket });

    expect(providerGames.afterFieldLoad).toHaveBeenCalledWith({ providerId: 'balldontlie', externalId: 'postseason', bracket });
  });

  it('reports the games it loaded and the tiers and prices it made, with the run\'s stats, as the job\'s result', async () => {
    const { service } = followUps({
      slate: { outcome: 'MATCHES_UPDATED', sportEventId: 'sport-event-1', matchNumbers: [1, 2] },
      valuation: { ...UNCHANGED_VALUATION, tiers: { result: 'MADE', basis: FieldOrderBasis.ODDS, tierCount: 4 }, prices: { result: 'MADE', basis: FieldOrderBasis.ODDS, pricedCount: 32, profileName: 'Standard' } },
    });

    expect(await service.run(PAYLOAD)).toEqual({
      changedCount: 2 + 4 + 32,
      result: {
        games: { outcome: 'MATCHES_UPDATED', sportEventId: 'sport-event-1', matchNumbers: [1, 2] },
        stats: { tiersMadeFromOdds: 4, pricesMadeFromOdds: 32 },
        warnings: [],
      },
    });
  });

  it('keeps a run that changed nothing but failed to tier and price, so Activity shows the warning', async () => {
    const { service } = followUps({ valuation: { outcome: 'FAILED', message: 'no tier profile' } });

    expect(await service.run(PAYLOAD)).toEqual({
      changedCount: 0,
      result: {
        games: { outcome: 'NO_GAMES_LISTED' },
        stats: {},
        warnings: [{ code: 'TIERS_AND_PRICES_NOT_MADE', message: 'Tiers and prices were not made from the field: no tier profile' }],
      },
    });
  });

  it('leaves no Activity row for a run that changed nothing and has nothing to report, as most repeat syncs are', async () => {
    const { service } = followUps({ slate: { outcome: 'UNCHANGED', sportEventId: 'sport-event-1' } });

    expect(await service.run(PAYLOAD)).toBe(DISCARD_BACKGROUND_JOB);
  });
});

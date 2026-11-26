import { sportPlay } from '../../support/sport-play';
import { expect } from '@jest/globals';
import type { SportLeagueSeasonRepository } from '@poolmaster/shared/db';
import { FieldOrderBasis, ProviderCode, Sport } from '@poolmaster/shared/domain';
import type { Participant, SportLeague, SportLeagueSeasonSlot } from '@poolmaster/shared/domain';
import { SportLeagueService, type SportDataProviderLookup } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';
import {
  fakeParticipantProviderMappingRepo,
  fakeParticipantRepo,
  fakeSportEventRepo,
  fakeSportLeagueRepo,
  fakeSportRepo,
} from '../../support/repo-fakes';

// SportLeagueService's own logic: resolving the sport, merging counts, the duplicate
// guards, and resolving upload rows. What the repositories do with a write (atomicity,
// ordering, scoping) is asserted against Postgres in sport-catalog-repositories.integration.

const GOLF = { id: 'sport-golf', sport: Sport.GOLF } as never;
const BASKETBALL = { id: 'sport-basketball', sport: Sport.BASKETBALL } as never;

function sportLeague(overrides: Partial<SportLeague> = {}): SportLeague {
  return {
    id: 'sl-pga',
    sportId: 'sport-golf',
    name: 'PGA Tour',
    urlSegment: 'pga-tour',
    platformTierProfileId: 'tier-profile-1',
    platformPricingProfileId: 'pricing-profile-1',
    matchPeriodLayout: null,
    squaresFromRound: null,
    ...sportPlay(Sport.GOLF),
    noun: null,
    displayOrder: null,
    currentSeasonId: null,
    timeZone: 'America/New_York',
    isActive: true,
    selectedProviderMapping: null,
    autoReleaseDaysBeforeStart: 7,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** A provider league the test's providers list: its id, its sport and whether it and its provider are on. */
interface TestProviderLeague { id: string; code: string; sport: Sport; isEnabled?: boolean; providerEnabled?: boolean }

/**
 * The providers for the test: the provider leagues their rows list, and which provider leagues the
 * adapters running here read, by Provider code and league code.
 */
function registeredProviders(readLeagues: Partial<Record<ProviderCode, readonly string[]>>, leagues: TestProviderLeague[] = []): SportDataProviderLookup {
  return {
    findLeague: (providerLeagueId) => {
      const league = leagues.find((candidate) => candidate.id === providerLeagueId);
      return league && {
        provider: { code: ProviderCode.BALLDONTLIE, name: 'BALLDONTLIE', isEnabled: league.providerEnabled ?? true },
        league: { code: league.code, sport: league.sport, isEnabled: league.isEnabled ?? true },
      };
    },
    readsLeague: (providerCode, providerLeagueCode) => readLeagues[providerCode]?.includes(providerLeagueCode) ?? false,
  };
}

/** A league mapped to BALLDONTLIE's PGA TOUR and syncing from it. */
const SYNCED_TO_PGA = {
  id: 'mapping-pga', providerLeagueId: 'pl-pga', providerLeagueCode: 'pga', providerLeagueName: 'PGA TOUR',
  providerCode: ProviderCode.BALLDONTLIE, providerName: 'BALLDONTLIE', providerId: 'balldontlie',
};

function participant(id: string, name: string): Participant {
  return { id, name } as Participant;
}

function buildService(overrides: {
  sports?: Parameters<typeof fakeSportRepo>[0];
  sportLeagues?: Parameters<typeof fakeSportLeagueRepo>[0];
  sportEvents?: Parameters<typeof fakeSportEventRepo>[0];
  participants?: Parameters<typeof fakeParticipantRepo>[0];
  mappings?: Parameters<typeof fakeParticipantProviderMappingRepo>[0];
  providers?: SportDataProviderLookup;
  seasons?: Partial<Pick<SportLeagueSeasonRepository, 'createTestSlot' | 'findSlot'>>;
  platformTierProfiles?: { findById: jest.Mock; findBySportLeague?: jest.Mock };
  platformPricingProfiles?: { findById: jest.Mock; findBySportLeague?: jest.Mock };
} = {}) {
  const deps = {
    sports: fakeSportRepo({ findBySport: jest.fn().mockResolvedValue(GOLF), findAll: jest.fn().mockResolvedValue([GOLF, BASKETBALL]), ...overrides.sports }),
    sportLeagues: fakeSportLeagueRepo({
      findById: jest.fn().mockResolvedValue(sportLeague()),
      // A real update returns the whole row, sport included.
      update: jest.fn().mockImplementation(async (id: string, updates: Partial<SportLeague>) => sportLeague({ id, ...updates })),
      ...overrides.sportLeagues,
    }),
    sportEvents: fakeSportEventRepo(overrides.sportEvents),
    participants: fakeParticipantRepo(overrides.participants),
    seasons: { createTestSlot: jest.fn(), findSlot: jest.fn().mockResolvedValue(null), ...overrides.seasons },
    mappings: fakeParticipantProviderMappingRepo(overrides.mappings),
    providers: overrides.providers ?? registeredProviders({}),
    platformTierProfiles: {
      findById: jest.fn().mockImplementation(async (id: string) => ({ id, name: '6 tiers of 10', sources: [FieldOrderBasis.ODDS] })),
      findBySportLeague: jest.fn().mockResolvedValue({ id: 'tier-profile-1', name: '6 tiers of 10', sources: [FieldOrderBasis.ODDS] }),
      ...overrides.platformTierProfiles,
    },
    platformPricingProfiles: {
      findById: jest.fn().mockImplementation(async (id: string) => ({ id, name: 'Standard', sources: [FieldOrderBasis.ODDS] })),
      findBySportLeague: jest.fn().mockResolvedValue({ id: 'pricing-profile-1', name: 'Standard', sources: [FieldOrderBasis.ODDS] }),
      ...overrides.platformPricingProfiles,
    },
  };
  return { service: new SportLeagueService(deps), deps };
}

describe('SportLeagueService — sport leagues', () => {
  it('lists the sport\'s sport leagues with their sport and their participant and event counts, zero where there are none', async () => {
    const { service } = buildService({
      sportLeagues: { findAll: jest.fn().mockResolvedValue([sportLeague(), sportLeague({ id: 'sl-champions', name: 'Champions Tour', urlSegment: 'champions-tour' })]) },
      participants: { countBySportLeagues: jest.fn().mockResolvedValue(new Map([['sl-pga', 144]])) },
      sportEvents: { countBySportLeagues: jest.fn().mockResolvedValue(new Map([['sl-pga', 3]])) },
    });

    const result = await service.listSportLeagues({ sport: Sport.GOLF, isActive: true });

    expect(result.map((row) => [row.name, row.sport, row.participantCount, row.sportEventCount])).toEqual([
      ['PGA Tour', Sport.GOLF, 144, 3],
      ['Champions Tour', Sport.GOLF, 0, 0],
    ]);
  });

  it('fails with 404 SPORT_NOT_FOUND when the sport has no Sport row yet', async () => {
    const { service } = buildService({ sports: { findBySport: jest.fn().mockResolvedValue(null) } });

    await expect(service.listSportLeagues({ sport: Sport.GOLF })).rejects.toMatchObject({ code: 'SPORT_NOT_FOUND', statusCode: 404 });
  });

});

describe('SportLeagueService — tier and pricing profiles', () => {
  it('refuses a move to an unknown tier profile with 404 PLATFORM_TIER_PROFILE_NOT_FOUND, updating nothing', async () => {
    const { service, deps } = buildService({ platformTierProfiles: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.updateSportLeague('sl-pga', { platformTierProfileId: 'tier-profile-gone' }))
      .rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NOT_FOUND', statusCode: 404 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('refuses a move to an unknown pricing profile with 404 PLATFORM_PRICING_PROFILE_NOT_FOUND, updating nothing', async () => {
    const { service, deps } = buildService({ platformPricingProfiles: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.updateSportLeague('sl-pga', { platformPricingProfileId: 'pricing-profile-gone' }))
      .rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_NOT_FOUND', statusCode: 404 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('moves a sport league to another tier profile, checking it against the pricing profile the league already names rather than one it was not sent', async () => {
    const { service, deps } = buildService();

    await expect(service.updateSportLeague('sl-pga', { platformTierProfileId: 'tier-profile-2' })).resolves.toMatchObject({ platformTierProfileId: 'tier-profile-2' });
    expect(deps.platformPricingProfiles.findById).not.toHaveBeenCalled();
    expect(deps.platformPricingProfiles.findBySportLeague).toHaveBeenCalledWith('sl-pga');
  });

  it('refuses (422 PROFILE_FIRST_SOURCES_DIFFER) a tier profile that starts with seed for a league whose pricing profile starts with odds, updating nothing', async () => {
    const { service, deps } = buildService({
      platformTierProfiles: { findById: jest.fn().mockResolvedValue({ id: 'seed-ranges', name: 'Playoff seeds', sources: [FieldOrderBasis.SEED, FieldOrderBasis.ODDS] }) },
    });

    await expect(service.updateSportLeague('sl-pga', { platformTierProfileId: 'seed-ranges' }))
      .rejects.toMatchObject({ code: 'PROFILE_FIRST_SOURCES_DIFFER', statusCode: 422 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('accepts a tier and a pricing profile sent together that both start with seed, though the league\'s current pricing profile starts with odds', async () => {
    const seedFirst = [FieldOrderBasis.SEED, FieldOrderBasis.ODDS];
    const { service, deps } = buildService({
      platformTierProfiles: { findById: jest.fn().mockResolvedValue({ id: 'seed-ranges', name: 'Playoff seeds', sources: seedFirst }) },
      platformPricingProfiles: { findById: jest.fn().mockResolvedValue({ id: 'standard-by-seed', name: 'Standard by seed', sources: seedFirst }) },
    });

    await expect(service.updateSportLeague('sl-pga', { platformTierProfileId: 'seed-ranges', platformPricingProfileId: 'standard-by-seed' })).resolves.toBeDefined();
    expect(deps.sportLeagues.update).toHaveBeenCalled();
  });

  it('reads no profile when the update names neither', async () => {
    const { service, deps } = buildService();

    await service.updateSportLeague('sl-pga', { autoReleaseDaysBeforeStart: 3 });

    expect(deps.platformTierProfiles.findBySportLeague).not.toHaveBeenCalled();
    expect(deps.platformPricingProfiles.findBySportLeague).not.toHaveBeenCalled();
  });
});

describe('SportLeagueService — event sync (ADR 0011)', () => {
  const leagues: TestProviderLeague[] = [
    { id: 'pl-pga', code: 'pga', sport: Sport.GOLF },
    { id: 'pl-epl', code: 'epl', sport: Sport.SOCCER },
    { id: 'pl-off', code: 'lpga', sport: Sport.GOLF, isEnabled: false },
    { id: 'pl-provider-off', code: 'pga', sport: Sport.GOLF, providerEnabled: false },
  ];
  const golfProviders = registeredProviders({ [ProviderCode.BALLDONTLIE]: ['pga', 'nba'] }, leagues);
  const golfSport = { findById: jest.fn().mockResolvedValue(GOLF) };

  it('turns a league\'s event sync on with an enabled provider league of its sport whose provider runs here', async () => {
    const { service, deps } = buildService({ providers: golfProviders, sports: golfSport });
    await service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'pl-pga' });
    expect(deps.sportLeagues.update).toHaveBeenCalledWith('sl-pga', expect.objectContaining({ syncProviderLeagueId: 'pl-pga' }));
  });

  it('refuses a provider league that does not exist with 404 PROVIDER_LEAGUE_NOT_FOUND and saves nothing', async () => {
    const { service, deps } = buildService({ providers: golfProviders, sports: golfSport });
    await expect(service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'nobody' }))
      .rejects.toMatchObject({ code: 'PROVIDER_LEAGUE_NOT_FOUND', statusCode: 404 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('refuses a provider league of another sport with 422 PROVIDER_SPORT_MISMATCH', async () => {
    const { service, deps } = buildService({ providers: golfProviders, sports: golfSport });
    await expect(service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'pl-epl' }))
      .rejects.toMatchObject({ code: 'PROVIDER_SPORT_MISMATCH', statusCode: 422 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('refuses a provider league that is switched off, or whose provider is, with 422 PROVIDER_NOT_FOUND', async () => {
    const { service, deps } = buildService({ providers: golfProviders, sports: golfSport });
    await expect(service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'pl-off' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 422 });
    await expect(service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'pl-provider-off' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 422 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('refuses a provider league whose provider is not running here, as when its key is not set, with 422 PROVIDER_NOT_FOUND', async () => {
    const { service } = buildService({ providers: registeredProviders({}, leagues), sports: golfSport });
    await expect(service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'pl-pga' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 422 });
  });

  it('refuses a provider league its running adapter does not read, as one enabled since the task started, with 422 PROVIDER_NOT_FOUND', async () => {
    const { service, deps } = buildService({ providers: registeredProviders({ [ProviderCode.BALLDONTLIE]: ['nba'] }, leagues), sports: golfSport });
    await expect(service.updateSportLeague('sl-pga', { syncProviderLeagueId: 'pl-pga' }))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 422 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('turns sync off with null even once the provider is no longer running', async () => {
    const { service, deps } = buildService({
      providers: registeredProviders({}),
      sportLeagues: { findById: jest.fn().mockResolvedValue(sportLeague({ selectedProviderMapping: SYNCED_TO_PGA })) },
    });
    await service.updateSportLeague('sl-pga', { syncProviderLeagueId: null });
    expect(deps.sportLeagues.update).toHaveBeenCalledWith('sl-pga', expect.objectContaining({ syncProviderLeagueId: null }));
  });

  it('leaves a synced league\'s provider unchecked by an edit that changes only its name', async () => {
    const { service, deps } = buildService({
      providers: registeredProviders({}),
      sportLeagues: { findById: jest.fn().mockResolvedValue(sportLeague({ selectedProviderMapping: SYNCED_TO_PGA })) },
    });
    await service.updateSportLeague('sl-pga', { name: 'PGA TOUR' });
    expect(deps.sportLeagues.update).toHaveBeenCalled();
  });
});

describe('SportLeagueService — no sport league made outside a migration (#2075)', () => {
  it('offers no way to add a sport league, so no league gains a Season except by migration', () => {
    const { deps } = buildService();

    // A test slot is the one thing the service makes; leagues and their Seasons come from migrations.
    expect(Object.getOwnPropertyNames(SportLeagueService.prototype).filter((name) => name.startsWith('create'))).toEqual(['createTestSlot']);
    expect(Object.keys(deps.sportLeagues).filter((name) => name.startsWith('create'))).toEqual([]);
  });
});

describe('SportLeagueService — the sport league\'s participants', () => {
  it('lists the sport league\'s own participants, and 404s an unknown sport league', async () => {
    const roster = [participant('p-rory', 'Rory McIlroy')];
    const findBySportLeague = jest.fn().mockResolvedValue(roster);
    const { service } = buildService({ participants: { findBySportLeague } });

    await expect(service.listParticipants('sl-pga')).resolves.toEqual(roster);
    expect(findBySportLeague).toHaveBeenCalledWith('sl-pga', false);
    await service.listParticipants('sl-pga', true);
    expect(findBySportLeague).toHaveBeenLastCalledWith('sl-pga', true);

    const { service: missing } = buildService({ sportLeagues: { findById: jest.fn().mockResolvedValue(null) } });
    await expect(missing.listParticipants('missing')).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });

  it('sets rankings on the sport league\'s participants and answers with the re-read roster', async () => {
    const { service, deps } = buildService();

    await service.updateRankings('sl-pga', [{ participantId: 'p-rory', ranking: 2 }]);

    expect(deps.participants.updateRankings).toHaveBeenCalledWith('sl-pga', [{ participantId: 'p-rory', ranking: 2 }]);
    expect(deps.participants.findBySportLeague).toHaveBeenCalledWith('sl-pga');
  });
});

describe('SportLeagueService — ranking upload', () => {
  it('resolves by participantId, then a feed id one of its provider mappings holds, then exact case-insensitive name, within the sport league', async () => {
    const candidates = [
      participant('p-1', 'Scottie Scheffler'),
      participant('p-2', 'Rory McIlroy'),
      participant('p-3', 'Jon Rahm'),
    ];
    const findMatchingAny = jest.fn().mockImplementation(async (sportLeagueId: string) => (sportLeagueId === 'sl-pga' ? candidates : []));
    const findByParticipantIds = jest.fn().mockResolvedValue([{ participantId: 'p-2', externalId: 'owgr-2' }]);
    const { service } = buildService({ participants: { findMatchingAny }, mappings: { findByParticipantIds } });

    const preview = await service.previewRankingUpload('sl-pga', [
      { participantId: 'p-1', externalId: 'ignored', ranking: 1 },
      { externalId: 'owgr-2', ranking: 2 },
      { playerName: 'jon rahm', ranking: 3 },
    ]);

    expect(preview.map((row) => [row.resolution, row.participantId, row.participantName])).toEqual([
      ['MATCHED', 'p-1', 'Scottie Scheffler'],
      ['MATCHED', 'p-2', 'Rory McIlroy'],
      ['MATCHED', 'p-3', 'Jon Rahm'],
    ]);
  });

  it('reads every row\'s candidates in one query, asking only for each row\'s first identifier', async () => {
    const findMatchingAny = jest.fn().mockResolvedValue([]);
    const { service } = buildService({ participants: { findMatchingAny } });

    await service.previewRankingUpload('sl-pga', [
      { participantId: 'p-1', externalId: 'ignored' },
      { externalId: 'owgr-2' },
      { playerName: 'jon rahm' },
      { ranking: 5 },
    ]);

    expect(findMatchingAny).toHaveBeenCalledTimes(1);
    expect(findMatchingAny).toHaveBeenCalledWith('sl-pga', [{ id: 'p-1' }, { externalId: 'owgr-2' }, { name: 'jon rahm' }]);
  });

  it('marks a row AMBIGUOUS when several participants match, and UNRESOLVED when none do or no identifier is given', async () => {
    const findMatchingAny = jest.fn().mockResolvedValue([participant('p-a', 'Smith'), participant('p-b', 'Smith')]);
    const { service } = buildService({ participants: { findMatchingAny } });

    const preview = await service.previewRankingUpload('sl-pga', [
      { playerName: 'Smith' },
      { playerName: 'Nobody' },
      { ranking: 5 },
    ]);

    expect(preview.map((row) => row.resolution)).toEqual(['AMBIGUOUS', 'UNRESOLVED', 'UNRESOLVED']);
    expect(preview.every((row) => row.participantId === null)).toBe(true);
  });

  it('fails with 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league', async () => {
    const { service } = buildService({ sportLeagues: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.previewRankingUpload('missing', [{ participantId: 'p-1' }]))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });

  it('refuses to apply an upload with any unresolved row with 422, handing nothing to the repository', async () => {
    const { service, deps } = buildService();

    await expect(service.applyRankingUpload('sl-pga', [{ participantId: 'missing' }]))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_RANKING_UPLOAD_UNRESOLVED_ROWS', statusCode: 422 });
    expect(deps.participants.updateRankings).not.toHaveBeenCalled();
  });

  it('applies a fully resolved upload as one set of rankings, unranked rows as null', async () => {
    const { service, deps } = buildService({
      participants: {
        findMatchingAny: jest.fn().mockResolvedValue([participant('p-1', 'x'), participant('p-2', 'y')]),
      },
    });

    await service.applyRankingUpload('sl-pga', [{ participantId: 'p-1', ranking: 4 }, { participantId: 'p-2' }]);

    expect(deps.participants.updateRankings).toHaveBeenCalledWith('sl-pga', [
      { participantId: 'p-1', ranking: 4 },
      { participantId: 'p-2', ranking: null },
    ]);
  });
});

describe('SportLeagueService — deleting a sport league (#1400)', () => {
  it('deletes a sport league nothing uses', async () => {
    const { service, deps } = buildService();

    await expect(service.deleteSportLeague('sl-pga')).resolves.toBeUndefined();

    expect(deps.sportLeagues.deleteUnlessUsed).toHaveBeenCalledWith('sl-pga');
  });

  it('refuses with 409 SPORT_LEAGUE_IN_USE naming every use the locked count found', async () => {
    const { service } = buildService({
      sportLeagues: { deleteUnlessUsed: jest.fn().mockResolvedValue({ sportEventCount: 3, contestTemplateCount: 1, eventPageOfferCount: 2, cupCount: 1, participantCount: 144 }) },
    });

    await expect(service.deleteSportLeague('sl-pga')).rejects.toMatchObject({
      code: 'SPORT_LEAGUE_IN_USE',
      statusCode: 409,
      message: 'PGA Tour still has 3 events, 1 contest setup, 2 event page offers, 1 league cup, 144 participants, so it cannot be deleted.',
    });
  });

  it('answers 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league and deletes nothing', async () => {
    const { service, deps } = buildService({ sportLeagues: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.deleteSportLeague('sl-missing')).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    expect(deps.sportLeagues.deleteUnlessUsed).not.toHaveBeenCalled();
  });

  it('answers 404 SPORT_LEAGUE_NOT_FOUND when another delete took the sport league before the lock', async () => {
    const { service } = buildService({ sportLeagues: { deleteUnlessUsed: jest.fn().mockResolvedValue(null) } });

    await expect(service.deleteSportLeague('sl-pga')).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });
});

describe('SportLeagueService — adding a test slot (#2004)', () => {
  const input = { slotDefinitionId: 'def-1', label: 'QA 1', startsAt: new Date('2026-06-01T12:00:00Z'), endsAt: null };
  const slot = { id: 'slot-1', label: 'QA 1', isTestData: true } as SportLeagueSeasonSlot;
  const inSeason = { findById: jest.fn().mockResolvedValue(sportLeague({ currentSeasonId: 'season-2026' })) };

  it('adds the slot to the league\'s current Season and answers it', async () => {
    const createTestSlot = jest.fn().mockResolvedValue({ outcome: 'CREATED', slot });
    const { service } = buildService({ sportLeagues: inSeason, seasons: { createTestSlot } });
    await expect(service.createTestSlot('sl-pga', input)).resolves.toBe(slot);
    expect(createTestSlot).toHaveBeenCalledWith({ ...input, sportLeagueId: 'sl-pga', sportLeagueSeasonId: 'season-2026' });
  });

  it('refuses an unknown league with 404 SPORT_LEAGUE_NOT_FOUND', async () => {
    const { service } = buildService({ sportLeagues: { findById: jest.fn().mockResolvedValue(null) } });
    await expect(service.createTestSlot('sl-none', input)).rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });

  it('refuses a league with no current Season with 422 SPORT_LEAGUE_HAS_NO_SEASON', async () => {
    const { service } = buildService({ sportLeagues: { findById: jest.fn().mockResolvedValue(sportLeague({ currentSeasonId: null })) } });
    await expect(service.createTestSlot('sl-pga', input)).rejects.toMatchObject({ code: 'SPORT_LEAGUE_HAS_NO_SEASON', statusCode: 422 });
  });

  it('refuses a slot that ends before it starts with 422 TEST_SLOT_ENDS_BEFORE_START, adding nothing', async () => {
    const createTestSlot = jest.fn();
    const { service } = buildService({ sportLeagues: inSeason, seasons: { createTestSlot } });
    await expect(service.createTestSlot('sl-pga', { ...input, endsAt: new Date('2026-05-31T12:00:00Z') })).rejects.toMatchObject({ code: 'TEST_SLOT_ENDS_BEFORE_START', statusCode: 422 });
    expect(createTestSlot).not.toHaveBeenCalled();
  });

  it('refuses a label the Season already has on that definition with 409 TEST_SLOT_LABEL_TAKEN', async () => {
    const taken = buildService({ sportLeagues: inSeason, seasons: { createTestSlot: jest.fn().mockResolvedValue({ outcome: 'LABEL_TAKEN' }) } });
    await expect(taken.service.createTestSlot('sl-pga', input)).rejects.toMatchObject({ code: 'TEST_SLOT_LABEL_TAKEN', statusCode: 409 });
  });

  it('refuses a definition that is not the league\'s with 404 SLOT_DEFINITION_NOT_FOUND', async () => {
    const { service } = buildService({ sportLeagues: inSeason, seasons: { createTestSlot: jest.fn().mockResolvedValue({ outcome: 'DEFINITION_NOT_FOUND' }) } });
    await expect(service.createTestSlot('sl-pga', input)).rejects.toMatchObject({ code: 'SLOT_DEFINITION_NOT_FOUND', statusCode: 404 });
  });

  it('refuses a definition whose phase the current Season lacks with 422 SLOT_COMPETITION_NOT_IN_SEASON', async () => {
    const { service } = buildService({ sportLeagues: inSeason, seasons: { createTestSlot: jest.fn().mockResolvedValue({ outcome: 'COMPETITION_NOT_IN_SEASON' }) } });
    await expect(service.createTestSlot('sl-pga', input)).rejects.toMatchObject({ code: 'SLOT_COMPETITION_NOT_IN_SEASON', statusCode: 422 });
  });
});

describe('SportLeagueService — removing a test slot (#2075)', () => {
  const testSlot = { id: 'slot-1', label: 'E2E run', isTestData: true } as SportLeagueSeasonSlot;
  const found = (overrides: { slot?: SportLeagueSeasonSlot; sportLeagueId?: string; sportEventId?: string | null } = {}) => ({
    slot: testSlot, sportLeagueId: 'sl-pga', sportLeagueSeasonId: 'season-2026', sportEventId: 'event-1', ...overrides,
  });

  it('removes the slot with its event and that field\'s orphaned test participants in one repository write', async () => {
    const { service, deps } = buildService({
      seasons: { findSlot: jest.fn().mockResolvedValue(found()) },
      sportEvents: { countContests: jest.fn().mockResolvedValue(new Map([['event-1', 0]])), deleteTestSlot: jest.fn().mockResolvedValue(2) },
    });

    await service.deleteTestSlot('sl-pga', 'slot-1');

    expect(deps.sportEvents.deleteTestSlot).toHaveBeenCalledWith('slot-1', 'event-1');
    expect(deps.sportEvents.delete).not.toHaveBeenCalled();
  });

  it('removes a free test slot, with no event to remove', async () => {
    const { service, deps } = buildService({ seasons: { findSlot: jest.fn().mockResolvedValue(found({ sportEventId: null })) } });

    await service.deleteTestSlot('sl-pga', 'slot-1');

    expect(deps.sportEvents.deleteTestSlot).toHaveBeenCalledWith('slot-1', null);
    expect(deps.sportEvents.countContests).not.toHaveBeenCalled();
  });

  it('refuses a slot the sync keeps with 422 SEASON_SLOT_NOT_TEST, removing nothing', async () => {
    const { service, deps } = buildService({ seasons: { findSlot: jest.fn().mockResolvedValue(found({ slot: { ...testSlot, isTestData: false, label: null } })) } });

    await expect(service.deleteTestSlot('sl-pga', 'slot-1')).rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_TEST', statusCode: 422 });
    expect(deps.sportEvents.deleteTestSlot).not.toHaveBeenCalled();
  });

  it('refuses an unknown slot, and another league\'s, with 404 SEASON_SLOT_NOT_FOUND', async () => {
    const unknown = buildService();
    const elsewhere = buildService({ seasons: { findSlot: jest.fn().mockResolvedValue(found({ sportLeagueId: 'sl-other' })) } });

    await expect(unknown.service.deleteTestSlot('sl-pga', 'slot-1')).rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_FOUND', statusCode: 404 });
    await expect(elsewhere.service.deleteTestSlot('sl-pga', 'slot-1')).rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_FOUND', statusCode: 404 });
    expect(elsewhere.deps.sportEvents.deleteTestSlot).not.toHaveBeenCalled();
  });

  it('refuses while a contest still covers the slot\'s event with 409 EVENT_HAS_CONTESTS, removing nothing', async () => {
    const { service, deps } = buildService({
      seasons: { findSlot: jest.fn().mockResolvedValue(found()) },
      sportEvents: { countContests: jest.fn().mockResolvedValue(new Map([['event-1', 2]])) },
    });

    await expect(service.deleteTestSlot('sl-pga', 'slot-1')).rejects.toMatchObject({ code: 'EVENT_HAS_CONTESTS', statusCode: 409 });
    expect(deps.sportEvents.deleteTestSlot).not.toHaveBeenCalled();
  });
});

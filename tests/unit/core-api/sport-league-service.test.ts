import { sportPlay } from '../../support/sport-play';
import { expect } from '@jest/globals';
import { BracketAdvancement, ProviderCode, Sport } from '@poolmaster/shared/domain';
import type { Participant, SportLeague } from '@poolmaster/shared/domain';
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
/** The profiles a new sport league names (#1844). */
const PROFILES = { platformTierProfileId: 'tier-profile-1', platformPricingProfileId: 'pricing-profile-1' };

function sportLeague(overrides: Partial<SportLeague> = {}): SportLeague {
  return {
    id: 'sl-pga',
    sportId: 'sport-golf',
    name: 'PGA Tour',
    urlSegment: 'pga-tour',
    bracketAdvancement: BracketAdvancement.FIXED,
    roundNames: [],
    platformTierProfileId: 'tier-profile-1',
    platformPricingProfileId: 'pricing-profile-1',
    matchPeriodLayout: null,
    squaresFromRound: null,
    ...sportPlay(Sport.GOLF),
    noun: null,
    displayName: null,
    displayOrder: null,
    currentEventYear: null,
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
 * The providers for the test: the provider leagues their rows list, and which providers run here,
 * by id, each with the sports it covers.
 */
function registeredProviders(sportsById: Record<string, Sport[]>, leagues: TestProviderLeague[] = []): SportDataProviderLookup {
  const covered = new Map(Object.entries(sportsById));
  return {
    findLeague: (providerLeagueId) => {
      const league = leagues.find((candidate) => candidate.id === providerLeagueId);
      return league && {
        provider: { code: ProviderCode.BALLDONTLIE, name: 'BALLDONTLIE', isEnabled: league.providerEnabled ?? true },
        league: { code: league.code, sport: league.sport, isEnabled: league.isEnabled ?? true },
      };
    },
    getProviderById: (providerId) => {
      const sportsCovered = covered.get(providerId);
      return sportsCovered ? { sportsCovered } : null;
    },
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
  platformTierProfiles?: { findById: jest.Mock };
  platformPricingProfiles?: { findById: jest.Mock };
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
    mappings: fakeParticipantProviderMappingRepo(overrides.mappings),
    providers: overrides.providers ?? registeredProviders({}),
    platformTierProfiles: overrides.platformTierProfiles ?? { findById: jest.fn().mockImplementation(async (id: string) => ({ id, name: '6 tiers of 10' })) },
    platformPricingProfiles: overrides.platformPricingProfiles ?? { findById: jest.fn().mockImplementation(async (id: string) => ({ id, name: 'Standard' })) },
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

  it('creates a sport league — adding the Champions Tour is one call, not a migration', async () => {
    const { service } = buildService();

    const created = await service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'Champions Tour', urlSegment: 'champions-tour' });

    expect(created).toMatchObject({ sportId: 'sport-golf', name: 'Champions Tour', urlSegment: 'champions-tour' });
  });

  it('rejects a sport league name already used for the sport with 409', async () => {
    const { service } = buildService({ sportLeagues: { findBySportAndName: jest.fn().mockResolvedValue(sportLeague()) } });

    await expect(service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'PGA Tour', urlSegment: 'pga-tour' }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NAME_ALREADY_EXISTS', statusCode: 409 });
  });

  it('rejects a URL segment another league of the sport already has with 409, creating nothing', async () => {
    const { service, deps } = buildService({ sportLeagues: { findBySportAndUrlSegment: jest.fn().mockResolvedValue(sportLeague()) } });

    await expect(service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'Champions Tour', urlSegment: 'pga-tour' }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_URL_SEGMENT_ALREADY_EXISTS', statusCode: 409 });
    expect(deps.sportLeagues.create).not.toHaveBeenCalled();
  });

  it('stores the URL segment a new sport league is given', async () => {
    const { service, deps } = buildService();

    await service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'Champions Tour', urlSegment: 'champions-tour' });

    expect(deps.sportLeagues.create).toHaveBeenCalledWith(expect.objectContaining({ urlSegment: 'champions-tour' }));
  });
});

describe('SportLeagueService — tier and pricing profiles', () => {
  it('creates a sport league naming the tier and pricing profiles it is given', async () => {
    const { service, deps } = buildService();

    await service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'Champions Tour', urlSegment: 'champions-tour' });

    expect(deps.sportLeagues.create).toHaveBeenCalledWith(expect.objectContaining(PROFILES));
  });

  it('refuses a new sport league naming an unknown tier profile with 404 PLATFORM_TIER_PROFILE_NOT_FOUND, creating nothing', async () => {
    const { service, deps } = buildService({ platformTierProfiles: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'Champions Tour', urlSegment: 'champions-tour' }))
      .rejects.toMatchObject({ code: 'PLATFORM_TIER_PROFILE_NOT_FOUND', statusCode: 404 });
    expect(deps.sportLeagues.create).not.toHaveBeenCalled();
  });

  it('refuses a move to an unknown pricing profile with 404 PLATFORM_PRICING_PROFILE_NOT_FOUND, updating nothing', async () => {
    const { service, deps } = buildService({ platformPricingProfiles: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.updateSportLeague('sl-pga', { platformPricingProfileId: 'pricing-profile-gone' }))
      .rejects.toMatchObject({ code: 'PLATFORM_PRICING_PROFILE_NOT_FOUND', statusCode: 404 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('moves a sport league to another tier profile without looking up a pricing profile it was not sent', async () => {
    const { service, deps } = buildService();

    await expect(service.updateSportLeague('sl-pga', { platformTierProfileId: 'tier-profile-2' })).resolves.toMatchObject({ platformTierProfileId: 'tier-profile-2' });
    expect(deps.platformPricingProfiles.findById).not.toHaveBeenCalled();
  });
});

describe('SportLeagueService — bracket advancement', () => {

  it('creates a sport league fixed by default, and one that reseeds when its sport plays a bracket', async () => {
    const { service } = buildService({ sports: { findBySport: jest.fn().mockResolvedValue(BASKETBALL) } });

    await expect(service.createSportLeague(Sport.BASKETBALL, { ...PROFILES, ...sportPlay(Sport.BASKETBALL), name: 'Harbour Conference', urlSegment: 'harbour-conference' })).resolves.toMatchObject({ bracketAdvancement: BracketAdvancement.FIXED });
    await expect(service.createSportLeague(Sport.BASKETBALL, { ...PROFILES, ...sportPlay(Sport.BASKETBALL), name: 'Gridiron League', urlSegment: 'gridiron-league', bracketAdvancement: BracketAdvancement.RESEED_BY_SEED }))
      .resolves.toMatchObject({ bracketAdvancement: BracketAdvancement.RESEED_BY_SEED });
  });

  it('refuses (422 SPORT_LEAGUE_NOT_BRACKET) a golf sport league that reseeds, on create and on update, writing nothing', async () => {
    const { service, deps } = buildService({ sports: { findById: jest.fn().mockResolvedValue(GOLF) } });

    await expect(service.createSportLeague(Sport.GOLF, { ...PROFILES, ...sportPlay(Sport.GOLF), name: 'Champions Tour', urlSegment: 'champions-tour', bracketAdvancement: BracketAdvancement.RESEED_BY_SEED }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_BRACKET', statusCode: 422 });
    await expect(service.updateSportLeague('sl-pga', { bracketAdvancement: BracketAdvancement.RESEED_BY_SEED }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_BRACKET', statusCode: 422 });
    expect(deps.sportLeagues.create).not.toHaveBeenCalled();
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('refuses (409 SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED) switching a reseeding league to fixed while one of its events has a bracket loaded, writing nothing', async () => {
    const { service, deps } = buildService({
      sports: { findById: jest.fn().mockResolvedValue(BASKETBALL) },
      sportLeagues: { findById: jest.fn().mockResolvedValue(sportLeague({ sportId: 'sport-basketball', bracketAdvancement: BracketAdvancement.RESEED_BY_SEED })) },
      sportEvents: { sportLeagueHasLoadedBracket: jest.fn().mockResolvedValue(true) },
    });

    await expect(service.updateSportLeague('sl-pga', { bracketAdvancement: BracketAdvancement.FIXED }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED', statusCode: 409 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('accepts the bracket rule a league already has, and a change once none of its events has a bracket loaded', async () => {
    const reseeding = sportLeague({ sportId: 'sport-basketball', bracketAdvancement: BracketAdvancement.RESEED_BY_SEED });
    const loaded = buildService({
      sports: { findById: jest.fn().mockResolvedValue(BASKETBALL) },
      sportLeagues: { findById: jest.fn().mockResolvedValue(reseeding), update: jest.fn().mockResolvedValue(reseeding) },
      sportEvents: { sportLeagueHasLoadedBracket: jest.fn().mockResolvedValue(true) },
    });
    await expect(loaded.service.updateSportLeague('sl-pga', { bracketAdvancement: BracketAdvancement.RESEED_BY_SEED }))
      .resolves.toMatchObject({ bracketAdvancement: BracketAdvancement.RESEED_BY_SEED });

    const fixed = { ...reseeding, bracketAdvancement: BracketAdvancement.FIXED };
    const unloaded = buildService({
      sports: { findById: jest.fn().mockResolvedValue(BASKETBALL) },
      sportLeagues: { findById: jest.fn().mockResolvedValue(reseeding), update: jest.fn().mockResolvedValue(fixed) },
      sportEvents: { sportLeagueHasLoadedBracket: jest.fn().mockResolvedValue(false) },
    });
    await expect(unloaded.service.updateSportLeague('sl-pga', { bracketAdvancement: BracketAdvancement.FIXED }))
      .resolves.toMatchObject({ bracketAdvancement: BracketAdvancement.FIXED });
  });
});

// plans/147 decision 6 — "set as current" used to be a foreign key to a season, so the database
// guaranteed the target existed. currentEventYear is a plain integer; this check is that guarantee.
describe('SportLeagueService — event sync (ADR 0011)', () => {
  const leagues: TestProviderLeague[] = [
    { id: 'pl-pga', code: 'pga', sport: Sport.GOLF },
    { id: 'pl-epl', code: 'epl', sport: Sport.SOCCER },
    { id: 'pl-off', code: 'lpga', sport: Sport.GOLF, isEnabled: false },
    { id: 'pl-provider-off', code: 'pga', sport: Sport.GOLF, providerEnabled: false },
  ];
  const golfProviders = registeredProviders({ balldontlie: [Sport.GOLF, Sport.BASKETBALL] }, leagues);
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

describe('SportLeagueService — set as current (plans/147 decision 6)', () => {
  it('refuses a year the sport league has no events in with 422 EVENT_YEAR_HAS_NO_EVENTS, writing nothing', async () => {
    const countBySportLeagues = jest.fn().mockResolvedValue(new Map([['sl-pga', 0]]));
    const { service, deps } = buildService({ sportEvents: { countBySportLeagues } });

    await expect(service.updateSportLeague('sl-pga', { currentEventYear: 1823 }))
      .rejects.toMatchObject({ code: 'EVENT_YEAR_HAS_NO_EVENTS', statusCode: 422 });
    expect(countBySportLeagues).toHaveBeenCalledWith(['sl-pga'], { eventYear: 1823 });
    expect(deps.sportLeagues.update).not.toHaveBeenCalled();
  });

  it('sets a year the sport league has events in, in one write on the sport league', async () => {
    const { service, deps } = buildService({
      sportEvents: { countBySportLeagues: jest.fn().mockResolvedValue(new Map([['sl-pga', 4]])) },
    });

    await service.updateSportLeague('sl-pga', { currentEventYear: 2026 });

    expect(deps.sportLeagues.update).toHaveBeenCalledWith('sl-pga', expect.objectContaining({ currentEventYear: 2026 }));
  });

  it('checks nothing when the update does not touch the current year', async () => {
    const countBySportLeagues = jest.fn().mockResolvedValue(new Map());
    const { service } = buildService({ sportEvents: { countBySportLeagues } });

    await service.updateSportLeague('sl-pga', { name: 'PGA TOUR' });

    expect(countBySportLeagues).not.toHaveBeenCalledWith(['sl-pga'], expect.objectContaining({ eventYear: expect.anything() }));
  });
});

describe('SportLeagueService — the sport league\'s participants', () => {
  it('lists the sport league\'s own participants, and 404s an unknown sport league', async () => {
    const roster = [participant('p-rory', 'Rory McIlroy')];
    const findBySportLeague = jest.fn().mockResolvedValue(roster);
    const { service } = buildService({ participants: { findBySportLeague } });

    await expect(service.listParticipants('sl-pga')).resolves.toEqual(roster);
    expect(findBySportLeague).toHaveBeenCalledWith('sl-pga');

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

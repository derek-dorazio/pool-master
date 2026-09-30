import { Sport } from '@poolmaster/shared/domain';
import type { Participant, SportLeague } from '@poolmaster/shared/domain';
import { SportLeagueService } from '../../../packages/core-api/src/modules/sport-catalog/sport-league-service';
import {
  fakeParticipantLeagueAffiliationRepo,
  fakeParticipantRepo,
  fakeSeasonRepo,
  fakeSportLeagueRepo,
  fakeSportRepo,
} from '../../support/repo-fakes';

// SportLeagueService's own logic: resolving the sport, merging counts, the duplicate
// guards, and resolving upload rows. What the repositories do with a write (atomicity,
// ordering, scoping) is asserted against Postgres in sport-catalog-repositories.integration.

const GOLF = { id: 'sport-golf', name: Sport.GOLF } as never;

function sportLeague(overrides: Partial<SportLeague> = {}): SportLeague {
  return {
    id: 'sl-pga',
    sportId: 'sport-golf',
    name: 'PGA Tour',
    matchKeyword: 'PGA',
    currentSeasonId: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function participant(id: string, name: string): Participant {
  return { id, name } as Participant;
}

function buildService(overrides: {
  sports?: Parameters<typeof fakeSportRepo>[0];
  sportLeagues?: Parameters<typeof fakeSportLeagueRepo>[0];
  seasons?: Parameters<typeof fakeSeasonRepo>[0];
  affiliations?: Parameters<typeof fakeParticipantLeagueAffiliationRepo>[0];
  participants?: Parameters<typeof fakeParticipantRepo>[0];
} = {}) {
  const deps = {
    sports: fakeSportRepo({ findByName: jest.fn().mockResolvedValue(GOLF), ...overrides.sports }),
    sportLeagues: fakeSportLeagueRepo({ findById: jest.fn().mockResolvedValue(sportLeague()), ...overrides.sportLeagues }),
    seasons: fakeSeasonRepo(overrides.seasons),
    affiliations: fakeParticipantLeagueAffiliationRepo(overrides.affiliations),
    participants: fakeParticipantRepo(overrides.participants),
  };
  return { service: new SportLeagueService(deps), deps };
}

describe('SportLeagueService — sport leagues', () => {
  it('lists the sport\'s sport leagues with their affiliation and season counts, zero where there are none', async () => {
    const { service } = buildService({
      sportLeagues: { findAll: jest.fn().mockResolvedValue([sportLeague(), sportLeague({ id: 'sl-champions', name: 'Champions Tour' })]) },
      affiliations: { countBySportLeagues: jest.fn().mockResolvedValue(new Map([['sl-pga', 144]])) },
      seasons: { countBySportLeagues: jest.fn().mockResolvedValue(new Map([['sl-pga', 3]])) },
    });

    const result = await service.listSportLeagues(Sport.GOLF, { isActive: true });

    expect(result.map((row) => [row.name, row.affiliationCount, row.seasonCount])).toEqual([
      ['PGA Tour', 144, 3],
      ['Champions Tour', 0, 0],
    ]);
  });

  it('fails with 404 SPORT_NOT_FOUND when the sport has no Sport row yet', async () => {
    const { service } = buildService({ sports: { findByName: jest.fn().mockResolvedValue(null) } });

    await expect(service.listSportLeagues(Sport.GOLF)).rejects.toMatchObject({ code: 'SPORT_NOT_FOUND', statusCode: 404 });
  });

  it('creates a sport league — adding the Champions Tour is one call, not a migration', async () => {
    const { service } = buildService();

    const created = await service.createSportLeague(Sport.GOLF, { name: 'Champions Tour' });

    expect(created).toMatchObject({ sportId: 'sport-golf', name: 'Champions Tour', matchKeyword: null });
  });

  it('rejects a sport league name already used for the sport with 409', async () => {
    const { service } = buildService({ sportLeagues: { findBySportAndName: jest.fn().mockResolvedValue(sportLeague()) } });

    await expect(service.createSportLeague(Sport.GOLF, { name: 'PGA Tour' }))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NAME_ALREADY_EXISTS', statusCode: 409 });
  });
});

describe('SportLeagueService — affiliations', () => {
  it('affiliates a participant, and rejects affiliating them twice with 409', async () => {
    const { service } = buildService();
    await expect(service.addAffiliation('sl-pga', 'p-rory')).resolves.toMatchObject({ participantId: 'p-rory' });

    const { service: again } = buildService({
      affiliations: { find: jest.fn().mockResolvedValue({ participantId: 'p-rory' }) },
    });
    await expect(again.addAffiliation('sl-pga', 'p-rory'))
      .rejects.toMatchObject({ code: 'LEAGUE_ROSTER_ENTRY_ALREADY_EXISTS', statusCode: 409 });
  });
});

describe('SportLeagueService — affiliation upload', () => {
  it('resolves by participantId, then externalId, then exact case-insensitive name, within the sport league\'s sport', async () => {
    const findMatching = jest.fn().mockImplementation(async (sportId: string, query: { id?: string; externalId?: string; name?: string }) => {
      if (sportId !== 'sport-golf') return [];
      if (query.id === 'p-1') return [participant('p-1', 'Scottie Scheffler')];
      if (query.externalId === 'owgr-2') return [participant('p-2', 'Rory McIlroy')];
      if (query.name === 'jon rahm') return [participant('p-3', 'Jon Rahm')];
      return [];
    });
    const { service } = buildService({ participants: { findMatching } });

    const preview = await service.previewAffiliationUpload('sl-pga', [
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

  it('marks a row AMBIGUOUS when several participants match, and UNRESOLVED when none do or no identifier is given', async () => {
    const findMatching = jest.fn().mockImplementation(async (_sportId: string, query: { name?: string }) => (
      query.name === 'Smith' ? [participant('p-a', 'Smith'), participant('p-b', 'Smith')] : []
    ));
    const { service } = buildService({ participants: { findMatching } });

    const preview = await service.previewAffiliationUpload('sl-pga', [
      { playerName: 'Smith' },
      { playerName: 'Nobody' },
      { ranking: 5 },
    ]);

    expect(preview.map((row) => row.resolution)).toEqual(['AMBIGUOUS', 'UNRESOLVED', 'UNRESOLVED']);
    expect(preview.every((row) => row.participantId === null)).toBe(true);
  });

  it('fails with 404 SPORT_LEAGUE_NOT_FOUND for an unknown sport league', async () => {
    const { service } = buildService({ sportLeagues: { findById: jest.fn().mockResolvedValue(null) } });

    await expect(service.previewAffiliationUpload('missing', [{ participantId: 'p-1' }]))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
  });

  it('refuses to apply an upload with any unresolved row with 422, handing nothing to the repository', async () => {
    const { service, deps } = buildService();

    await expect(service.applyAffiliationUpload('sl-pga', [{ participantId: 'missing' }]))
      .rejects.toMatchObject({ code: 'LEAGUE_ROSTER_UPLOAD_UNRESOLVED_ROWS', statusCode: 422 });
    expect(deps.affiliations.upsertRankings).not.toHaveBeenCalled();
  });

  it('applies a fully resolved upload as one set of rankings, unranked rows as null', async () => {
    const { service, deps } = buildService({
      participants: {
        findMatching: jest.fn().mockImplementation(async (_sportId: string, query: { id?: string }) => [participant(query.id as string, 'x')]),
      },
    });

    await service.applyAffiliationUpload('sl-pga', [{ participantId: 'p-1', ranking: 4 }, { participantId: 'p-2' }]);

    expect(deps.affiliations.upsertRankings).toHaveBeenCalledWith('sl-pga', [
      { participantId: 'p-1', ranking: 4 },
      { participantId: 'p-2', ranking: null },
    ]);
  });
});

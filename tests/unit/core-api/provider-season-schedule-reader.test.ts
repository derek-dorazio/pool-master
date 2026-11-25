import { expect } from '@jest/globals';
import type { ProviderCode } from '@poolmaster/shared/domain';
import {
  ProviderSeasonScheduleError,
  ProviderSeasonScheduleReader,
} from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import { ProviderLeagueRefusedError, type SportDataProvider } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { fakeSportDataProvider, registryWith } from '../../support/fake-sport-data-provider';
import { asPrismaClient } from '../../support/prisma-double';

function buildProviderEvent(overrides: Record<string, unknown> = {}) {
  return {
    externalId: 'ext-1',
    providerId: 'mock-golf',
    sport: 'GOLF',
    name: 'The Masters',
    startDate: new Date('2027-04-08T00:00:00.000Z'),
    endDate: new Date('2027-04-11T00:00:00.000Z'),
    status: 'SCHEDULED',
    metadata: {},
    ...overrides,
  };
}

function buildProvider(overrides: Partial<SportDataProvider> = {}): SportDataProvider {
  return fakeSportDataProvider({
    providerId: 'mock-golf',
    getUpcomingEvents: jest.fn().mockResolvedValue([buildProviderEvent()]),
    ...overrides,
  });
}

/** BALLDONTLIE's id: a league's selected mapping names its provider by its row (#1997). */
const SYNCED_PROVIDER = 'balldontlie';

/** A sport league row read with its selected provider mapping, as the service reads it; null code: not synced. */
function leagueRow(providerLeagueCode: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: 'league-1', name: 'PGA TOUR', sport: { sport: 'GOLF' }, ...extra,
    selectedProviderMapping: providerLeagueCode === null ? null : {
      id: 'mapping-1',
      providerLeague: { id: 'provider-league-1', code: providerLeagueCode, name: providerLeagueCode.toUpperCase(), provider: { code: 'BALLDONTLIE', name: 'BALLDONTLIE' } },
    },
  };
}

describe('ProviderSeasonScheduleReader.listSeasonEvents', () => {
  const pgaLeague = leagueRow('pga');
  const syncedProvider = (overrides: Partial<SportDataProvider> = {}) => buildProvider({ providerId: SYNCED_PROVIDER, ...overrides });

  it('returns only events of the league\'s provider league, by their code, so the PGA TOUR does not pick up the LPGA', async () => {
    const provider = syncedProvider({
      getUpcomingEvents: jest.fn().mockResolvedValue([
        buildProviderEvent({ externalId: 'pga-1', name: 'Alpha Open', venue: 'A Links', providerLeagueCode: 'pga' }),
        buildProviderEvent({ externalId: 'lpga-1', name: 'LPGA Alpha', providerLeagueCode: 'lpga' }),
        buildProviderEvent({ externalId: 'none-1', name: 'PGA TOUR Exhibition' }),
      ]),
    });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(provider));

    const events = await service.listSeasonEvents('pga', '2027');

    expect(events).toEqual([{
      externalId: 'pga-1',
      name: 'Alpha Open',
      venue: 'A Links',
      startDate: new Date('2027-04-08T00:00:00.000Z'),
      endDate: new Date('2027-04-11T00:00:00.000Z'),
    }]);
  });

  it('asks the provider for the league\'s sport by the provider\'s own Season id, with no date range, naming its provider league so it reads only that league', async () => {
    const provider = syncedProvider();
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(provider));

    await service.listSeasonEvents('pga', '2027');

    expect(provider.getUpcomingEvents).toHaveBeenCalledWith('GOLF', undefined, { providerLeagueCode: 'pga', providerSeasonId: '2027' });
  });

  it('refuses with 422 PROVIDER_LEAGUE_REFUSED, naming the league, when the provider\'s plan refuses the tour\'s league', async () => {
    const provider = syncedProvider({ getUpcomingEvents: jest.fn().mockRejectedValue(new ProviderLeagueRefusedError('BALLDONTLIE', 'NFL', 401)) });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(provider));

    await expect(service.listSeasonEvents('pga', '2027')).rejects.toMatchObject({
      code: 'PROVIDER_LEAGUE_REFUSED',
      statusCode: 422,
      message: expect.stringContaining('BALLDONTLIE refused NFL') as unknown,
    });
  });

  it('passes on any other provider failure unchanged', async () => {
    const outage = new Error('BALLDONTLIE request /nfl/v1/games failed: 503');
    const provider = syncedProvider({ getUpcomingEvents: jest.fn().mockRejectedValue(outage) });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const service = new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(provider));

    await expect(service.listSeasonEvents('pga', '2027')).rejects.toBe(outage);
  });

  it('refuses a league with no selected mapping with 422 SPORT_LEAGUE_NOT_SYNCED, with no fallback to a provider of its sport', async () => {
    const provider = syncedProvider();
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(leagueRow(null)) } };

    await expect(new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(provider)).listSeasonEvents('pga', '2027'))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_SYNCED', statusCode: 422 });
    expect(provider.getUpcomingEvents).not.toHaveBeenCalled();
  });

  it('reads the provider the league\'s selected mapping names, never another running provider of its sport', async () => {
    const selected = syncedProvider();
    const other = buildProvider({ providerId: 'other-feed', providerCode: 'OTHER_FEED' as ProviderCode });
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };

    await new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(other, selected)).listSeasonEvents('pga', '2027');

    expect(selected.getUpcomingEvents).toHaveBeenCalled();
    expect(other.getUpcomingEvents).not.toHaveBeenCalled();
  });

  it('404s SPORT_LEAGUE_NOT_FOUND for an unknown league and PROVIDER_NOT_FOUND when the league\'s provider is not running here', async () => {
    const missing = { sportLeague: { findUnique: jest.fn().mockResolvedValue(null) } };
    const prisma = { sportLeague: { findUnique: jest.fn().mockResolvedValue(pgaLeague) } };
    const other = buildProvider({ providerId: 'other-feed', providerCode: 'OTHER_FEED' as ProviderCode });

    await expect(new ProviderSeasonScheduleReader(asPrismaClient(missing), registryWith(syncedProvider())).listSeasonEvents('nope', '2027'))
      .rejects.toMatchObject({ code: 'SPORT_LEAGUE_NOT_FOUND', statusCode: 404 });
    await expect(new ProviderSeasonScheduleReader(asPrismaClient(prisma), registryWith(other)).listSeasonEvents('pga', '2027'))
      .rejects.toMatchObject({ code: 'PROVIDER_NOT_FOUND', statusCode: 404 });
    expect(other.getUpcomingEvents).not.toHaveBeenCalled();
  });
});

describe('ProviderSeasonScheduleError', () => {
  it('pool-master-753 carries message/code/statusCode', () => {
    const error = new ProviderSeasonScheduleError('boom', 'PROVIDER_NOT_FOUND', 422);
    expect(error.message).toBe('boom');
    expect(error.code).toBe('PROVIDER_NOT_FOUND');
    expect(error.statusCode).toBe(422);
    expect(error.name).toBe('ProviderSeasonScheduleError');
  });
});

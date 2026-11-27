import { MatchStatus, ProviderCode, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { createScheduledEventReader, ROUND_WITHOUT_END_UNDERWAY_MS } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { fakeLogger } from '../../support/fake-logger';
import { sportEventSlots } from '../../support/sport-play';

// Which events a scheduled feed syncs: the events of leagues whose selected mapping names a running
// provider (#2004, #2073), each provider's next two to load a field, or every event in progress for scores. The
// query itself runs in integration.

const NOW = new Date('2026-11-09T12:00:00.000Z');

type LiveRelations = { roundSchedule?: unknown[]; matches?: unknown[]; gameNotifiedAt?: Date | null };

type MappingWhere = { some: { provider: { code: string | { in: string[] } } } };
type SportWhere = { sportLeagueSeason?: { sportLeague?: { sport?: { sport?: Sport } } } };

function reader(providerIds: string[], live: LiveRelations = {}) {
  // One event per provider row the query names, with that provider's id for it under the pga league.
  const findMany = jest.fn(({ where, select }: { where: { providerMappings: MappingWhere } & SportWhere; select: Record<string, unknown> }) => {
    const code = where.providerMappings.some.provider.code;
    // Each event covers the one slot its sport's play gives it (#2008): FIELD for golf, HEAD_TO_HEAD for football.
    const sport = where.sportLeagueSeason?.sportLeague?.sport?.sport ?? Sport.GOLF;
    return Promise.resolve((typeof code === 'string' ? [code] : code.in).map((each) => ({
      id: `event-${each}`,
      providerMappings: [{ externalId: `${each}-ext`, provider: { code: each }, sportLeagueProviderMapping: { providerLeague: { code: 'pga' } } }],
      ...('lastProviderNotificationAt' in select && { lastProviderNotificationAt: null }),
      ...('roundSchedule' in select && { roundSchedule: live.roundSchedule ?? [] }),
      ...('matches' in select && { matches: live.matches ?? [] }),
      ...('slots' in select && { slots: sportEventSlots(sport).map(({ matchFormat }) => ({ seasonSlot: { definition: { matchFormat } } })) }),
    })));
  });
  // The latest notification each event's Games heard, one row per event asked about.
  const groupBy = jest.fn(({ where }: { where: { sportEventId: { in: string[] } } }) => Promise.resolve(where.sportEventId.in
    .map((sportEventId) => ({ sportEventId, _max: { lastProviderNotificationAt: live.gameNotifiedAt ?? null } }))));
  const logger = fakeLogger();
  const registry = { all: () => providerIds.map((providerId) => ({ providerId })) };
  const read = createScheduledEventReader({ prisma: { sportEvent: { findMany }, sportEventRoundMatchGame: { groupBy } } as never, registry: registry as never, logger });
  return { read, findMany, groupBy, logger };
}

describe('createScheduledEventReader', () => {
  it('reads nothing and warns when no provider is running here, for fields and for scores', async () => {
    const { read, findMany, logger } = reader([]);

    await expect(read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([]);
    await expect(read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW })).resolves.toEqual([]);

    expect(findMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('asks each provider for its next two events to load a field, by its id for them, from now or the given start and up to the given end, earliest first', async () => {
    const { read, findMany } = reader(['balldontlie']);
    const from = new Date('2026-11-10T00:00:00.000Z');
    const to = new Date('2026-11-20T00:00:00.000Z');

    await expect(read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([
      { providerId: 'balldontlie', externalId: 'BALLDONTLIE-ext' },
    ]);
    findMany.mockClear();
    await read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', from, now: NOW, to });

    expect(findMany.mock.calls.map(([query]) => query.where)).toEqual([{
      providerMappings: { some: { provider: { code: 'BALLDONTLIE' } } },
      status: { in: [SportEventStatus.DRAFT, SportEventStatus.SCHEDULED] },
      startDate: { gte: from, lte: to },
      sportLeagueSeason: { sportLeague: { sport: { sport: Sport.GOLF }, isActive: true, selectedProviderMapping: { is: { providerLeague: { provider: { code: 'BALLDONTLIE' } } } } } },
    }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, orderBy: [{ startDate: 'asc' }, { id: 'asc' }] }));
  });

  it('narrows a provider\'s field query to active sport leagues whose selected mapping names that provider, and asks nothing of a provider with no Provider row', async () => {
    const { read, findMany } = reader(['mock', 'balldontlie']);

    await expect(read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW })).resolves.toEqual([
      { providerId: 'balldontlie', externalId: 'BALLDONTLIE-ext' },
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls.map(([query]) => (query.where as { sportLeagueSeason?: unknown }).sportLeagueSeason)).toEqual([
      { sportLeague: { sport: { sport: Sport.GOLF }, isActive: true, selectedProviderMapping: { is: { providerLeague: { provider: { code: 'BALLDONTLIE' } } } } } },
    ]);
  });

  it('issues one query per provider a league can sync from for the field feed and exactly one in all for the scores feed, however many events they hold', async () => {
    const { read, findMany } = reader(['mock', 'balldontlie']);

    await read.listEventsForFeed({ sport: Sport.GOLF, feed: 'EVENTPARTICIPANTS', now: NOW });
    expect(findMany).toHaveBeenCalledTimes(1);

    findMany.mockClear();
    await read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('reads no scores events, asking nothing, when no running provider has a row', async () => {
    const { read, findMany } = reader(['mock']);

    await expect(read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('asks once, across every provider, for every event in progress with a field for the scores feed, with its provider league, and once for when a provider last notified about any of their Games', async () => {
    const { read, findMany, groupBy } = reader(['balldontlie']);

    await expect(read.listLiveScoreEvents({ sport: Sport.FOOTBALL, now: NOW })).resolves.toEqual([
      { providerId: 'balldontlie', externalId: 'BALLDONTLIE-ext', providerLeagueCode: 'pga', lastProviderNotificationAt: null, playedInRounds: false, playUnderwaySince: null },
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        sportLeagueSeason: { sportLeague: { sport: { sport: Sport.FOOTBALL } } },
        providerMappings: { some: { provider: { code: { in: ['BALLDONTLIE'] } } } },
        status: SportEventStatus.IN_PROGRESS,
        sportEventParticipants: { some: {} },
      },
    }));
    expect(groupBy.mock.calls).toEqual([[{ by: ['sportEventId'], where: { sportEventId: { in: ['event-BALLDONTLIE'] } }, _max: { lastProviderNotificationAt: true } }]]);
  });

  it('reads an event played in matches as last notified when the latest of its Games was, and golf from the event itself, asking golf nothing of Games', async () => {
    const heard = new Date('2026-11-09T11:58:00.000Z');
    const football = reader(['balldontlie'], { gameNotifiedAt: heard });
    await expect(football.read.listLiveScoreEvents({ sport: Sport.FOOTBALL, now: NOW })).resolves.toEqual([expect.objectContaining({ lastProviderNotificationAt: heard })]);

    const golf = reader(['balldontlie'], { gameNotifiedAt: heard });
    await expect(golf.read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW })).resolves.toEqual([expect.objectContaining({ lastProviderNotificationAt: null })]);
    expect(golf.groupBy).not.toHaveBeenCalled();
  });

  it('reads each event in play by its own slots in one read, an event of FIELD slots by its rounds and one with a HEAD_TO_HEAD slot by its Games (#2008)', async () => {
    const row = (id: string, matchFormat: string) => ({
      id,
      providerMappings: [{ externalId: `${id}-ext`, provider: { code: ProviderCode.BALLDONTLIE }, sportLeagueProviderMapping: { providerLeague: { code: 'pga' } } }],
      slots: [{ seasonSlot: { definition: { matchFormat } } }],
      lastProviderNotificationAt: null,
      roundSchedule: [],
      matches: [],
    });
    const findMany = jest.fn().mockResolvedValue([row('field-event', 'FIELD'), row('match-event', 'HEAD_TO_HEAD')]);
    const groupBy = jest.fn().mockResolvedValue([]);
    const read = createScheduledEventReader({ prisma: { sportEvent: { findMany }, sportEventRoundMatchGame: { groupBy } } as never, registry: { all: () => [{ providerId: 'balldontlie' }] } as never });

    const events = await read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW });

    expect(events.map(({ externalId, playedInRounds }) => [externalId, playedInRounds])).toEqual([['field-event-ext', true], ['match-event-ext', false]]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { sportEventId: { in: ['match-event'] } } }));
  });

  describe('when play is under way in an event in progress (#1499)', () => {
    const since = (live: LiveRelations, sport: Sport = Sport.GOLF) =>
      reader(['balldontlie'], live).read.listLiveScoreEvents({ sport, now: NOW }).then((events) => events.at(0)?.playUnderwaySince);

    it('reads golf, played in rounds, from its latest started round, under way until the round\'s scheduled end', async () => {
      await expect(reader(['balldontlie']).read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW })).resolves.toEqual([expect.objectContaining({ playedInRounds: true })]);
      const start = new Date('2026-11-09T11:00:00.000Z');
      await expect(since({ roundSchedule: [{ scheduledDate: start, scheduledEndAt: new Date('2026-11-09T20:00:00.000Z') }] })).resolves.toEqual(start);
      await expect(since({ roundSchedule: [{ scheduledDate: start, scheduledEndAt: NOW }] })).resolves.toBeNull();
    });

    it('takes a golf round with no recorded end as under way for 14 hours from its start', async () => {
      const justInside = new Date(NOW.getTime() - ROUND_WITHOUT_END_UNDERWAY_MS + 1);
      const justOutside = new Date(NOW.getTime() - ROUND_WITHOUT_END_UNDERWAY_MS);
      await expect(since({ roundSchedule: [{ scheduledDate: justInside, scheduledEndAt: null }] })).resolves.toEqual(justInside);
      await expect(since({ roundSchedule: [{ scheduledDate: justOutside, scheduledEndAt: null }] })).resolves.toBeNull();
    });

    it('takes golf with no round started yet as not in play', async () => {
      await expect(since({ roundSchedule: [] })).resolves.toBeNull();
    });

    it('reads a sport played in matches from its match in progress longest, by its scheduled start, and takes one with no start as not in play', async () => {
      const kickoff = new Date('2026-11-09T11:30:00.000Z');
      await expect(since({ matches: [{ scheduledDate: kickoff }] }, Sport.FOOTBALL)).resolves.toEqual(kickoff);
      await expect(since({ matches: [{ scheduledDate: null }] }, Sport.FOOTBALL)).resolves.toBeNull();
      await expect(since({ matches: [] }, Sport.FOOTBALL)).resolves.toBeNull();
    });

    it('asks golf for its latest round started by now, and a sport played in matches for its earliest-scheduled match in progress', async () => {
      const golf = reader(['balldontlie']);
      await golf.read.listLiveScoreEvents({ sport: Sport.GOLF, now: NOW });
      expect(golf.findMany.mock.calls[0]?.[0].select).toEqual(expect.objectContaining({
        roundSchedule: { where: { scheduledDate: { lte: NOW } }, orderBy: { roundNumber: 'desc' }, take: 1, select: { scheduledDate: true, scheduledEndAt: true } },
      }));

      const football = reader(['balldontlie']);
      await football.read.listLiveScoreEvents({ sport: Sport.FOOTBALL, now: NOW });
      expect(football.findMany.mock.calls[0]?.[0].select).toEqual(expect.objectContaining({
        matches: { where: { status: MatchStatus.IN_PROGRESS }, orderBy: { scheduledDate: { sort: 'asc', nulls: 'last' } }, take: 1, select: { scheduledDate: true } },
      }));
    });
  });

  it('lists the sports with an active league whose selected mapping names a running provider, in sport display order, in one query', async () => {
    const sportFindMany = jest.fn().mockResolvedValue([{ sport: Sport.GOLF }, { sport: Sport.BASKETBALL }]);
    const read = createScheduledEventReader({ prisma: { sport: { findMany: sportFindMany } } as never, registry: { all: () => [] } });

    await expect(read.listSyncedSports({ providerCodes: [ProviderCode.BALLDONTLIE] })).resolves.toEqual([Sport.GOLF, Sport.BASKETBALL]);
    expect(sportFindMany).toHaveBeenCalledTimes(1);
    expect(sportFindMany).toHaveBeenCalledWith({
      where: { sportLeagues: { some: { isActive: true, selectedProviderMapping: { is: { providerLeague: { provider: { code: { in: [ProviderCode.BALLDONTLIE] } } } } } } } },
      select: { sport: true },
      orderBy: { displayOrder: 'asc' },
    });
  });
});

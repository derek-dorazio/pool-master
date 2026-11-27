import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { testDomainEvents } from '../../support/domain-events';
import {
  getAppPrisma,
  integrationBackgroundJobs,
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  withBackgroundJobsFailing,
} from '../helpers';
import { eventRebuildJob } from '../../support/recording-leaderboard-rebuilds';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type { SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { SportEventParticipantStatus, Sport } from '@poolmaster/shared/domain';
import { keyedSlotDefinitionId, linkedProviderEvent, providerEventWhere, putEventInSlot } from '../../support/event-edition';
import { recordStatements, statementsOn, StatementVerb } from '../statement-log';

const rankedEventIds = [
  'integration-ingestion-event',
  'integration-ranked-field',
  'integration-ranked-refresh',
  'integration-ranked-overwrite',
  'integration-linked-sync',
  'integration-unlinked-sync',
  'integration-odds-field',
  'integration-admin-header',
  'integration-batched-sync',
  'integration-rebuild-sync',
  'integration-rebuild-fail',
  'integration-linked-by-name',
  'integration-linked-by-league',
  'integration-play-in-place',
  'integration-follow-up-sync',
  'integration-follow-up-fail',
  'integration-follow-up-finished',
  'integration-window-placed-field',
];

/** The feed id a participant is mapped to, as the sync maps one participant to one feed id. */
function feedIdOf(participant: { providerMappings: Array<{ externalId: string }> }): string | undefined {
  return participant.providerMappings[0]?.externalId;
}

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipantGolfStanding.deleteMany({
    where: {
      standing: {
        sportEventParticipant: {
          sportEvent: providerEventWhere('balldontlie', 'integration-ingestion-event'),
        },
      },
    },
  });
  await prisma.sportEventParticipantStanding.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: providerEventWhere('balldontlie', 'integration-ingestion-event'),
      },
    },
  });
  await prisma.sportEventParticipant.deleteMany({
    where: {
      sportEvent: providerEventWhere('balldontlie', { in: rankedEventIds }),
    },
  });
  await prisma.sportEventRound.deleteMany({
    where: { sportEvent: providerEventWhere('balldontlie', { in: rankedEventIds }) },
  });
  await prisma.sportEvent.deleteMany({
    where: providerEventWhere('balldontlie', { in: rankedEventIds }),
  });
  // The suite's participants are the ones mapped to its feed ids (#2040: a feed id lives only on the mapping).
  const feedMapped = await prisma.participantProviderMapping.findMany({ where: { externalId: { startsWith: 'ingestion-' } }, select: { participantId: true } });
  await prisma.participantProviderMapping.deleteMany({
    where: { externalId: { startsWith: 'ingestion-' } },
  });
  await prisma.participant.deleteMany({ where: { name: { startsWith: 'Linkable ' } } });
  await prisma.sportLeague.deleteMany({ where: { name: { startsWith: 'Linkable ' } } });
  // One still on another suite's field stays: only the ones left on no field go.
  await prisma.participant.deleteMany({ where: { id: { in: feedMapped.map((row) => row.participantId) }, sportEventParticipants: { none: {} } } });
  await teardownIntegrationTests();
});

describe('IngestionPersistence', () => {
  /** A one-golfer field for a linked event, as a provider's sync sends it. */
  async function linkedField(externalId: string, golferId: string): Promise<SportEventDetail> {
    const detail: SportEventDetail = {
      externalId,
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: `Rebuild ${externalId}`,
      startDate: new Date('2026-04-15T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      providerSlots: [],
      participants: [{ externalId: golferId, providerId: 'balldontlie', sport: Sport.GOLF, name: `Golfer ${golferId}`, status: SportEventParticipantStatus.ACTIVE, ranking: 3, metadata: {} }],
    };
    await linkedProviderEvent(getPrisma(), { providerId: detail.providerId, externalId, name: detail.name, startDate: detail.startDate });
    return detail;
  }
  const withRebuilds = () => new IngestionPersistence(getAppPrisma(), testDomainEvents({ queue: integrationBackgroundJobs().queue }));
  const eventIdOf = async (externalId: string) => (await getPrisma().sportEvent.findFirstOrThrow({ where: providerEventWhere('balldontlie', externalId) })).id;

  it('writes the event\'s leaderboard rebuild job with the field a sync changes, and none for a sync that changes nothing (#1466)', async () => {
    const detail = await linkedField('integration-rebuild-sync', 'ingestion-rebuild-1');
    const persistence = withRebuilds();

    await persistence.persistEventDetailWithDiagnostics(detail);
    const sportEventId = await eventIdOf(detail.externalId);
    const rebuildJobs = () => getPrisma().backgroundJob.count({ where: { dedupeKey: eventRebuildJob(sportEventId).dedupeKey } });
    await expect(rebuildJobs()).resolves.toBe(1);

    await getPrisma().backgroundJob.deleteMany({ where: { dedupeKey: eventRebuildJob(sportEventId).dedupeKey } });
    await persistence.persistEventDetailWithDiagnostics(detail);
    await expect(rebuildJobs()).resolves.toBe(0);
  });

  it('writes none of the field when its rebuild job cannot be written, so the next sync writes it again (#1466)', async () => {
    const detail = await linkedField('integration-rebuild-fail', 'ingestion-rebuild-2');

    await expect(withBackgroundJobsFailing('REBUILD_LEADERBOARDS', () => withRebuilds().persistEventDetailWithDiagnostics(detail))).rejects.toThrow();

    const sportEventId = await eventIdOf(detail.externalId);
    await expect(getPrisma().sportEventParticipant.count({ where: { sportEventId } })).resolves.toBe(0);
  });

  describe('a field sync\'s follow-ups, the provider\'s games then the tiers and prices (#1952)', () => {
    const withFollowUps = () => new IngestionPersistence(getAppPrisma(), testDomainEvents({ queue: integrationBackgroundJobs().queue }));
    const followUpJobs = (sportEventId: string) => getPrisma().backgroundJob.findMany({ where: { type: 'SYNC_EVENT_GAMES_AND_TIERS', sportEventId } });
    const KICKOFF = new Date('2026-04-15T17:00:00.000Z');
    const games = [{ games: [{ providerGameId: 'g1', gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: 'home', awayTeamExternalId: 'away', scheduledAt: KICKOFF, isNeutralSite: false }];

    it('writes one job with the field a sync writes, carrying the provider\'s games, and one on its own when the field is unchanged', async () => {
      const detail = { ...await linkedField('integration-follow-up-sync', 'ingestion-follow-up-1'), games };
      const persistence = withFollowUps();

      await persistence.persistEventDetailWithDiagnostics(detail);
      const sportEventId = await eventIdOf(detail.externalId);
      const [job, ...more] = await followUpJobs(sportEventId);
      expect(more).toEqual([]);
      expect(job).toMatchObject({
        status: 'QUEUED',
        dedupeKey: `SYNC_EVENT_GAMES_AND_TIERS:${sportEventId}`,
        payload: { sportEventId, providerId: 'balldontlie', externalId: detail.externalId, games: [{ ...games[0], scheduledAt: KICKOFF.toISOString() }] },
      });

      // The same field again writes no field row, but the games may have moved, so its job is written on its own.
      await getPrisma().backgroundJob.deleteMany({ where: { sportEventId } });
      await persistence.persistEventDetailWithDiagnostics(detail);
      await expect(followUpJobs(sportEventId)).resolves.toHaveLength(1);
      await getPrisma().backgroundJob.deleteMany({ where: { sportEventId } });
    });

    it('writes none of the field when its follow-up job cannot be written, so the next sync writes both', async () => {
      const detail = await linkedField('integration-follow-up-fail', 'ingestion-follow-up-2');

      await expect(withBackgroundJobsFailing('SYNC_EVENT_GAMES_AND_TIERS', () => withFollowUps().persistEventDetailWithDiagnostics(detail))).rejects.toThrow();

      const sportEventId = await eventIdOf(detail.externalId);
      await expect(getPrisma().sportEventParticipant.count({ where: { sportEventId } })).resolves.toBe(0);
    });

    it('queues nothing for a finished event, whose games are played and whose tiers and prices are locked', async () => {
      const detail = await linkedField('integration-follow-up-finished', 'ingestion-follow-up-3');
      const sportEventId = await eventIdOf(detail.externalId);
      await getPrisma().sportEvent.update({ where: { id: sportEventId }, data: { status: 'COMPLETED' } });

      await withFollowUps().persistEventDetailWithDiagnostics(detail);

      await expect(followUpJobs(sportEventId)).resolves.toEqual([]);
      await expect(getPrisma().sportEventParticipant.count({ where: { sportEventId } })).resolves.toBe(1);
    });
  });

  it('persists event detail into events, participants, event participants, and source data', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());

    const detail: SportEventDetail = {
      externalId: 'integration-ingestion-event',
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: 'Integration Ingestion Event',
      startDate: new Date('2026-04-15T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      providerSlots: [],
      participants: [
        {
          externalId: 'ingestion-player-1',
          providerId: 'balldontlie',
          sport: Sport.GOLF,
          name: 'Ingestion Player One',
          firstName: 'Ingestion',
          lastName: 'One',
          status: SportEventParticipantStatus.ACTIVE,
          metadata: { scoreToPar: -4, madeCut: true },
        },
      ],
    };

    // plans/147 — sync updates a linked event; it does not create one.
    await linkedProviderEvent(prisma, {
      providerId: detail.providerId,
      externalId: detail.externalId,
      name: detail.name,
      startDate: detail.startDate,
    });

    const result = (await persistence.persistEventDetailWithDiagnostics(detail)).value;

    expect(result).toMatchObject({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    const event = await prisma.sportEvent.findFirstOrThrow({
      where: providerEventWhere('balldontlie', 'integration-ingestion-event'),
    });
    const participant = await prisma.participant.findFirstOrThrow({
      where: { providerMappings: { some: { externalId: 'ingestion-player-1' } } },
    });
    const sportEventParticipant =
      await prisma.sportEventParticipant.findUniqueOrThrow({
        where: {
          sportEventId_participantId: {
            sportEventId: event.id,
            participantId: participant.id,
          },
        },
      });

    expect(sportEventParticipant.status).toBe(SportEventParticipantStatus.ACTIVE);

    // Per-participant source data (sportEventParticipantSourceData) was dropped
    // per plans/117 §13.2. rop.78.7 will rebuild the live-scoring path on
    // SportEventParticipantGolfRound and the per-(category × contestFormat)
    // contribution table.
  });

  it('writes each golfer\'s ranking from the provider\'s field onto the event participant, and leaves it empty when the field gives none', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const golfer = (externalId: string, name: string, ranking?: number) => ({
      externalId,
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name,
      status: SportEventParticipantStatus.ACTIVE,
      ...(ranking === undefined ? {} : { ranking }),
      metadata: {},
    });
    const detail: SportEventDetail = {
      externalId: 'integration-ranked-field',
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: 'Integration Ranked Field',
      startDate: new Date('2026-04-22T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      providerSlots: [],
      participants: [golfer('ingestion-ranked-1', 'Ranked Golfer', 7), golfer('ingestion-ranked-2', 'Unranked Golfer')],
    };
    const event = await linkedProviderEvent(prisma, {
      providerId: detail.providerId,
      externalId: detail.externalId,
      name: detail.name,
      startDate: detail.startDate,
    });

    await persistence.persistEventDetailWithDiagnostics(detail);

    const rows = await prisma.sportEventParticipant.findMany({
      where: { sportEventId: event.id },
      include: { participant: { include: { providerMappings: true } } },
    });
    expect(Object.fromEntries(rows.map((row) => [feedIdOf(row.participant), row.ranking]))).toEqual({
      'ingestion-ranked-1': 7,
      'ingestion-ranked-2': null,
    });
  });

  function rankedGolfer(externalId: string, ranking?: number): SportEventDetail['participants'][number] {
    return {
      externalId,
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: `Golfer ${externalId}`,
      status: SportEventParticipantStatus.ACTIVE,
      ...(ranking === undefined ? {} : { ranking }),
      metadata: {},
    };
  }

  function rankedFieldDetail(externalId: string, participants: SportEventDetail['participants']): SportEventDetail {
    return {
      externalId,
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: `Integration ${externalId}`,
      startDate: new Date('2026-04-29T12:00:00.000Z'),
      status: 'SCHEDULED',
      fieldLocked: false,
      providerSlots: [],
      participants,
    };
  }

  // #1715: a slot placed by date window holds every game in its dates, the bowls between other
  // schools too, so the feed's teams are not the event's field: the seeds placed on it are.
  it('adds no team from the feed to the field of an event playing a date-window slot, and still refreshes the teams already on it', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const externalId = 'integration-window-placed-field';
    const event = await linkedProviderEvent(prisma, { providerId: 'balldontlie', externalId, name: 'Windowed playoff', startDate: new Date('2026-12-30T12:00:00.000Z') });
    await persistence.persistEventDetailWithDiagnostics(rankedFieldDetail(externalId, [rankedGolfer('ingestion-window-seed', 4)]));
    const { sportLeagueProviderMappingId } = await prisma.sportEventProviderMapping.findFirstOrThrow({ where: { sportEventId: event.id }, select: { sportLeagueProviderMappingId: true } });
    const definitionId = await keyedSlotDefinitionId(prisma, event.sportLeagueId, 'WINDOWED_ROUND', { phase: 'POSTSEASON', slotKind: 'SEMIFINAL' });
    await prisma.sportLeagueCompetitionSlotProviderMapping.createMany({
      data: [{ sportLeagueId: event.sportLeagueId, sportLeagueCompetitionSlotId: definitionId, sportLeagueProviderMappingId, matchType: 'DATE_WINDOW', providerValue: null }],
      skipDuplicates: true,
    });
    await putEventInSlot(prisma, event.id, definitionId);

    await persistence.persistEventDetailWithDiagnostics(rankedFieldDetail(externalId, [
      rankedGolfer('ingestion-window-seed', 2),
      rankedGolfer('ingestion-window-bowl-team', 9),
    ]));

    const rows = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { participant: { include: { providerMappings: true } } } });
    expect(rows.map((row) => [feedIdOf(row.participant), row.ranking])).toEqual([['ingestion-window-seed', 2]]);
  });

  // #2154: a rest-of-phase slot (a season's bowls) takes the games no other slot places, which the
  // events sync records on it; its event's field is those games' teams, and its Matches those games.
  it('writes the field of an event playing a rest-of-phase slot from the teams of the games placed in it, and hands its follow-up those games alone', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents({ queue: integrationBackgroundJobs().queue }));
    const externalId = 'integration-rest-of-phase-field';
    const event = await linkedProviderEvent(prisma, { providerId: 'balldontlie', externalId, name: 'Bowl Games', startDate: new Date('2026-12-20T12:00:00.000Z') });
    const { sportLeagueProviderMappingId } = await prisma.sportEventProviderMapping.findFirstOrThrow({ where: { sportEventId: event.id }, select: { sportLeagueProviderMappingId: true } });
    const definitionId = await keyedSlotDefinitionId(prisma, event.sportLeagueId, 'REST_OF_POSTSEASON', { phase: 'POSTSEASON', slotKind: 'TOURNAMENT' });
    await prisma.sportLeagueCompetitionSlotProviderMapping.createMany({
      data: [{ sportLeagueId: event.sportLeagueId, sportLeagueCompetitionSlotId: definitionId, sportLeagueProviderMappingId, matchType: 'REST_OF_PHASE', providerValue: null }],
      skipDuplicates: true,
    });
    const seasonSlotId = await putEventInSlot(prisma, event.id, definitionId);
    await prisma.sportLeagueSeasonCompetitionSlotGameProviderMapping.create({
      data: { sportLeagueId: event.sportLeagueId, sportLeagueSeasonCompetitionSlotId: seasonSlotId, sportLeagueProviderMappingId, externalId: 'bowl-game' },
    });
    const game = (id: string, home: string, away: string) => ({ games: [{ providerGameId: id, gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: home, awayTeamExternalId: away, scheduledAt: new Date('2026-12-20T17:00:00.000Z'), isNeutralSite: false });

    await persistence.persistEventDetailWithDiagnostics({
      ...rankedFieldDetail(externalId, ['ingestion-bowl-home', 'ingestion-bowl-away', 'ingestion-cfp-seed-1', 'ingestion-cfp-seed-4'].map((team) => rankedGolfer(team))),
      games: [game('bowl-game', 'ingestion-bowl-home', 'ingestion-bowl-away'), game('cfp-game', 'ingestion-cfp-seed-1', 'ingestion-cfp-seed-4')],
    });

    const rows = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { participant: { include: { providerMappings: true } } } });
    expect(rows.map((row) => feedIdOf(row.participant) ?? '').sort((a, b) => a.localeCompare(b))).toEqual(['ingestion-bowl-away', 'ingestion-bowl-home']);
    const [job] = await prisma.backgroundJob.findMany({ where: { type: 'SYNC_EVENT_GAMES_AND_TIERS', sportEventId: event.id } });
    expect((job.payload as { games: Array<{ games: Array<{ providerGameId: string }> }> }).games.map((each) => each.games[0].providerGameId)).toEqual(['bowl-game']);
    await prisma.backgroundJob.deleteMany({ where: { sportEventId: event.id } });
  });

  it('hands no provider game to the follow-up of an event playing only a date-window slot, whose Matches are its seeds\' bracket', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents({ queue: integrationBackgroundJobs().queue }));
    const externalId = 'integration-window-no-games';
    const event = await linkedProviderEvent(prisma, { providerId: 'balldontlie', externalId, name: 'Windowed playoff', startDate: new Date('2026-12-30T12:00:00.000Z') });
    const { sportLeagueProviderMappingId } = await prisma.sportEventProviderMapping.findFirstOrThrow({ where: { sportEventId: event.id }, select: { sportLeagueProviderMappingId: true } });
    const definitionId = await keyedSlotDefinitionId(prisma, event.sportLeagueId, 'WINDOWED_ROUND', { phase: 'POSTSEASON', slotKind: 'SEMIFINAL' });
    await prisma.sportLeagueCompetitionSlotProviderMapping.createMany({
      data: [{ sportLeagueId: event.sportLeagueId, sportLeagueCompetitionSlotId: definitionId, sportLeagueProviderMappingId, matchType: 'DATE_WINDOW', providerValue: null }],
      skipDuplicates: true,
    });
    await putEventInSlot(prisma, event.id, definitionId);

    await persistence.persistEventDetailWithDiagnostics({
      ...rankedFieldDetail(externalId, [rankedGolfer('ingestion-window-only-team')]),
      games: [{ games: [{ providerGameId: 'some-game', gameNumber: 1 }], roundNumber: 1, homeTeamExternalId: 'a', awayTeamExternalId: 'b', scheduledAt: new Date('2026-12-30T17:00:00.000Z'), isNeutralSite: false }],
    });

    const [job] = await prisma.backgroundJob.findMany({ where: { type: 'SYNC_EVENT_GAMES_AND_TIERS', sportEventId: event.id } });
    expect(job.payload).not.toHaveProperty('games');
    await prisma.backgroundJob.deleteMany({ where: { sportEventId: event.id } });
  });

  it('keeps a golfer\'s existing ranking when a later field refresh gives no ranking', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const first = rankedFieldDetail('integration-ranked-refresh', [rankedGolfer('ingestion-ranked-3', 12)]);
    const event = await linkedProviderEvent(prisma, {
      providerId: first.providerId,
      externalId: first.externalId,
      name: first.name,
      startDate: first.startDate,
    });
    await persistence.persistEventDetailWithDiagnostics(first);

    await persistence.persistEventDetailWithDiagnostics(
      rankedFieldDetail('integration-ranked-refresh', [rankedGolfer('ingestion-ranked-3')]),
    );

    const row = await prisma.sportEventParticipant.findFirstOrThrow({
      where: { sportEventId: event.id, participant: { providerMappings: { some: { externalId: 'ingestion-ranked-3' } } } },
    });
    expect(row.ranking).toBe(12);
  });

  it('writes the field\'s ranking over the ranking a golfer already has on the event when a refresh carries a new one', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const first = rankedFieldDetail('integration-ranked-overwrite', [rankedGolfer('ingestion-ranked-4', 40)]);
    const event = await linkedProviderEvent(prisma, {
      providerId: first.providerId,
      externalId: first.externalId,
      name: first.name,
      startDate: first.startDate,
    });
    await persistence.persistEventDetailWithDiagnostics(first);

    await persistence.persistEventDetailWithDiagnostics(
      rankedFieldDetail('integration-ranked-overwrite', [rankedGolfer('ingestion-ranked-4', 5)]),
    );

    const row = await prisma.sportEventParticipant.findFirstOrThrow({
      where: { sportEventId: event.id, participant: { providerMappings: { some: { externalId: 'ingestion-ranked-4' } } } },
    });
    expect(row.ranking).toBe(5);
  });

  // plans/147 — sync never creates a SportEvent: a provider event names no series or sport
  // league, so a created row would have to guess its tour.
  // #1247, #2047 — one read for every linked event. The provider's word changes no event row:
  // its field size is counted over its field rows, so each linked event is recorded unchanged.
  it('records each linked event of a feed unchanged and leaves its row as it was, creating none for an unlinked one', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const startDate = new Date('2026-06-18T12:00:00.000Z');
    const link = (externalId: string) => linkedProviderEvent(prisma, { providerId: 'balldontlie', externalId, name: `Batch ${externalId}`, startDate });
    const first = await link('integration-batch-first');
    const second = await link('integration-batch-second');
    const providerEvent = (externalId: string) => ({
      externalId,
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: `Provider ${externalId}`,
      startDate,
      status: 'SCHEDULED' as const,
      fieldLocked: false,
      providerSlots: [],
    });

    const result = await persistence.persistEventsWithDiagnostics([
      providerEvent('integration-batch-first'),
      providerEvent('integration-batch-unlinked'),
      providerEvent('integration-batch-second'),
    ]);

    expect(result.count).toBe(2);
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 2, updated: 0, unchanged: 2, created: 0 });
    expect(result.writeDiagnostics.rows.map((row) => [row.externalId, row.disposition, row.internalId])).toEqual([
      ['integration-batch-first', 'UNCHANGED', first.id],
      ['integration-batch-second', 'UNCHANGED', second.id],
    ]);
    const stored = await prisma.sportEvent.findMany({ where: { id: { in: [first.id, second.id] } }, orderBy: { name: 'asc' } });
    expect(stored).toEqual([first, second]);
    await expect(prisma.sportEvent.count({
      where: providerEventWhere('balldontlie', 'integration-batch-unlinked'),
    })).resolves.toBe(0);
  });

  it('writes each golfer\'s seed, and the odds only when they were quoted for this event, onto the event participant', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    const golfer = (externalId: string, oddsSourceEventId: string) => ({
      externalId,
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      name: `Golfer ${externalId}`,
      status: SportEventParticipantStatus.ACTIVE,
      seed: 3,
      odds: { toWin: 8.5, eventExternalId: oddsSourceEventId },
      metadata: {},
    });
    const detail = rankedFieldDetail('integration-odds-field', [
      golfer('ingestion-odds-1', 'integration-odds-field'),
      golfer('ingestion-odds-2', 'some-other-event'),
    ]);
    const event = await linkedProviderEvent(prisma, {
      providerId: detail.providerId,
      externalId: detail.externalId,
      name: detail.name,
      startDate: detail.startDate,
    });

    await persistence.persistEventDetailWithDiagnostics(detail);

    const rows = await prisma.sportEventParticipant.findMany({
      where: { sportEventId: event.id },
      include: { participant: { include: { providerMappings: true } } },
    });
    const byGolfer: Record<string, { seedNumber: number | null; oddsToWin: number | null }> = {};
    for (const row of rows) {
      byGolfer[feedIdOf(row.participant) ?? row.participantId] = {
        seedNumber: row.seedNumber,
        oddsToWin: row.oddsToWin === null ? null : Number(row.oddsToWin),
      };
    }
    // Odds quoted for a different event must not bleed onto this one.
    expect(byGolfer).toEqual({
      'ingestion-odds-1': { seedNumber: 3, oddsToWin: 8.5 },
      'ingestion-odds-2': { seedNumber: 3, oddsToWin: null },
    });
  });

  // #118, #435 — the field sync never writes a linked event's header, rounds or status (the
  // events sync keeps those, #1727).
  it('leaves a linked event\'s stored name, start, rounds and status as they were',
    async () => {
      const prisma = getPrisma();
      const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
      const externalId = 'integration-admin-header';
      const startDate = new Date('2026-06-11T12:00:00.000Z');
      const created = await linkedProviderEvent(prisma, {
        providerId: 'balldontlie',
        externalId,
        name: 'Admin Open',
        startDate,
      });
      await persistence.persistEventsWithDiagnostics([{
        externalId,
        providerId: 'balldontlie',
        sport: Sport.GOLF,
        name: 'Provider Open',
        startDate: new Date('2026-07-01T12:00:00.000Z'),
        status: 'IN_PROGRESS',
        rounds: 5,
        fieldLocked: true,
        providerSlots: [],
      }]);

      const row = await prisma.sportEvent.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        name: 'Admin Open',
        startDate,
        rounds: created.rounds,
        status: created.status,
      });
    },
  );

  it('#125: the participant_ranking_snapshots table no longer exists — the global ranking snapshot is retired, not demoted', async () => {
    const prisma = getPrisma();

    const [{ table }] = await prisma.$queryRaw<Array<{ table: string | null }>>`
      SELECT to_regclass('public.participant_ranking_snapshots')::text AS "table"
    `;

    expect(table).toBeNull();
    // The model is gone, so the client type has no such key; ask the object itself.
    expect(Reflect.get(prisma, 'participantRankingSnapshot')).toBeUndefined();
  });

  // #1183 — a field sync reads its mappings and field rows at once and writes only what moved.
  it('creates a new field with its participants and mappings, then on a repeat sync writes nothing, and on a change writes only the changed golfer', async () => {
    const prisma = getPrisma();
    const persistence = new IngestionPersistence(getAppPrisma(), testDomainEvents());
    type Golfer = ReturnType<typeof rankedGolfer> & Partial<SportEventDetail['participants'][number]>;
    const field = (secondRanking: number, changes: Record<string, Partial<Golfer>> = {}) => rankedFieldDetail('integration-batched-sync', [
      { ...rankedGolfer('ingestion-batch-1', 1), ...changes['ingestion-batch-1'] },
      { ...rankedGolfer('ingestion-batch-2', secondRanking), ...changes['ingestion-batch-2'] },
      { ...rankedGolfer('ingestion-batch-3', 3), ...changes['ingestion-batch-3'] },
    ]);
    const event = await linkedProviderEvent(prisma, {
      providerId: 'balldontlie',
      externalId: 'integration-batched-sync',
      name: field(2).name,
      startDate: field(2).startDate,
    });
    const stamps = async () => {
      const rows = await prisma.sportEventParticipant.findMany({ where: { sportEventId: event.id }, include: { participant: { include: { providerMappings: true } } } });
      return new Map(rows.map((row) => [feedIdOf(row.participant), [row.updatedAt.toISOString(), row.participant.updatedAt.toISOString()]]));
    };

    const created = await persistence.persistEventDetailWithDiagnostics(field(2));

    expect(created.value).toEqual({ eventsPersisted: 1, participantsPersisted: 3, sportEventParticipantsPersisted: 3 });
    expect(created.writeDiagnostics.rows.filter((row) => row.entityType === 'SportEventParticipant').map((row) => [row.disposition, Boolean(row.internalId)]))
      .toEqual([['CREATED', true], ['CREATED', true], ['CREATED', true]]);
    await expect(prisma.participantProviderMapping.count({ where: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: { startsWith: 'ingestion-batch-' } } })).resolves.toBe(3);
    const afterCreate = await stamps();

    const repeated = await persistence.persistEventDetailWithDiagnostics(field(2));

    expect(repeated.writeDiagnostics.summary).toMatchObject({ unchanged: 3, created: 0, updated: 0 });
    expect(await stamps()).toEqual(afterCreate);

    const changed = await persistence.persistEventDetailWithDiagnostics(field(9));

    expect(changed.writeDiagnostics.rows.filter((row) => row.disposition === 'UPDATED').map((row) => row.participantExternalId)).toEqual(['ingestion-batch-2']);
    const afterChange = await stamps();
    expect(afterChange.get('ingestion-batch-1')).toEqual(afterCreate.get('ingestion-batch-1'));
    expect(afterChange.get('ingestion-batch-3')).toEqual(afterCreate.get('ingestion-batch-3'));
    expect(afterChange.get('ingestion-batch-2')?.[0]).not.toBe(afterCreate.get('ingestion-batch-2')?.[0]);
    const row = await prisma.sportEventParticipant.findFirstOrThrow({ where: { sportEventId: event.id, participant: { providerMappings: { some: { externalId: 'ingestion-batch-2' } } } } });
    expect(row.ranking).toBe(9);

    // A withdrawal: the field row records it, and the rest of the field is not touched.
    const withdrawn = await persistence.persistEventDetailWithDiagnostics(field(9, {
      'ingestion-batch-3': { status: SportEventParticipantStatus.WITHDRAWN },
    }));

    expect(withdrawn.writeDiagnostics.rows.filter((diagnostic) => diagnostic.disposition === 'UPDATED').map((diagnostic) => diagnostic.participantExternalId)).toEqual(['ingestion-batch-3']);
    const afterWithdrawal = await stamps();
    expect(afterWithdrawal.get('ingestion-batch-1')).toEqual(afterChange.get('ingestion-batch-1'));
    expect(afterWithdrawal.get('ingestion-batch-2')).toEqual(afterChange.get('ingestion-batch-2'));
    await expect(prisma.sportEventParticipant.findFirstOrThrow({ where: { sportEventId: event.id, participant: { providerMappings: { some: { externalId: 'ingestion-batch-3' } } } } }))
      .resolves.toMatchObject({ status: SportEventParticipantStatus.WITHDRAWN });

    // A participant-only change: the participant row is rewritten, the field row is not.
    const reaffiliated = await persistence.persistEventDetailWithDiagnostics(field(9, {
      'ingestion-batch-1': { teamAffiliation: 'Team Europe' },
      'ingestion-batch-3': { status: SportEventParticipantStatus.WITHDRAWN },
    }));

    expect(reaffiliated.writeDiagnostics.summary).toMatchObject({ unchanged: 3, updated: 0, created: 0 });
    const afterReaffiliation = await stamps();
    const [fieldRowAt, participantAt] = afterReaffiliation.get('ingestion-batch-1') ?? [];
    expect(fieldRowAt).toBe(afterWithdrawal.get('ingestion-batch-1')?.[0]);
    expect(participantAt).not.toBe(afterWithdrawal.get('ingestion-batch-1')?.[1]);
    expect(afterReaffiliation.get('ingestion-batch-2')).toEqual(afterWithdrawal.get('ingestion-batch-2'));
    await expect(prisma.participant.findFirstOrThrow({ where: { providerMappings: { some: { externalId: 'ingestion-batch-1' } } } })).resolves.toMatchObject({ teamAffiliation: 'Team Europe' });
  });

  // #1853 — a participant belongs to one sport league: the one of the event the sync fields them
  // in, whatever tour the feed names, so the league's roster holds every player its events field.
  it('creates every participant the feed brings in the synced event\'s sport league, in one insert, whatever tour the feed names', async () => {
    const prisma = getPrisma();
    const golfer = (externalId: string, tour: string) => ({ ...rankedGolfer(externalId), name: `League ${externalId}`, metadata: { tour } });
    const detail = rankedFieldDetail('integration-event-league', [golfer('ingestion-league-a', 'pga'), golfer('ingestion-league-b', 'NO-SUCH-LEAGUE')]);
    const event = await linkedProviderEvent(prisma, { providerId: 'balldontlie', externalId: detail.externalId, name: detail.name, startDate: detail.startDate });
    const { sportLeagueId } = event;

    const { statements } = await recordStatements(() => new IngestionPersistence(getAppPrisma(), testDomainEvents()).persistEventDetailWithDiagnostics(detail));

    const created = await prisma.participant.findMany({ where: { providerMappings: { some: { externalId: { in: ['ingestion-league-a', 'ingestion-league-b'] } } } }, select: { sportLeagueId: true } });
    expect(created).toEqual([{ sportLeagueId }, { sportLeagueId }]);
    await expect(prisma.participantProviderMapping.count({ where: { externalId: { in: ['ingestion-league-a', 'ingestion-league-b'] }, sportLeagueId } })).resolves.toBe(2);
    expect(statementsOn(statements, StatementVerb.INSERT, 'participants')).toHaveLength(1);
  });

  // #205 — the `pool-master-8yh` job-completion case went with `persistIngestionJob` and the
  // `ingestion_jobs` table: the sync-run ledger records the same job on the run (`jobPayload`).
});

import { expect } from '@jest/globals';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { Sport } from '@poolmaster/shared/domain';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';
import { freshEventEdition } from '../../support/event-edition';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('pool-master-eux.2: Golf participant standing persistence', () => {
  it('persists round thru and one standing row per event participant', async () => {
    const prisma = getPrisma();

    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: {
        name: Sport.GOLF,
        participantType: 'INDIVIDUAL',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });
    const participant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        externalId: 'golf-standing-player-1',
        name: 'Golf Standing Player',
        participantType: 'INDIVIDUAL',
        status: 'ACTIVE',
      },
    });
    await prisma.participantProviderMapping.create({
      data: {
        participantId: participant.id,
        providerId: 'integration-test',
        externalId: 'golf-standing-player-1',
      },
    });
    const event = await prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: 'golf-standing-event-1',
        providerId: 'integration-test',
        sport: 'GOLF',
        name: 'Golf Standing Invitational',
        startDate: new Date('2026-05-07T12:00:00.000Z'),
        endDate: new Date('2026-05-10T22:00:00.000Z'),
        status: 'IN_PROGRESS',
        fieldLocked: true,
        releaseAt: new Date('2026-05-01T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-05-06T16:00:00.000Z'),
      },
    });
    const sportEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId: event.id,
        participantId: participant.id,
        isActive: true,
      },
    });

    const persisted = await publishLiveScoreUpdate(
      {
        category: 'GOLF',
        externalEventId: 'golf-standing-event-1',
        rounds: [
          {
            participantExternalId: 'golf-standing-player-1',
            round: 1,
            strokes: 68,
            scoreToPar: -4,
            status: 'COMPLETED',
          },
          {
            participantExternalId: 'golf-standing-player-1',
            round: 2,
            strokes: 33,
            scoreToPar: -3,
            thru: 9,
            status: 'IN_PROGRESS',
          },
        ],
      },
      {
        prisma,
        providerId: 'integration-test',
      },
    );

    expect(persisted).toMatchObject({
      updatesReturned: 2,
      updatesPersisted: 2,
      updatesSkipped: 0,
      writeDiagnostics: {
        summary: {
          total: 3,
          unchanged: 0,
          created: 3,
          updated: 0,
          deleted: 0,
        },
      },
    });

    const row = await prisma.sportEventParticipant.findUniqueOrThrow({
      where: { id: sportEventParticipant.id },
      include: {
        rounds: { include: { sportEventRound: true, golf: true } },
        standing: { include: { golf: true } },
      },
    });

    expect(row.rounds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sportEventRound: expect.objectContaining({ roundNumber: 1 }),
        golf: expect.objectContaining({ strokes: 68, scoreToPar: -4, thru: null }),
      }),
      expect.objectContaining({
        sportEventRound: expect.objectContaining({ roundNumber: 2 }),
        golf: expect.objectContaining({ strokes: 33, scoreToPar: -3, thru: 9 }),
      }),
    ]));
    expect(row.standing).toEqual(
      expect.objectContaining({
        currentRound: 2,
        status: 'IN_PROGRESS',
        golf: expect.objectContaining({ eventScoreToPar: -7, eventStrokes: 101, currentRoundThru: 9 }),
      }),
    );
    // One standing per event participant, enforced by the core table.
    await expect(
      prisma.sportEventParticipantStanding.create({
        data: {
          sportEventParticipantId: sportEventParticipant.id,
          status: 'IN_PROGRESS',
        },
      }),
    ).rejects.toThrow();
  });
});

// Live-score persistence through `publishLiveScoreUpdate`, against real rows. Each golfer's round
// lands as a core SportEventParticipantRound plus its golf extension; their standing is
// recomputed as a core SportEventParticipantStanding plus its golf extension.
describe('Golf live-score persistence', () => {
  const PROVIDER = 'integration-test';

  async function createLiveField(suffix: string, golferKeys: string[]) {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { name: Sport.GOLF },
      create: { name: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const createEvent = async (tag: string) => prisma.sportEvent.create({
      data: {
        ...(await freshEventEdition(prisma)),
        externalId: `golf-live-${suffix}-${tag}`,
        providerId: PROVIDER,
        sport: 'GOLF',
        name: `Live ${suffix} ${tag}`,
        startDate: new Date('2026-05-07T12:00:00.000Z'),
        status: 'IN_PROGRESS',
        releaseAt: new Date('2026-05-01T12:00:00.000Z'),
        fieldLocksAt: new Date('2026-05-06T16:00:00.000Z'),
      },
    });
    const [event, otherEvent] = [await createEvent('a'), await createEvent('b')];
    const sepByKey = new Map<string, string>();
    const otherSepByKey = new Map<string, string>();
    for (const key of golferKeys) {
      const externalId = `${suffix}-${key}`;
      const participant = await prisma.participant.create({
        data: { sportId: sport.id, name: `Golfer ${externalId}`, participantType: 'INDIVIDUAL' },
      });
      await prisma.participantProviderMapping.create({
        data: { participantId: participant.id, providerId: PROVIDER, externalId },
      });
      // The same golfer is also in a second event, so scoping to the named event is observable.
      sepByKey.set(key, (await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } })).id);
      otherSepByKey.set(key, (await prisma.sportEventParticipant.create({ data: { sportEventId: otherEvent.id, participantId: participant.id } })).id);
    }
    return { event, sepByKey, otherSepByKey };
  }

  async function standingOf(sportEventParticipantId: string) {
    return getPrisma().sportEventParticipantStanding.findUnique({
      where: { sportEventParticipantId },
      include: { golf: true },
    });
  }

  it('writes each round and standing only for the named event', async () => {
    const { event, sepByKey, otherSepByKey } = await createLiveField('scoped', ['rory', 'tiger']);

    const persisted = await publishLiveScoreUpdate({
      category: 'GOLF',
      externalEventId: event.externalId,
      rounds: [
        { participantExternalId: 'scoped-rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
        { participantExternalId: 'scoped-tiger', round: 1, strokes: 37, scoreToPar: 1, thru: 9, status: 'IN_PROGRESS' },
      ],
    }, { prisma: getPrisma(), providerId: PROVIDER });

    expect(persisted).toMatchObject({ updatesReturned: 2, updatesPersisted: 2, updatesSkipped: 0 });
    expect(await standingOf(sepByKey.get('rory')!)).toMatchObject({
      currentRound: 1,
      status: 'COMPLETE',
      golf: { eventScoreToPar: -2, eventStrokes: 70, currentRoundThru: 18 },
    });
    expect(await standingOf(sepByKey.get('tiger')!)).toMatchObject({
      currentRound: 1,
      status: 'IN_PROGRESS',
      golf: { eventScoreToPar: 1, eventStrokes: 37, currentRoundThru: 9 },
    });
    expect(await getPrisma().sportEventParticipantRound.count({
      where: { sportEventParticipantId: { in: [...otherSepByKey.values()] } },
    })).toBe(0);
  });

  it('records non-finishers as WITHDRAWN and a missed cut as ELIMINATED on the cross-sport standing', async () => {
    const { event, sepByKey } = await createLiveField('status', ['dnf', 'dsq', 'cut']);

    await publishLiveScoreUpdate({
      category: 'GOLF',
      externalEventId: event.externalId,
      rounds: [
        { participantExternalId: 'status-dnf', round: 1, strokes: 75, scoreToPar: 3, status: 'DNF' },
        { participantExternalId: 'status-dsq', round: 1, strokes: 75, scoreToPar: 3, status: 'DSQ' },
        { participantExternalId: 'status-cut', round: 1, strokes: 78, scoreToPar: 6, status: 'MISSED_CUT' },
      ],
    }, { prisma: getPrisma(), providerId: PROVIDER });

    expect((await standingOf(sepByKey.get('dnf')!))?.status).toBe('WITHDRAWN');
    expect((await standingOf(sepByKey.get('dsq')!))?.status).toBe('WITHDRAWN');
    expect((await standingOf(sepByKey.get('cut')!))?.status).toBe('ELIMINATED');
  });

  it('reports an identical second poll as unchanged rows, not fresh writes', async () => {
    const { event } = await createLiveField('idempotent', ['rory']);
    const result = {
      category: 'GOLF' as const,
      externalEventId: event.externalId,
      rounds: [{ participantExternalId: 'idempotent-rory', round: 1, strokes: 34, scoreToPar: -2, thru: 9, status: 'IN_PROGRESS' as const }],
    };
    const deps = { prisma: getPrisma(), providerId: PROVIDER };

    await publishLiveScoreUpdate(result, deps);
    const second = await publishLiveScoreUpdate(result, deps);

    expect(second.writeDiagnostics.summary).toEqual({ total: 2, unchanged: 2, created: 0, updated: 0, deleted: 0 });
    expect(second.writeDiagnostics.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'SportEventParticipantGolfRound',
        disposition: 'UNCHANGED',
        after: expect.objectContaining({ scoreToPar: -2, thru: 9 }),
      }),
      expect.objectContaining({
        entityType: 'SportEventParticipantGolfStanding',
        disposition: 'UNCHANGED',
        after: expect.objectContaining({ eventScoreToPar: -2, currentRoundThru: 9 }),
      }),
    ]));
  });

  it('skips a round whose provider id maps to no participant, and persists the rest', async () => {
    const { event } = await createLiveField('unmapped', ['rory']);

    const persisted = await publishLiveScoreUpdate({
      category: 'GOLF',
      externalEventId: event.externalId,
      rounds: [
        { participantExternalId: 'unmapped-rory', round: 1, strokes: 70, scoreToPar: -2, status: 'COMPLETED' },
        { participantExternalId: 'nobody-we-know', round: 1, strokes: 80, scoreToPar: 8, status: 'COMPLETED' },
      ],
    }, { prisma: getPrisma(), providerId: PROVIDER });

    expect(persisted).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    expect(await getPrisma().sportEventParticipantRound.count({
      where: { sportEventParticipant: { sportEventId: event.id } },
    })).toBe(1);
  });
});

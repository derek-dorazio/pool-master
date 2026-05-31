import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { Sport } from '@poolmaster/shared/domain';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import { publishLiveScoreUpdate } from '../../../packages/core-api/src/modules/ingestion/core/score-publisher';

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
        status: 'ACTIVE',
      },
    });

    await publishLiveScoreUpdate(
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
        bus: eventBus,
      },
    );

    const row = await prisma.sportEventParticipant.findUniqueOrThrow({
      where: { id: sportEventParticipant.id },
      include: {
        golfRounds: true,
        golfStanding: true,
      },
    });

    expect(row.golfRounds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        round: 1,
        strokes: 68,
        scoreToPar: -4,
        thru: null,
      }),
      expect.objectContaining({
        round: 2,
        strokes: 33,
        scoreToPar: -3,
        thru: 9,
      }),
    ]));
    expect(row.golfStanding).toEqual(
      expect.objectContaining({
        eventScoreToPar: -7,
        eventStrokes: 101,
        currentRound: 2,
        currentRoundThru: 9,
        status: 'IN_PROGRESS',
      }),
    );
    await expect(
      prisma.sportEventParticipantGolfStanding.create({
        data: {
          sportEventParticipantId: sportEventParticipant.id,
          eventScoreToPar: -7,
          eventStrokes: 101,
          status: 'IN_PROGRESS',
        },
      }),
    ).rejects.toThrow();
  });
});

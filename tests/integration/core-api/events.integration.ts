import { randomUUID } from 'crypto';
import { Sport } from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('events routes', () => {
  it('filters events by sport and status and returns contest-eligible readiness for loaded fields', async () => {
    const prisma = getPrisma();
    const viewer = await createTestUser({ displayName: 'Events Route Viewer' });
    const eligibleEventId = randomUUID();
    const filteredOutEventId = randomUUID();
    const participantId = randomUUID();

    await prisma.sport.upsert({
      where: { name: Sport.UFC },
      update: {},
      create: {
        id: randomUUID(),
        name: Sport.UFC,
        participantType: 'INDIVIDUAL',
      },
    });

    await prisma.sportEvent.createMany({
      data: [
        {
          id: eligibleEventId,
          providerId: 'integration-test',
          externalId: `events-eligible-${eligibleEventId}`,
          sport: Sport.UFC,
          name: 'Eligible UFC Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: new Date('2099-04-23T23:00:00.000Z'),
          releaseAt: new Date('2000-04-17T12:00:00.000Z'),
          fieldLocksAt: new Date('2099-04-19T12:00:00.000Z'),
          status: 'SCHEDULED',
          participantCount: 144,
          fieldLocked: false,
          metadata: {},
        },
        {
          id: filteredOutEventId,
          providerId: 'integration-test',
          externalId: `events-filtered-${filteredOutEventId}`,
          sport: Sport.GOLF,
          name: 'Filtered Out Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: new Date('2099-04-23T23:00:00.000Z'),
          releaseAt: new Date('2000-04-17T12:00:00.000Z'),
          fieldLocksAt: new Date('2099-04-19T12:00:00.000Z'),
          status: 'COMPLETED',
          participantCount: 12,
          fieldLocked: false,
          metadata: {},
        },
      ],
    });

    await prisma.participant.create({
      data: {
        id: participantId,
        sport: {
          connect: {
            name: Sport.UFC,
          },
        },
        participantType: 'INDIVIDUAL',
        name: 'Ready Fighter',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: eligibleEventId,
        participantId,
        status: 'ACTIVE',
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC&status=SCHEDULED&limit=10',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        events: [
          expect.objectContaining({
            id: eligibleEventId,
            externalId: `events-eligible-${eligibleEventId}`,
            sport: Sport.UFC,
            readinessStatus: 'CONTEST_ELIGIBLE',
            readinessReasons: [],
            contestEligible: true,
          }),
        ],
      });
    } finally {
      await prisma.sportEventParticipant.deleteMany({
        where: { sportEventId: eligibleEventId },
      });
      await prisma.participant.deleteMany({ where: { id: participantId } });
      await prisma.sportEvent.deleteMany({
        where: { id: { in: [eligibleEventId, filteredOutEventId] } },
      });
    }
  });

  it('surfaces not released and field locked readiness branches truthfully', async () => {
    const prisma = getPrisma();
    const viewer = await createTestUser({ displayName: 'Events Readiness Viewer' });
    const notReleasedEventId = randomUUID();
    const lockedEventId = randomUUID();
    const participantId = randomUUID();

    await prisma.sport.upsert({
      where: { name: Sport.UFC },
      update: {},
      create: {
        id: randomUUID(),
        name: Sport.UFC,
        participantType: 'INDIVIDUAL',
      },
    });

    await prisma.sportEvent.createMany({
      data: [
        {
          id: notReleasedEventId,
          providerId: 'integration-test',
          externalId: `events-not-released-${notReleasedEventId}`,
          sport: Sport.UFC,
          name: 'Not Released Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: null,
          releaseAt: new Date('2099-04-17T12:00:00.000Z'),
          fieldLocksAt: new Date('2099-04-19T12:00:00.000Z'),
          status: 'SCHEDULED',
          participantCount: 100,
          fieldLocked: false,
          metadata: {},
        },
        {
          id: lockedEventId,
          providerId: 'integration-test',
          externalId: `events-locked-${lockedEventId}`,
          sport: Sport.UFC,
          name: 'Locked Event',
          startDate: new Date('2099-04-20T15:00:00.000Z'),
          endDate: null,
          releaseAt: new Date('2000-04-17T12:00:00.000Z'),
          fieldLocksAt: new Date('2099-04-19T12:00:00.000Z'),
          status: 'SCHEDULED',
          participantCount: 100,
          fieldLocked: true,
          metadata: {},
        },
      ],
    });

    await prisma.participant.create({
      data: {
        id: participantId,
        sport: {
          connect: {
            name: Sport.UFC,
          },
        },
        participantType: 'INDIVIDUAL',
        name: 'Locked Fighter',
      },
    });
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: lockedEventId,
        participantId,
        status: 'ACTIVE',
      },
    });

    try {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/events/?sport=UFC&limit=100',
        headers: viewer.headers,
      });

      expect(res.statusCode).toBe(200);
      const payload = res.json() as {
        events: Array<{ id: string; readinessStatus: string; readinessReasons: string[] }>;
      };

      expect(payload.events.find((event) => event.id === notReleasedEventId)).toMatchObject({
        readinessStatus: 'NOT_RELEASED',
        readinessReasons: ['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED'],
      });
      expect(payload.events.find((event) => event.id === lockedEventId)).toMatchObject({
        readinessStatus: 'FIELD_LOCKED',
        readinessReasons: ['FIELD_LOCKED'],
      });
    } finally {
      await prisma.sportEventParticipant.deleteMany({
        where: { sportEventId: lockedEventId },
      });
      await prisma.participant.deleteMany({ where: { id: participantId } });
      await prisma.sportEvent.deleteMany({
        where: { id: { in: [notReleasedEventId, lockedEventId] } },
      });
    }
  });
});

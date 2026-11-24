/**
 * #1850, #1853 — the sync matches a feed participant by its feed id alone, within the sport league
 * of the event it syncs, against real Postgres: an id no participant of the league is mapped to is
 * a new participant of that league, whatever the site already holds by that name; a mapped id
 * updates its one row; the same id in another league's event is another participant; and a test
 * data participant whose feed id the Load test data run bound is the row the sync fields, so the
 * two never make a duplicate.
 */
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { testDomainEvents } from '../../support/domain-events';
import { randomUUID } from 'crypto';
import { expect } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import { getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { PrismaParticipantProviderMappingRepository, PrismaParticipantRepository } from '../../../packages/core-api/src/adapters';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import type { ProviderParticipant, SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { linkedProviderEvent } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';

// A feed's participants are mapped to its Provider row (#2040), so the suite syncs as BALLDONTLIE.
const PROVIDER = 'balldontlie';
const NAME_PREFIX = 'Feed Id 1850 ';

beforeAll(async () => {
  await setupIntegrationTests();
});
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipant.deleteMany({ where: { sportEvent: { providerId: PROVIDER } } });
  await prisma.sportEventRound.deleteMany({ where: { sportEvent: { providerId: PROVIDER } } });
  await prisma.sportEvent.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.participantProviderMapping.deleteMany({ where: { participant: { name: { startsWith: NAME_PREFIX } } } });
  await prisma.participant.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
  await prisma.eventSeries.deleteMany({ where: { sportLeague: { name: { startsWith: NAME_PREFIX } } } });
  await prisma.sportLeague.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
  await teardownIntegrationTests();
});

/** A golfer as the feed sends them, and a linked event whose field the feed sends them in. */
async function fieldOf(overrides: Partial<ProviderParticipant> = {}) {
  const prisma = getPrisma();
  const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const suffix = randomUUID().slice(0, 8);
  const golfer: ProviderParticipant = { externalId: `golfer-${suffix}`, providerId: PROVIDER, sport: Sport.GOLF, name: `${NAME_PREFIX}${suffix}`, active: true, ranking: 7, metadata: {}, ...overrides };
  const detail: SportEventDetail = {
    externalId: `event-${suffix}`,
    providerId: PROVIDER,
    sport: Sport.GOLF,
    name: `Feed Id Open ${suffix}`,
    startDate: new Date('2027-07-15T12:00:00.000Z'),
    status: 'SCHEDULED',
    fieldLocked: false,
    metadata: {},
    participants: [golfer],
  };
  const event = await linkedProviderEvent(prisma, { providerId: PROVIDER, externalId: detail.externalId, name: detail.name, startDate: detail.startDate });
  // Each event on a sport league of its own, so a test sees only the participants it makes.
  const league = await prisma.sportLeague.create({ data: { ...(await sportLeagueRowDefaults(prisma)), sportId: golf.id, name: `${NAME_PREFIX}league ${suffix}` } });
  await prisma.eventSeries.update({ where: { id: event.eventSeriesId }, data: { sportLeagueId: league.id } });
  return { golfer, detail, event, sportLeagueId: league.id, suffix };
}

const sync = (detail: SportEventDetail) => new IngestionPersistence(getAppPrisma(), testDomainEvents()).persistEventDetailWithDiagnostics(detail);
const mappingOf = (externalId: string, sportLeagueId: string) => getPrisma().participantProviderMapping.findUnique({
  where: { providerId_externalId_sportLeagueId_participantType: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId, sportLeagueId, participantType: 'INDIVIDUAL' } },
});
const fieldOfEvent = (sportEventId: string) => getPrisma().sportEventParticipant.findMany({ where: { sportEventId }, select: { participantId: true, ranking: true } });

describe('a field sync records when it last saw each participant in the feed (#1865)', () => {
  it('stamps a new feed participant\'s mapping as seen when the sync creates it, and moves the stamp on each later sync that lists it', async () => {
    const { golfer, detail, sportLeagueId } = await fieldOf();
    const before = new Date();

    await sync(detail);
    const first = (await mappingOf(golfer.externalId, sportLeagueId))?.lastSeenAt;
    await sync(detail);
    const second = (await mappingOf(golfer.externalId, sportLeagueId))?.lastSeenAt;

    expect(first?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(second?.getTime()).toBeGreaterThan(first?.getTime() ?? Infinity);
  });

  it('leaves a mapping the feed did not list as last seen when it was', async () => {
    const prisma = getPrisma();
    const { golfer, detail, sportLeagueId } = await fieldOf();
    const absent = await prisma.participant.create({ data: { sportLeagueId, name: `${golfer.name} absent`, participantType: 'INDIVIDUAL' } });
    const seenLongAgo = new Date('2026-01-01T00:00:00.000Z');
    await prisma.participantProviderMapping.create({ data: { participantId: absent.id, sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'INDIVIDUAL', externalId: `absent-${golfer.externalId}`, lastSeenAt: seenLongAgo } });

    await sync(detail);

    await expect(mappingOf(`absent-${golfer.externalId}`, sportLeagueId)).resolves.toMatchObject({ lastSeenAt: seenLongAgo });
    await expect(mappingOf(golfer.externalId, sportLeagueId)).resolves.toMatchObject({ lastSeenAt: expect.any(Date) });
  });
});

describe('the sync matches feed participants by feed id only, within the event\'s sport league (#1850, #1853)', () => {
  it('creates a new golfer of the event\'s sport league, with a mapping to its feed id and on the field, for a feed id no participant is mapped to, though the league holds an unmapped golfer of the same name', async () => {
    const prisma = getPrisma();
    const { golfer, detail, event, sportLeagueId } = await fieldOf();
    const sameName = await prisma.participant.create({ data: { sportLeagueId, name: golfer.name, participantType: 'INDIVIDUAL' } });

    await sync(detail);

    const mapping = await mappingOf(golfer.externalId, sportLeagueId);
    await expect(prisma.participant.findUniqueOrThrow({ where: { id: mapping?.participantId ?? 'none' } })).resolves.toMatchObject({ sportLeagueId });
    expect(mapping).toMatchObject({ participantType: 'INDIVIDUAL', providerId: BALLDONTLIE_TEST_PROVIDER_ID });
    expect(mapping?.participantId).not.toBe(sameName.id);
    await expect(fieldOfEvent(event.id)).resolves.toEqual([{ participantId: mapping?.participantId, ranking: 7 }]);
    await expect(prisma.participantProviderMapping.count({ where: { participantId: sameName.id } })).resolves.toBe(0);
  });

  it('makes the same feed id in events of two sport leagues two participants, one in each league, each on its own event\'s field', async () => {
    const prisma = getPrisma();
    const first = await fieldOf();
    const second = await fieldOf({ externalId: first.golfer.externalId, name: first.golfer.name });

    await sync(first.detail);
    await sync(second.detail);

    const inFirst = await mappingOf(first.golfer.externalId, first.sportLeagueId);
    const inSecond = await mappingOf(first.golfer.externalId, second.sportLeagueId);
    expect(inFirst?.participantId).toBeDefined();
    expect(inSecond?.participantId).toBeDefined();
    expect(inSecond?.participantId).not.toBe(inFirst?.participantId);
    await expect(prisma.participant.findMany({ where: { id: { in: [inFirst?.participantId ?? '', inSecond?.participantId ?? ''] } }, select: { sportLeagueId: true }, orderBy: { createdAt: 'asc' } }))
      .resolves.toEqual([{ sportLeagueId: first.sportLeagueId }, { sportLeagueId: second.sportLeagueId }]);
    await expect(fieldOfEvent(first.event.id)).resolves.toEqual([{ participantId: inFirst?.participantId, ranking: 7 }]);
    await expect(fieldOfEvent(second.event.id)).resolves.toEqual([{ participantId: inSecond?.participantId, ranking: 7 }]);
  });

  it('updates the one golfer a known feed id is mapped to when the feed renames them, and creates no other', async () => {
    const prisma = getPrisma();
    const { golfer, detail, event, sportLeagueId, suffix } = await fieldOf();
    await sync(detail);
    const { participantId } = await mappingOf(golfer.externalId, sportLeagueId) ?? { participantId: 'none' };
    const renamed = `${NAME_PREFIX}${suffix} Jr.`;

    await sync({ ...detail, participants: [{ ...golfer, name: renamed }] });

    await expect(prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).resolves.toMatchObject({ name: renamed });
    await expect(prisma.participant.count({ where: { sportLeagueId, name: { startsWith: `${NAME_PREFIX}${suffix}` } } })).resolves.toBe(1);
    await expect(fieldOfEvent(event.id)).resolves.toEqual([{ participantId, ranking: 7 }]);
  });

  it('fields the test data golfer whose feed id the Load test data run bound, spelled however the file spells them, and creates no duplicate', async () => {
    const prisma = getPrisma();
    const { golfer, detail, event, sportLeagueId } = await fieldOf();
    // As the loader writes a test player: created in its league under the file's spelling, then its feed id bound.
    const seeded = await prisma.participant.create({ data: { sportLeagueId, name: `${golfer.name} (test spelling)`, participantType: 'INDIVIDUAL' } });
    const participants = new ParticipantService(new PrismaParticipantRepository(getAppPrisma()), new PrismaParticipantProviderMappingRepository(getAppPrisma()));
    await participants.bindProviderMapping(seeded.id, BALLDONTLIE_TEST_PROVIDER_ID, golfer.externalId);

    await sync(detail);

    await expect(fieldOfEvent(event.id)).resolves.toEqual([{ participantId: seeded.id, ranking: 7 }]);
    await expect(prisma.participant.count({ where: { sportLeagueId, name: { startsWith: golfer.name } } })).resolves.toBe(1);
    await expect(prisma.participant.findUniqueOrThrow({ where: { id: seeded.id } })).resolves.toMatchObject({ name: golfer.name });
  });
});

/**
 * #1850 — the sync matches a feed participant by its feed id alone, against real Postgres: an id
 * no participant is mapped to is a new participant, whatever the site already holds by that name;
 * a mapped id updates its one row; and a test data participant whose feed id the Load test data
 * run bound is the row the sync fields, so the two never make a duplicate.
 */
import { randomUUID } from 'crypto';
import { expect } from '@jest/globals';
import { Sport } from '@poolmaster/shared/domain';
import { getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { PrismaParticipantProviderMappingRepository, PrismaParticipantRepository } from '../../../packages/core-api/src/adapters';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import type { ProviderParticipant, SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { linkedProviderEvent } from '../../support/event-edition';
import { leagueProfiles } from '../../support/league-profiles';

const PROVIDER = 'TEST_PROVIDER_1850';
const NAME_PREFIX = 'Feed Id 1850 ';

beforeAll(async () => {
  await setupIntegrationTests();
});
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.sportEventParticipant.deleteMany({ where: { sportEvent: { providerId: PROVIDER } } });
  await prisma.sportEventRound.deleteMany({ where: { sportEvent: { providerId: PROVIDER } } });
  await prisma.sportEvent.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.participantProviderMapping.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.participantLeagueAffiliation.deleteMany({ where: { participant: { name: { startsWith: NAME_PREFIX } } } });
  await prisma.participant.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
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
  return { golfer, detail, event, golfId: golf.id, suffix };
}

const sync = (detail: SportEventDetail) => new IngestionPersistence(getAppPrisma()).persistEventDetailWithDiagnostics(detail);
const mappingOf = (externalId: string) => getPrisma().participantProviderMapping.findUnique({ where: { providerId_externalId: { providerId: PROVIDER, externalId } } });
const fieldOfEvent = (sportEventId: string) => getPrisma().sportEventParticipant.findMany({ where: { sportEventId }, select: { participantId: true, ranking: true } });

describe('the sync matches feed participants by feed id only (#1850)', () => {
  it('creates a new golfer, with an EXACT mapping and on the field, for a feed id no participant is mapped to, though the site holds an unmapped golfer of the same name', async () => {
    const prisma = getPrisma();
    const { golfer, detail, event, golfId } = await fieldOf();
    const sameName = await prisma.participant.create({ data: { sportId: golfId, name: golfer.name, participantType: 'INDIVIDUAL' } });

    await sync(detail);

    const mapping = await mappingOf(golfer.externalId);
    expect(mapping).toMatchObject({ confidence: 'EXACT' });
    expect(mapping?.participantId).not.toBe(sameName.id);
    await expect(fieldOfEvent(event.id)).resolves.toEqual([{ participantId: mapping?.participantId, ranking: 7 }]);
    await expect(prisma.participantProviderMapping.count({ where: { participantId: sameName.id } })).resolves.toBe(0);
  });

  it('affiliates the golfer it creates with the sport league its tour names', async () => {
    const prisma = getPrisma();
    const keyword = `TOUR-1850-${randomUUID().slice(0, 8)}`;
    const { golfer, detail, golfId } = await fieldOf({ metadata: { tour: keyword } });
    const tour = await prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: golfId, name: `${NAME_PREFIX}${keyword}`, matchKeyword: keyword } });

    await sync(detail);

    const mapping = await mappingOf(golfer.externalId);
    await expect(prisma.participantLeagueAffiliation.findMany({ where: { participantId: mapping?.participantId }, select: { sportLeagueId: true } })).resolves.toEqual([{ sportLeagueId: tour.id }]);
  });

  it('updates the one golfer a known feed id is mapped to when the feed renames them, and creates no other', async () => {
    const prisma = getPrisma();
    const { golfer, detail, event, golfId, suffix } = await fieldOf();
    await sync(detail);
    const { participantId } = await mappingOf(golfer.externalId) ?? { participantId: 'none' };
    const renamed = `${NAME_PREFIX}${suffix} Jr.`;

    await sync({ ...detail, participants: [{ ...golfer, name: renamed }] });

    await expect(prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).resolves.toMatchObject({ name: renamed });
    await expect(prisma.participant.count({ where: { sportId: golfId, name: { startsWith: `${NAME_PREFIX}${suffix}` } } })).resolves.toBe(1);
    await expect(fieldOfEvent(event.id)).resolves.toEqual([{ participantId, ranking: 7 }]);
  });

  it('fields the test data golfer whose feed id the Load test data run bound, spelled however the file spells them, and creates no duplicate', async () => {
    const prisma = getPrisma();
    const { golfer, detail, event, golfId } = await fieldOf();
    // As the loader writes a test player: created under the file's spelling, then its feed id bound.
    const seeded = await prisma.participant.create({ data: { sportId: golfId, name: `${golfer.name} (test spelling)`, participantType: 'INDIVIDUAL', externalId: 'test-file-key' } });
    const participants = new ParticipantService(new PrismaParticipantRepository(getAppPrisma()), new PrismaParticipantProviderMappingRepository(getAppPrisma()));
    await participants.bindProviderMapping(seeded.id, PROVIDER, golfer.externalId);

    await sync(detail);

    await expect(fieldOfEvent(event.id)).resolves.toEqual([{ participantId: seeded.id, ranking: 7 }]);
    await expect(prisma.participant.count({ where: { sportId: golfId, name: { startsWith: golfer.name } } })).resolves.toBe(1);
    await expect(prisma.participant.findUniqueOrThrow({ where: { id: seeded.id } })).resolves.toMatchObject({ name: golfer.name });
  });
});

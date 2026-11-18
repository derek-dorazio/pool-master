/**
 * #1824 — a feed participant two or more of the site's participants could be waits as "needs
 * linking", and a root admin resolves it, against real Postgres and through the app's routes:
 * the sync holds one row per feed id however often it syncs, links and creates nothing for it,
 * and resolving maps the feed id, writes the field row at once, and lets the next sync link it
 * on its own. Every branch of the name match is a unit test (`ingestion-persistence.test.ts`).
 */
import { randomUUID } from 'crypto';
import { expect } from '@jest/globals';
import type { Response } from 'light-my-request';
import { Sport } from '@poolmaster/shared/domain';
import {
  AmbiguousFeedParticipantDtoSchema,
  AmbiguousFeedParticipantListResponseSchema,
  type ErrorEnvelope,
} from '@poolmaster/shared/dto';
import { getApp, getAppPrisma, getPrisma, createTestUser, setupIntegrationTests, teardownIntegrationTests, type TestUserResult } from '../helpers';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { PrismaAmbiguousFeedParticipantRepository, PrismaParticipantProviderMappingRepository, PrismaParticipantRepository } from '../../../packages/core-api/src/adapters';
import { ParticipantService } from '../../../packages/core-api/src/modules/participants/service';
import type { ProviderParticipant, SportEventDetail } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { linkedProviderEvent } from '../../support/event-edition';
import { recordStatements, statementsOn, StatementVerb } from '../statement-log';

const PROVIDER = 'TEST_PROVIDER_1824';
let rootAdmin: TestUserResult;

beforeAll(async () => {
  await setupIntegrationTests();
  rootAdmin = await createTestUser({ isRootAdmin: true });
});
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.ambiguousFeedParticipant.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.sportEventParticipant.deleteMany({ where: { sportEvent: { providerId: PROVIDER } } });
  await prisma.sportEventRound.deleteMany({ where: { sportEvent: { providerId: PROVIDER } } });
  await prisma.sportEvent.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.participantProviderMapping.deleteMany({ where: { providerId: PROVIDER } });
  await prisma.participantLeagueAffiliation.deleteMany({ where: { participant: { name: { startsWith: 'Twin 1824 ' } } } });
  await prisma.participant.deleteMany({ where: { name: { startsWith: 'Twin 1824 ' } } });
  await prisma.sportLeague.deleteMany({ where: { name: { startsWith: 'Twin 1824 ' } } });
  await teardownIntegrationTests();
});

/** Two of the site's golfers who share a name, neither mapped from the provider, and a linked event whose field the feed sends that name in. */
async function twinsAndField() {
  const prisma = getPrisma();
  const golf = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const suffix = randomUUID().slice(0, 8);
  const name = `Twin 1824 ${suffix}`;
  const [first, second] = await prisma.participant.createManyAndReturn({
    data: [0, 1].map(() => ({ sportId: golf.id, name, participantType: 'INDIVIDUAL' as const })),
    select: { id: true },
  });
  const golfer: ProviderParticipant = { externalId: `feed-${suffix}`, providerId: PROVIDER, sport: Sport.GOLF, name, active: true, ranking: 7, metadata: {} };
  const detail: SportEventDetail = {
    externalId: `event-${suffix}`,
    providerId: PROVIDER,
    sport: Sport.GOLF,
    name: `Twins Open ${suffix}`,
    startDate: new Date('2027-07-15T12:00:00.000Z'),
    status: 'SCHEDULED',
    fieldLocked: false,
    metadata: {},
    participants: [golfer],
  };
  const event = await linkedProviderEvent(prisma, { providerId: PROVIDER, externalId: detail.externalId, name: detail.name, startDate: detail.startDate });
  return { first, second, golfer, detail, event, golfId: golf.id };
}

const persistence = () => new IngestionPersistence(getAppPrisma());
const repository = () => new PrismaAmbiguousFeedParticipantRepository(getAppPrisma());
const heldRowsOf = (externalId: string) => getPrisma().ambiguousFeedParticipant.findMany({ where: { providerId: PROVIDER, externalId }, include: { sightings: true } });
const mappingOf = (externalId: string) => getPrisma().participantProviderMapping.findUnique({ where: { providerId_externalId: { providerId: PROVIDER, externalId } } });
const resolve = (id: string, payload: Record<string, string>): Promise<Response> => getApp().inject({ method: 'POST', url: `/api/v1/ingestion/ambiguous-participants/${id}/resolve`, headers: rootAdmin.headers, payload });

describe('feed participants needing linking (#1824)', () => {
  it('holds a name two site golfers share as one needs-linking row with both candidates, links and fields nothing, and a second sync holds it once still', async () => {
    const { first, second, golfer, detail, event } = await twinsAndField();

    await persistence().persistEventDetailWithDiagnostics(detail);
    const { statements } = await recordStatements(() => persistence().persistEventDetailWithDiagnostics(detail));

    const rows = await heldRowsOf(golfer.externalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feedName: golfer.name, resolvedAt: null, sportLeagueId: expect.any(String) });
    expect([...rows[0].candidateParticipantIds].sort()).toEqual([first.id, second.id].sort());
    expect(rows[0].sightings).toEqual([expect.objectContaining({ sportEventId: event.id, feedParticipant: expect.objectContaining({ externalId: golfer.externalId, ranking: 7 }) })]);
    await expect(mappingOf(golfer.externalId)).resolves.toBeNull();
    await expect(getPrisma().sportEventParticipant.count({ where: { sportEventId: event.id } })).resolves.toBe(0);
    await expect(repository().countOpenForEvent(event.id)).resolves.toBe(1);
    // The held rows are read once, by their unique key, and none is inserted a second time.
    expect(statementsOn(statements, StatementVerb.SELECT, 'ambiguous_feed_participants')).toHaveLength(1);
    expect(statementsOn(statements, StatementVerb.INSERT, 'ambiguous_feed_participants')).toHaveLength(0);
  });

  it('lists the open row in its sport league, with its candidates and event, and resolving it to a candidate maps the feed id, fields the golfer at once and closes it', async () => {
    const { second, golfer, detail, event } = await twinsAndField();
    await persistence().persistEventDetailWithDiagnostics(detail);
    const [row] = await heldRowsOf(golfer.externalId);

    const listed: Response = await getApp().inject({ method: 'GET', url: `/api/v1/ingestion/ambiguous-participants?sportLeagueId=${row.sportLeagueId}`, headers: rootAdmin.headers });
    expect(listed.statusCode).toBe(200);
    const { participants } = AmbiguousFeedParticipantListResponseSchema.parse(listed.json());
    expect(participants.find((listedRow) => listedRow.id === row.id)).toMatchObject({
      externalId: golfer.externalId,
      events: [{ sportEventId: event.id, name: detail.name, startDate: detail.startDate.toISOString() }],
      resolvedAt: null,
    });

    const resolved = await resolve(row.id, { resolution: 'LINK', participantId: second.id });

    expect(resolved.statusCode).toBe(200);
    expect(AmbiguousFeedParticipantDtoSchema.parse(resolved.json())).toMatchObject({ id: row.id, resolvedParticipantId: second.id, resolvedAt: expect.any(String) });
    await expect(mappingOf(golfer.externalId)).resolves.toMatchObject({ participantId: second.id, confidence: 'MANUAL' });
    await expect(getPrisma().sportEventParticipant.findMany({ where: { sportEventId: event.id } })).resolves.toEqual([expect.objectContaining({ participantId: second.id, ranking: 7 })]);
    await expect(repository().countOpenForEvent(event.id)).resolves.toBe(0);
    const after: Response = await getApp().inject({ method: 'GET', url: `/api/v1/ingestion/ambiguous-participants?sportLeagueId=${row.sportLeagueId}`, headers: rootAdmin.headers });
    expect(AmbiguousFeedParticipantListResponseSchema.parse(after.json()).participants.some((listedRow) => listedRow.id === row.id)).toBe(false);

    // The next sync links the golfer by the mapping on its own: no row is held again.
    await persistence().persistEventDetailWithDiagnostics(detail);
    await expect(heldRowsOf(golfer.externalId)).resolves.toEqual([expect.objectContaining({ id: row.id, resolvedParticipantId: second.id })]);
    await expect(getPrisma().sportEventParticipant.count({ where: { sportEventId: event.id } })).resolves.toBe(1);
  });

  it('resolving it as none of its candidates creates the golfer from the feed\'s copy, in its sport league, with an EXACT mapping and its field row', async () => {
    const { golfer, detail, event, golfId } = await twinsAndField();
    await persistence().persistEventDetailWithDiagnostics(detail);
    const [row] = await heldRowsOf(golfer.externalId);

    const resolved = await resolve(row.id, { resolution: 'CREATE' });

    expect(resolved.statusCode).toBe(200);
    const created = AmbiguousFeedParticipantDtoSchema.parse(resolved.json()).resolvedParticipantId as string;
    await expect(getPrisma().participant.findUniqueOrThrow({ where: { id: created } })).resolves.toMatchObject({ sportId: golfId, name: golfer.name, externalId: golfer.externalId });
    await expect(mappingOf(golfer.externalId)).resolves.toMatchObject({ participantId: created, confidence: 'EXACT' });
    await expect(getPrisma().sportEventParticipant.findMany({ where: { sportEventId: event.id } })).resolves.toEqual([expect.objectContaining({ participantId: created, ranking: 7 })]);
  });

  it('affiliates a created golfer with the sport league its tour names, as a sync does, and reuses the golfer an earlier attempt created rather than creating another', async () => {
    const prisma = getPrisma();
    const { first, second, golfer, detail, golfId } = await twinsAndField();
    const keyword = `TOUR-1824-${randomUUID().slice(0, 8)}`;
    const tour = await prisma.sportLeague.create({ data: { sportId: golfId, name: `Twin 1824 ${keyword}`, matchKeyword: keyword } });
    // Both twins play the tour the feed names, so the name stays ambiguous within it.
    await prisma.participantLeagueAffiliation.createMany({ data: [first.id, second.id].map((participantId) => ({ participantId, sportLeagueId: tour.id })) });
    await persistence().persistEventDetailWithDiagnostics({ ...detail, participants: [{ ...golfer, metadata: { tour: keyword } }] });
    const [row] = await heldRowsOf(golfer.externalId);
    const earlier = await prisma.participant.create({ data: { sportId: golfId, name: golfer.name, participantType: 'INDIVIDUAL' } });
    await prisma.ambiguousFeedParticipant.update({ where: { id: row.id }, data: { resolvedParticipantId: earlier.id } });

    const resolved = await resolve(row.id, { resolution: 'CREATE' });

    expect(AmbiguousFeedParticipantDtoSchema.parse(resolved.json()).resolvedParticipantId).toBe(earlier.id);
    await expect(prisma.participantLeagueAffiliation.findMany({ where: { participantId: earlier.id }, select: { sportLeagueId: true } })).resolves.toEqual([{ sportLeagueId: tour.id }]);
    await expect(prisma.participant.count({ where: { sportId: golfId, name: golfer.name } })).resolves.toBe(3);
  });

  it('refuses a pick that is not a candidate with 422 and a row resolved already with 409, and writes nothing for either', async () => {
    const { first, golfer, detail } = await twinsAndField();
    await persistence().persistEventDetailWithDiagnostics(detail);
    const [row] = await heldRowsOf(golfer.externalId);

    const notCandidate = await resolve(row.id, { resolution: 'LINK', participantId: randomUUID() });
    expect(notCandidate.statusCode).toBe(422);
    expect(notCandidate.json<ErrorEnvelope>().error.code).toBe('FEED_PARTICIPANT_NOT_A_CANDIDATE');
    await expect(mappingOf(golfer.externalId)).resolves.toBeNull();

    await resolve(row.id, { resolution: 'LINK', participantId: first.id });
    const again = await resolve(row.id, { resolution: 'CREATE' });
    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorEnvelope>().error.code).toBe('FEED_PARTICIPANT_LINK_RESOLVED');

    const missing = await resolve(randomUUID(), { resolution: 'CREATE' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorEnvelope>().error.code).toBe('FEED_PARTICIPANT_LINK_NOT_FOUND');
  });

  it('closes the open row of a feed id a root admin binds by hand on the participant page, as linked to that participant', async () => {
    const { first, golfer, detail, event } = await twinsAndField();
    await persistence().persistEventDetailWithDiagnostics(detail);

    // The participant page's bind, as its route wires it; the route itself needs a registered provider.
    const participants = new ParticipantService(new PrismaParticipantRepository(getAppPrisma()), new PrismaParticipantProviderMappingRepository(getAppPrisma()), undefined, repository());

    await participants.bindProviderMapping(first.id, PROVIDER, golfer.externalId);

    await expect(heldRowsOf(golfer.externalId)).resolves.toEqual([expect.objectContaining({ resolvedParticipantId: first.id, resolvedAt: expect.any(Date) })]);
    await expect(repository().countOpenForEvent(event.id)).resolves.toBe(0);
  });

  it('links a held golfer on the next sync once one candidate is left, and closes its row as linked to that one', async () => {
    const { first, second, golfer, detail } = await twinsAndField();
    await persistence().persistEventDetailWithDiagnostics(detail);
    await getPrisma().participant.delete({ where: { id: second.id } });

    await persistence().persistEventDetailWithDiagnostics(detail);

    await expect(mappingOf(golfer.externalId)).resolves.toMatchObject({ participantId: first.id, confidence: 'HIGH' });
    await expect(heldRowsOf(golfer.externalId)).resolves.toEqual([expect.objectContaining({ resolvedParticipantId: first.id, resolvedAt: expect.any(Date) })]);
  });
});

describe('PrismaAmbiguousFeedParticipantRepository (#1824)', () => {
  it('reads a row with a deleted candidate left out and its events soonest first, lists it among every league\'s open rows, and reads no row for an unknown id', async () => {
    const prisma = getPrisma();
    const { first, second, golfer, detail, event } = await twinsAndField();
    await persistence().persistEventDetailWithDiagnostics(detail);
    const sooner = await linkedProviderEvent(prisma, { providerId: PROVIDER, externalId: `${detail.externalId}-sooner`, name: `${detail.name} Sooner`, startDate: new Date('2027-07-01T12:00:00.000Z') });
    await persistence().persistEventDetailWithDiagnostics({ ...detail, externalId: `${detail.externalId}-sooner`, name: `${detail.name} Sooner` });
    await prisma.participant.update({ where: { id: second.id }, data: { name: `${golfer.name} renamed` } });
    const [row] = await heldRowsOf(golfer.externalId);
    // A candidate deleted since: the row still names it, the read leaves it out.
    await prisma.ambiguousFeedParticipant.update({ where: { id: row.id }, data: { candidateParticipantIds: [first.id, randomUUID()] } });

    const read = await repository().findById(row.id);

    expect(read).toMatchObject({ candidates: [{ participantId: first.id, name: golfer.name }], resolvedAt: null, resolvedParticipantId: null });
    expect(read?.events.map((seen) => seen.sportEventId)).toEqual([sooner.id, event.id]);
    await expect(repository().listOpen({}).then((rows) => rows.some((listed) => listed.id === row.id))).resolves.toBe(true);
    await expect(repository().findById(randomUUID())).resolves.toBeNull();
    await expect(repository().countOpenForEvent(sooner.id)).resolves.toBe(1);
  });

  it('lists nothing, with no read of candidates, for a sport league with no open rows', async () => {
    const { statements } = await recordStatements(async () => {
      const rows = await repository().listOpen({ sportLeagueId: randomUUID() });
      expect(rows).toEqual([]);
    });

    expect(statementsOn(statements, StatementVerb.SELECT, 'participants')).toHaveLength(0);
  });
});

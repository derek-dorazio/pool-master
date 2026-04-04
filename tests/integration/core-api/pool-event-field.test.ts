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
  const prisma = getPrisma();
  await prisma.participantProviderMapping.deleteMany({
    where: { externalId: { startsWith: 'event-field-' } },
  }).catch(() => {});
  await prisma.sportEvent.deleteMany({
    where: { externalId: { startsWith: 'event-field-' } },
  }).catch(() => {});
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest pool EVENT_FIELD resolution', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;

  beforeAll(async () => {
    const owner = await createTestUser({ displayName: 'Event Field Owner' });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers: ownerHeaders,
      payload: { name: 'Event Field League', visibility: 'PRIVATE' },
    });
    leagueId = leagueRes.json().league.id;
  });

  it('resolves bracket event fields into contest participants and round-one matchups', async () => {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { name: 'NCAA_BASKETBALL' },
      create: { name: 'NCAA_BASKETBALL', participantType: 'TEAM' },
      update: {},
    });

    const teams = await Promise.all([
      createMappedParticipant(sport.id, 'Bracket Team 1', 'event-field-bracket-team-1'),
      createMappedParticipant(sport.id, 'Bracket Team 2', 'event-field-bracket-team-2'),
      createMappedParticipant(sport.id, 'Bracket Team 3', 'event-field-bracket-team-3'),
      createMappedParticipant(sport.id, 'Bracket Team 4', 'event-field-bracket-team-4'),
    ]);

    const event = await prisma.sportEvent.create({
      data: {
        externalId: 'event-field-bracket-event',
        providerId: 'espn',
        sport: 'NCAA_BASKETBALL',
        name: 'Bracket Showcase',
        startDate: new Date('2026-04-10T12:00:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        participantCount: 4,
        metadata: {
          participantExternalIds: teams.map((team) => team.externalId),
          competitors: teams.map((team, index) => ({
            externalId: team.externalId,
            name: team.name,
            seed: index + 1,
          })),
        },
      },
    });

    const contestRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers: ownerHeaders,
      payload: {
        name: 'Bracket Event Contest',
        sport: 'NCAA_BASKETBALL',
        contestType: 'SINGLE_EVENT',
        selectionType: 'BRACKET_PICK_EM',
        scoringEngine: 'BRACKET',
      },
    });
    expect(contestRes.statusCode).toBe(201);
    const contestId = (contestRes.json().contest ?? contestRes.json()).id;

    await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contestId}/pool`,
      headers: ownerHeaders,
      payload: {
        sport: 'NCAA_BASKETBALL',
        poolType: 'EVENT_FIELD',
        eventId: event.id,
      },
    });

    const resolveRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contestId}/pool/resolve`,
      headers: { authorization: ownerHeaders.authorization },
    });

    if (resolveRes.statusCode !== 200) {
      console.log('Bracket resolve failure', resolveRes.statusCode, resolveRes.body);
    }
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json()).toHaveProperty('participantCount', 4);

    const poolEntries = await prisma.contestParticipantPool.findMany({
      where: { contestId },
      orderBy: { ranking: 'asc' },
    });
    expect(poolEntries).toHaveLength(4);

    const matchups = await prisma.contestMatchup.findMany({
      where: { contestId },
      orderBy: { matchupIndex: 'asc' },
    });
    expect(matchups).toHaveLength(2);
    expect(matchups[0].homeParticipantId).toBe(teams[0].participantId);
    expect(matchups[0].awayParticipantId).toBe(teams[3].participantId);
    expect(matchups[1].homeParticipantId).toBe(teams[1].participantId);
    expect(matchups[1].awayParticipantId).toBe(teams[2].participantId);
  });

  it('resolves pickem event competitors into a live matchup row', async () => {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { name: 'NFL' },
      create: { name: 'NFL', participantType: 'TEAM' },
      update: {},
    });

    const home = await createMappedParticipant(sport.id, 'Gridiron Home', 'event-field-pickem-home');
    const away = await createMappedParticipant(sport.id, 'Gridiron Away', 'event-field-pickem-away');

    const event = await prisma.sportEvent.create({
      data: {
        externalId: 'event-field-pickem-event',
        providerId: 'the-odds-api',
        sport: 'NFL',
        name: 'Gridiron Home vs Gridiron Away',
        startDate: new Date('2026-09-10T20:15:00.000Z'),
        status: 'SCHEDULED',
        fieldLocked: false,
        participantCount: 2,
        metadata: {
          homeTeam: home.name,
          awayTeam: away.name,
          competitors: [
            { externalId: home.externalId, name: home.name, homeAway: 'home' },
            { externalId: away.externalId, name: away.name, homeAway: 'away' },
          ],
        },
      },
    });

    const contestRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/leagues/${leagueId}/contests`,
      headers: ownerHeaders,
      payload: {
        name: 'Pickem Event Contest',
        sport: 'NFL',
        contestType: 'SINGLE_EVENT',
        selectionType: 'PICK_EM',
        scoringEngine: 'CUMULATIVE',
      },
    });
    expect(contestRes.statusCode).toBe(201);
    const contestId = (contestRes.json().contest ?? contestRes.json()).id;

    await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contestId}/pool`,
      headers: ownerHeaders,
      payload: {
        sport: 'NFL',
        poolType: 'EVENT_FIELD',
        eventId: event.id,
      },
    });

    const resolveRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/contests/${contestId}/pool/resolve`,
      headers: { authorization: ownerHeaders.authorization },
    });

    if (resolveRes.statusCode !== 200) {
      console.log('Pickem resolve failure', resolveRes.statusCode, resolveRes.body);
    }
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json()).toHaveProperty('participantCount', 2);

    const matchups = await prisma.contestMatchup.findMany({
      where: { contestId },
    });
    expect(matchups).toHaveLength(1);
    expect(matchups[0].homeParticipantId).toBe(home.participantId);
    expect(matchups[0].awayParticipantId).toBe(away.participantId);
  });
});

async function createMappedParticipant(
  sportId: string,
  name: string,
  externalId: string,
): Promise<{ participantId: string; name: string; externalId: string }> {
  const prisma = getPrisma();
  const participant = await prisma.participant.create({
    data: {
      sportId,
      name,
      participantType: 'TEAM',
      externalId,
      status: 'ACTIVE',
      injuryStatus: { status: 'HEALTHY' },
      externalIds: {},
      metadata: {},
    },
  });

  await prisma.participantProviderMapping.create({
    data: {
      participantId: participant.id,
      providerId: externalId.includes('pickem') ? 'the-odds-api' : 'espn',
      externalId,
      confidence: 'EXACT',
    },
  });

  return {
    participantId: participant.id,
    name,
    externalId,
  };
}

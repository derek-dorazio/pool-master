import {
  buildContestEligibleEventTiming,
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { ContestStatus, Sport } from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Contest management integration', () => {
  let ownerHeaders: Record<string, string>;
  let leagueId: string;
  let sportId: string;
  let sportEventId: string;
  let contestId: string;
  let topParticipantId: string;
  let secondParticipantId: string;
  let entryLocksAt: string;

  async function addContestReadyGolfField(targetSize: number) {
    const prisma = getPrisma();
    const currentParticipantCount = await prisma.sportEventParticipant.count({
      where: { sportEventId },
    });
    const missingParticipantCount = Math.max(0, targetSize - currentParticipantCount);

    for (let index = 0; index < missingParticipantCount; index += 1) {
      const rank = currentParticipantCount + index + 1;
      const participant = await prisma.participant.create({
        data: {
          sportId,
          name: `Template Golfer ${rank}`,
          participantType: 'INDIVIDUAL',
          status: 'ACTIVE',
        },
      });
      const eventParticipant = await prisma.sportEventParticipant.create({
        data: {
          sportEventId,
          participantId: participant.id,
          isActive: true,
        },
      });
      void eventParticipant;
    }
  }

  beforeAll(async () => {
    const eventTiming = buildContestEligibleEventTiming();
    entryLocksAt = eventTiming.entryLocksAt.toISOString();
    const owner = await createTestUser({
      displayName: 'Contest Management Owner',
    });
    ownerHeaders = owner.headers;

    const leagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: ownerHeaders,
      payload: buildCreateLeaguePayload('Contest Management League'),
    });

    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;

    const prisma = getPrisma();
    const sport = await prisma.sport.create({
      data: {
        name: `Contest Management Golf ${randomUUID().slice(0, 8)}`,
        participantType: 'INDIVIDUAL',
      },
    });
    sportId = sport.id;

    const topParticipant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'Top Golfer',
        participantType: 'INDIVIDUAL',
        status: 'ACTIVE',
      },
    });
    topParticipantId = topParticipant.id;

    const secondParticipant = await prisma.participant.create({
      data: {
        sportId: sport.id,
        name: 'Second Golfer',
        participantType: 'INDIVIDUAL',
        status: 'ACTIVE',
      },
    });
    secondParticipantId = secondParticipant.id;

    const sportEvent = await prisma.sportEvent.create({
      data: {
        externalId: `masters-2026-${randomUUID().slice(0, 8)}`,
        providerId: 'PGA',
        sport: Sport.GOLF,
        name: 'Masters Tournament 2026',
        startDate: eventTiming.startDate,
        releaseAt: eventTiming.releaseAt,
        fieldLocksAt: eventTiming.fieldLocksAt,
        status: 'SCHEDULED',
      },
    });
    sportEventId = sportEvent.id;

    const topEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId,
        participantId: topParticipantId,
        isActive: true,
        worldRanking: 1,
        oddsToWin: 8.5,
      },
    });
    const secondEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId,
        participantId: secondParticipantId,
        isActive: true,
        worldRanking: 8,
        oddsToWin: 18.5,
      },
    });

    // Tiers/price are event-owned now (plans/124 §4.5/§4.6b) — the draft
    // room resolves selectionGroups through golf-tier-service, not a
    // contest-supplied tiers array, so the fixture needs a real
    // SportEventGolfTier + valuation row per golfer.
    const tier = await prisma.sportEventGolfTier.create({
      data: {
        sportEventId,
        tierKey: 'A',
        label: 'Tier A',
        tierNumber: 1,
        defaultPickCount: 6,
      },
    });
    await prisma.sportEventParticipantGolfValuation.create({
      data: {
        sportEventParticipantId: topEventParticipant.id,
        sportEventGolfTierId: tier.id,
        tierOrderIndex: 1,
        tierAssignedSource: 'MANUAL',
      },
    });
    await prisma.sportEventParticipantGolfValuation.create({
      data: {
        sportEventParticipantId: secondEventParticipant.id,
        sportEventGolfTierId: tier.id,
        tierOrderIndex: 2,
        tierAssignedSource: 'MANUAL',
      },
    });
  });

  it('pool-master-rop.68.1.3: creates, reads, and updates golf-first contest management configuration', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Pick 6',
        sportEventId,
        contestFormat: 'ROSTER',
        configuration: {
          mode: 'GOLF_TIERED',
          locksAt: entryLocksAt,
          maxEntriesPerSquad: 3,
          rosterSize: 6,
          countedScores: 4,
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest;
    contestId = createdContest.id;
    expect(createdContest.status).toBe(ContestStatus.OPEN);
    expect(createdContest.sportEventId).toBe(sportEventId);
    expect(createdContest.configuration.mode).toBe('GOLF_TIERED');
    expect(createdContest.configuration.countedScores).toBe(4);

    const createdConfiguration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
    });
    // Tiers are event-owned now (plans/124 §4.6) — a GOLF_TIERED contest no
    // longer persists its own tierConfig snapshot; golf-tier-service is the
    // one path to a contest's effective tiers.
    expect(createdConfiguration.tierConfig).toBeNull();

    const getRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.contestManagement.detail(leagueId, contestId),
      headers: ownerHeaders,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().contest.id).toBe(contestId);
    expect(getRes.json().contest.configuration.rosterSize).toBe(6);
    expect(getRes.json().contest.configuration.countedScores).toBe(4);

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect([200, 201]).toContain(entryRes.statusCode);
    const entryId = entryRes.json().entry.id;

    const draftStateRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/drafts/${contestId}?entryId=${entryId}`,
      headers: ownerHeaders,
    });
    expect(draftStateRes.statusCode).toBe(200);
    expect(draftStateRes.json().selectionGroups[0].participants).toEqual([
      expect.objectContaining({
        participantId: topParticipantId,
        orderIndex: 1,
        ranking: 1,
      }),
      expect.objectContaining({
        participantId: secondParticipantId,
        orderIndex: 2,
        ranking: 8,
      }),
    ]);

    // GOLF_TIERED is the only managed configuration mode (plans/124 §4.11
    // removed the GOLF_CATEGORY_PICKS stub); the update path is exercised by
    // re-submitting the tiered shape with changed roster values.
    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        mode: 'GOLF_TIERED',
        locksAt: entryLocksAt,
        maxEntriesPerSquad: null,
        rosterSize: 6,
        countedScores: 5,
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedContest = updateRes.json().contest;
    expect(updatedContest.configuration.mode).toBe('GOLF_TIERED');
    expect(updatedContest.configuration.rosterSize).toBe(6);
    expect(updatedContest.configuration.countedScores).toBe(5);
    expect(updatedContest.configuration.maxEntriesPerSquad).toBeNull();

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
      include: {
        participantScoringRules: true,
        entryAggregationRule: true,
      },
    });

    expect(configuration.configMode).toBe('GOLF_TIERED');
    expect(configuration.entryAggregationRule?.aggregationDefinitionId).toBe(
      'SUM_ALL_ENTRIES',
    );
    expect(configuration.participantScoringRules).toHaveLength(1);
  });

  it('lists seeded templates and creates a contest from a selected template', async () => {
    // pool-master-9y6: default tiered templates require a contest-ready field.
    await addContestReadyGolfField(80);

    const templateRes = await getApp().inject({
      method: 'GET',
      url: `${API_ROUTES.contestManagement.templates(leagueId)}?sport=GOLF&contestFormat=ROSTER`,
      headers: ownerHeaders,
    });

    expect(templateRes.statusCode).toBe(200);
    const templates = templateRes.json().templates;
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].configuration.mode).toBeTruthy();

    const defaultTemplate = templates.find(
      (template: { isDefault: boolean }) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Template Contest',
        sportEventId,
        contestFormat: 'ROSTER',
        templateId: defaultTemplate.id,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest;
    expect(createdContest.status).toBe(ContestStatus.OPEN);
    expect(createdContest.templateId).toBe(defaultTemplate.id);
    expect(createdContest.templateVersion).toBe(1);
    expect(createdContest.configuration.mode).toBe(defaultTemplate.configuration.mode);

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId: createdContest.id },
    });
    expect(configuration.templateId).toBe(defaultTemplate.id);
    expect(configuration.templateVersion).toBe(1);
  });

  it('rejects unsupported legacy contest-management payloads', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contestManagement(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Invalid Masters Pick 6',
        sportEventId,
        contestFormat: 'ROSTER',
        configuration: {
          selectionType: 'BUDGET_PICK',
        },
      },
    });

    expect(createRes.statusCode).toBe(400);
    const body = createRes.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });
});

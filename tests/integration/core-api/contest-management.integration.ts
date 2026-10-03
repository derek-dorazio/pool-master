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
import { freshEventEdition } from '../../support/event-edition';

// No api-routes manifest entry for the new template list (the manifest is not extended without
// approval); the literal is the published path.
const CONTEST_CONFIG_TEMPLATES_URL = '/api/v1/contest-config-templates/';

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
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
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
        ...(await freshEventEdition(prisma)),
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
        ranking: 1,
        oddsToWin: 8.5,
      },
    });
    const secondEventParticipant = await prisma.sportEventParticipant.create({
      data: {
        sportEventId,
        participantId: secondParticipantId,
        isActive: true,
        ranking: 8,
        oddsToWin: 18.5,
      },
    });

    // Tiers/price are event-owned now (plans/124 §4.5/§4.6b) — the draft
    // room resolves selectionGroups through SportEventTierService, not a
    // contest-supplied tiers array, so the fixture needs a real
    // SportEventTier + valuation row per golfer.
    const tier = await prisma.sportEventTier.create({
      data: {
        sportEventId,
        tierKey: 'A',
        label: 'Tier A',
        tierNumber: 1,
        defaultPickCount: 6,
      },
    });
    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: topEventParticipant.id,
        sportEventTierId: tier.id,
        tierOrderIndex: 1,
        tierAssignedSource: 'MANUAL',
      },
    });
    await prisma.sportEventParticipantValuation.create({
      data: {
        sportEventParticipantId: secondEventParticipant.id,
        sportEventTierId: tier.id,
        tierOrderIndex: 2,
        tierAssignedSource: 'MANUAL',
      },
    });
  });

  it('pool-master-rop.68.1.3: creates, reads, and updates golf-first contest management configuration', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Pick 6',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
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
    // #245 — create answers with the canonical contest read, as every contest route does.
    expect(createRes.json().contestConfiguration.countedScores).toBe(4);

    const createdConfiguration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
    });
    // Tiers are event-owned now (plans/124 §4.6) — a tiered contest no
    // longer persists its own tierConfig snapshot; SportEventTierService is the
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

    // The update path is exercised by re-submitting the tiered shape with
    // changed roster values.
    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        locksAt: entryLocksAt,
        maxEntriesPerSquad: null,
        rosterSize: 6,
        countedScores: 5,
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedContest = updateRes.json().contest;
    expect(updatedContest.configuration.rosterSize).toBe(6);
    expect(updatedContest.configuration.countedScores).toBe(5);
    expect(updatedContest.configuration.maxEntriesPerSquad).toBeNull();

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
      include: {
        participantScoringRules: true,
      },
    });

    expect(configuration.participantScoringRules).toHaveLength(1);

    // #246 — settled: the configuration is frozen with the result, 409 with its own code.
    await getPrisma().contest.update({ where: { id: contestId }, data: { status: ContestStatus.COMPLETED } });
    const settledUpdateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        locksAt: entryLocksAt,
        maxEntriesPerSquad: null,
        rosterSize: 6,
        countedScores: 4,
      },
    });
    expect(settledUpdateRes.statusCode).toBe(409);
    expect(ErrorEnvelopeSchema.safeParse(settledUpdateRes.json()).success).toBe(true);
    expect(settledUpdateRes.json().error.code).toBe('CONTEST_CONFIGURATION_SETTLED');
    await expect(getPrisma().contestConfiguration.findUniqueOrThrow({ where: { contestId } }))
      .resolves.toMatchObject({ configJson: expect.objectContaining({ countedScores: 5 }) });
  });

  it('lists seeded templates and creates a contest from a selected template', async () => {
    // pool-master-9y6: default tiered templates require a contest-ready field.
    await addContestReadyGolfField(80);

    const templateRes = await getApp().inject({
      method: 'GET',
      url: `${CONTEST_CONFIG_TEMPLATES_URL}?sport=GOLF&contestFormat=ROSTER&active=true`,
      headers: ownerHeaders,
    });

    expect(templateRes.statusCode).toBe(200);
    const templates = templateRes.json().templates;
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].selectionType).toBe('TIERED');

    const defaultTemplate = templates.find(
      (template: { isDefault: boolean }) => template.isDefault,
    );
    expect(defaultTemplate).toBeDefined();

    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Template Contest',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateId: defaultTemplate.id,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json().contest;
    expect(createdContest.status).toBe(ContestStatus.OPEN);
    expect(createRes.json().contestConfiguration.rosterSize).toBe(
      defaultTemplate.configuration.rosterSize,
    );

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId: createdContest.id },
    });
    expect(configuration.templateId).toBe(defaultTemplate.id);
    expect(configuration.templateVersion).toBe(1);
  });

  it('rejects unsupported legacy contest-management payloads', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Invalid Masters Pick 6',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        configuration: {
          selectionType: 'BUDGET_PICK',
        },
      },
    });

    expect(createRes.statusCode).toBe(400);
    const body = createRes.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });
  // #245 — the empty state is a documented 400, not a generic validation failure.
  it('refuses a create naming neither a template nor a configuration with CONTEST_CONFIGURATION_REQUIRED', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Empty Create',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
      },
    });

    expect(createRes.statusCode).toBe(400);
    const body = createRes.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('CONTEST_CONFIGURATION_REQUIRED');
  });

  // #245 — a selection type with no typed configuration yet is refused at the schema.
  it('refuses a selection type other than TIERED', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Budget Create',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'BUDGET_PICK',
        configuration: { rosterSize: 6, countedScores: 4 },
      },
    });

    expect(createRes.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(createRes.json()).success).toBe(true);
  });

  // #245 — template plus configuration: the template is provenance, the configuration is whole.
  it('creates from a template with a supplied configuration replacing the template configuration', async () => {
    await addContestReadyGolfField(80);
    const templatesRes = await getApp().inject({
      method: 'GET',
      url: `${CONTEST_CONFIG_TEMPLATES_URL}?sport=GOLF&contestFormat=ROSTER&active=true`,
      headers: ownerHeaders,
    });
    const defaultTemplate = templatesRes.json().templates.find(
      (template: { isDefault: boolean }) => template.isDefault,
    );

    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Masters Template Override',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateId: defaultTemplate.id,
        configuration: {
          locksAt: entryLocksAt,
          rosterSize: 6,
          countedScores: 3,
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId: createRes.json().contest.id },
    });
    expect(configuration.templateId).toBe(defaultTemplate.id);
    expect(configuration.configJson).toEqual({
      locksAt: entryLocksAt,
      rosterSize: 6,
      countedScores: 3,
    });
  });

  // #245 / A11 — templates are a global object: any authenticated caller reads them, no league
  // membership involved; an anonymous caller does not.
  it('lists templates for any authenticated caller and refuses anonymous callers', async () => {
    const outsider = await createTestUser({ displayName: 'Template Reader' });
    const readRes = await getApp().inject({
      method: 'GET',
      url: CONTEST_CONFIG_TEMPLATES_URL,
      headers: outsider.headers,
    });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().templates.length).toBeGreaterThan(0);

    const anonymousRes = await getApp().inject({
      method: 'GET',
      url: CONTEST_CONFIG_TEMPLATES_URL,
    });
    expect(anonymousRes.statusCode).toBe(401);
  });
});

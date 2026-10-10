import { expect } from '@jest/globals';
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
import { ContestManagementResponseSchema } from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateListResponse,
  ContestEntryResponse,
  ContestListResponse,
  ContestManagementResponse,
  ContestResponse,
  SelectionStateResponse,
  ErrorEnvelope,
  LeagueContextResponse,
} from '@poolmaster/shared/dto';
import { ContestStatus, Sport, SelectionType} from '@poolmaster/shared/domain';
import { randomUUID } from 'node:crypto';
import { freshEventEdition } from '../../support/event-edition';

// No api-routes manifest entry for the new template list (the manifest is not extended without
// approval); the literal is the published path.
const CONTEST_CONFIG_TEMPLATES_URL = '/api/v1/contest-config-templates/';

// openContest (#117) — the api-routes manifest is not extended without approval either.
function openContestUrl(leagueId: string, contestId: string): string {
  return `${API_ROUTES.contestManagement.detail(leagueId, contestId)}/open`;
}

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
    leagueId = leagueRes.json<LeagueContextResponse>().league.id;

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
    // SportEventTier + valuation row per golfer. Six tiers, so a contest picking one golfer
    // per tier has a roster of 6 (#479: the roster is the event's tier count × picksPerTier).
    const tier = await prisma.sportEventTier.create({
      data: {
        sportEventId,
        tierKey: 'A',
        label: 'Tier A',
        tierNumber: 1,
      },
    });
    for (const [index, tierKey] of ['B', 'C', 'D', 'E', 'F'].entries()) {
      await prisma.sportEventTier.create({
        data: { sportEventId, tierKey, label: `Tier ${tierKey}`, tierNumber: index + 2 },
      });
    }
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

  it('creates a contest as a draft that takes edits but no entries, then opens it so entries work and the configuration locks', async () => {
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
          maxEntriesPerSquad: 3,
          selectionType: SelectionType.TIERED,
          picksPerTier: 1,
          countedScores: 4,
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdContest = createRes.json<ContestResponse>().contest;
    contestId = createdContest.id;
    expect(createdContest.status).toBe(ContestStatus.DRAFT);
    expect(createdContest.sportEventId).toBe(sportEventId);
    // #245 — create answers with the canonical contest read, as every contest route does.
    expect(createRes.json<ContestResponse>().contestConfiguration?.countedScores).toBe(4);

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
    const managedContest = getRes.json<ContestManagementResponse>().contest;
    expect(managedContest.id).toBe(contestId);
    expect(managedContest.configuration).toMatchObject({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 });

    // #117 — a draft takes no entries, not even its commissioner's.
    const draftEntryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect(draftEntryRes.statusCode).toBe(400);
    expect(draftEntryRes.json<ErrorEnvelope>().error.code).toBe('CONTEST_ENTRY_LOCKED');

    // A draft's configuration takes an edit.
    const updateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        maxEntriesPerSquad: null,
        selectionType: SelectionType.TIERED,
        picksPerTier: 1,
        countedScores: 5,
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updatedContest = updateRes.json<ContestManagementResponse>().contest;
    expect(updatedContest.configuration).toMatchObject({ selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 5 });
    expect(updatedContest.configuration.maxEntriesPerSquad).toBeNull();

    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId },
      include: {
        participantScoringRules: true,
      },
    });

    expect(configuration.participantScoringRules).toHaveLength(1);

    const openRes = await getApp().inject({
      method: 'POST',
      url: openContestUrl(leagueId, contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect(openRes.statusCode).toBe(200);
    expect(openRes.json<ContestManagementResponse>().contest.status).toBe(ContestStatus.OPEN);

    const entryRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.contests.myEntry(contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect([200, 201]).toContain(entryRes.statusCode);
    const entryId = entryRes.json<ContestEntryResponse>().entry.id;

    const selectionStateRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/selections/${contestId}?entryId=${entryId}`,
      headers: ownerHeaders,
    });
    expect(selectionStateRes.statusCode).toBe(200);
    expect(selectionStateRes.json<SelectionStateResponse>().selectionGroups?.[0].participants).toEqual([
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

    // #117 — open: members enter against these rules, so they are locked, 409 with its own code.
    const lockedUpdateRes = await getApp().inject({
      method: 'PUT',
      url: API_ROUTES.contestManagement.configuration(leagueId, contestId),
      headers: ownerHeaders,
      payload: {
        maxEntriesPerSquad: null,
        selectionType: SelectionType.TIERED,
        picksPerTier: 1,
        countedScores: 4,
      },
    });
    expect(lockedUpdateRes.statusCode).toBe(409);
    expect(ErrorEnvelopeSchema.safeParse(lockedUpdateRes.json()).success).toBe(true);
    expect(lockedUpdateRes.json<ErrorEnvelope>().error.code).toBe('CONTEST_CONFIGURATION_LOCKED');
    await expect(getPrisma().contestConfiguration.findUniqueOrThrow({ where: { contestId } }))
      .resolves.toMatchObject({ configJson: expect.objectContaining({ countedScores: 5 }) });

    // No undo: a second press is refused rather than repeated.
    const reopenRes = await getApp().inject({
      method: 'POST',
      url: openContestUrl(leagueId, contestId),
      headers: withoutJsonBodyHeaders(ownerHeaders),
    });
    expect(reopenRes.statusCode).toBe(409);
    expect(reopenRes.json<ErrorEnvelope>().error.code).toBe('CONTEST_NOT_DRAFT');
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
    const templates = templateRes.json<ContestConfigTemplateListResponse>().templates;
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0].selectionType).toBe('TIERED');

    const defaultTemplate = templates.find(
      (template) => template.isDefault,
    );
    if (!defaultTemplate) throw new Error('No default contest template is seeded');

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
    const createdContest = createRes.json<ContestResponse>().contest;
    expect(createdContest.status).toBe(ContestStatus.DRAFT);
    expect(defaultTemplate.configuration.selectionType).toBe(SelectionType.TIERED);
    expect(createRes.json<ContestResponse>().contestConfiguration?.picksPerTier).toBe(
      defaultTemplate.configuration.selectionType === SelectionType.TIERED ? defaultTemplate.configuration.picksPerTier : undefined,
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
    const body = createRes.json<unknown>();
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
    const body = createRes.json<ErrorEnvelope>();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('CONTEST_CONFIGURATION_REQUIRED');
  });

  // #245 — a selection type with no typed configuration yet is refused at the schema.
  it('refuses a selection type other than TIERED or BUDGET_PICK with 400', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Pick Em Create',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'PICK_EM',
        configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      },
    });

    expect(createRes.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(createRes.json()).success).toBe(true);
  });

  it('refuses a budget contest whose rules are tiered with 422 CONTEST_RULES_SELECTION_TYPE_MISMATCH', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Budget Create',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'BUDGET_PICK',
        configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      },
    });

    expect(createRes.statusCode).toBe(422);
    expect(createRes.json<ErrorEnvelope>().error.code).toBe('CONTEST_RULES_SELECTION_TYPE_MISMATCH');
  });

  it('refuses a budget contest on an event with no prices with 409 CONTEST_EVENT_NOT_PRICED', async () => {
    const createRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.contests(leagueId),
      headers: ownerHeaders,
      payload: {
        name: 'Unpriced Budget Create',
        sportEventId,
        contestFormat: 'ROSTER',
        selectionType: 'BUDGET_PICK',
        configuration: { selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4 },
      },
    });

    expect(createRes.statusCode).toBe(409);
    expect(createRes.json<ErrorEnvelope>().error.code).toBe('CONTEST_EVENT_NOT_PRICED');
  });

  // #245 — template plus configuration: the template is provenance, the configuration is whole.
  it('creates from a template with a supplied configuration replacing the template configuration', async () => {
    await addContestReadyGolfField(80);
    const templatesRes = await getApp().inject({
      method: 'GET',
      url: `${CONTEST_CONFIG_TEMPLATES_URL}?sport=GOLF&contestFormat=ROSTER&active=true`,
      headers: ownerHeaders,
    });
    const defaultTemplate = templatesRes.json<ContestConfigTemplateListResponse>().templates.find(
      (template) => template.isDefault,
    );
    if (!defaultTemplate) throw new Error('No default contest template is seeded');

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
          selectionType: SelectionType.TIERED,
          picksPerTier: 1,
          countedScores: 3,
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const configuration = await getPrisma().contestConfiguration.findUniqueOrThrow({
      where: { contestId: createRes.json<ContestResponse>().contest.id },
    });
    expect(configuration.templateId).toBe(defaultTemplate.id);
    expect(configuration.configJson).toEqual({
      selectionType: SelectionType.TIERED,
      picksPerTier: 1,
      countedScores: 3,
    });
  });

  describe('a draft contest is the commissioner\'s alone until it is opened (#117)', () => {
    let memberHeaders: Record<string, string>;

    async function createDraft(name: string): Promise<string> {
      const createRes = await getApp().inject({
        method: 'POST',
        url: API_ROUTES.leagues.contests(leagueId),
        headers: ownerHeaders,
        payload: {
          name,
          sportEventId,
          contestFormat: 'ROSTER',
          selectionType: 'TIERED',
          configuration: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
        },
      });
      expect(createRes.statusCode).toBe(201);
      return createRes.json<ContestResponse>().contest.id;
    }

    beforeAll(async () => {
      const member = await createTestUser({ displayName: 'Contest Management Member' });
      memberHeaders = member.headers;
      await getPrisma().leagueMembership.create({
        data: {
          leagueId,
          userId: member.user.id,
          role: 'MEMBER',
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    });

    it('hides a draft from a member\'s contest list and answers its detail read 404, while the commissioner sees both', async () => {
      const draftId = await createDraft('Hidden Draft');

      const memberList = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.leagues.contests(leagueId),
        headers: memberHeaders,
      });
      expect(memberList.statusCode).toBe(200);
      expect(memberList.json<ContestListResponse>().contests.map((contest) => contest.id))
        .not.toContain(draftId);

      const memberDetail = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(draftId),
        headers: memberHeaders,
      });
      expect(memberDetail.statusCode).toBe(404);
      expect(memberDetail.json<ErrorEnvelope>().error.code).toBe('CONTEST_NOT_FOUND');

      const ownerList = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.leagues.contests(leagueId),
        headers: ownerHeaders,
      });
      expect(ownerList.json<ContestListResponse>().contests.map((contest) => contest.id))
        .toContain(draftId);
      const ownerDetail = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(draftId),
        headers: ownerHeaders,
      });
      expect(ownerDetail.statusCode).toBe(200);
    });

    it('refuses a member opening a draft with 403 and leaves it a draft; once the commissioner opens it, the member sees it', async () => {
      const draftId = await createDraft('Member Cannot Open');

      const memberOpen = await getApp().inject({
        method: 'POST',
        url: openContestUrl(leagueId, draftId),
        headers: withoutJsonBodyHeaders(memberHeaders),
      });
      expect(memberOpen.statusCode).toBe(403);
      await expect(getPrisma().contest.findUniqueOrThrow({ where: { id: draftId } }))
        .resolves.toMatchObject({ status: ContestStatus.DRAFT });

      const ownerOpen = await getApp().inject({
        method: 'POST',
        url: openContestUrl(leagueId, draftId),
        headers: withoutJsonBodyHeaders(ownerHeaders),
      });
      expect(ownerOpen.statusCode).toBe(200);
      expect(ContestManagementResponseSchema.safeParse(ownerOpen.json()).success).toBe(true);

      const memberDetail = await getApp().inject({
        method: 'GET',
        url: API_ROUTES.contests.detail(draftId),
        headers: memberHeaders,
      });
      expect(memberDetail.statusCode).toBe(200);
      expect(memberDetail.json<ContestResponse>().contest.status).toBe(ContestStatus.OPEN);
    });

    it('refuses opening a draft whose event start time has passed with 409 CONTEST_EVENT_ALREADY_STARTED, and it stays a draft', async () => {
      const draftId = await createDraft('Too Late Draft');
      const prisma = getPrisma();
      const { startDate } = await prisma.sportEvent.findUniqueOrThrow({ where: { id: sportEventId } });
      await prisma.sportEvent.update({
        where: { id: sportEventId },
        data: { startDate: new Date(Date.now() - 60 * 1000) },
      });
      try {
        const openRes = await getApp().inject({
          method: 'POST',
          url: openContestUrl(leagueId, draftId),
          headers: withoutJsonBodyHeaders(ownerHeaders),
        });
        expect(openRes.statusCode).toBe(409);
        expect(openRes.json<ErrorEnvelope>().error.code).toBe('CONTEST_EVENT_ALREADY_STARTED');
        await expect(prisma.contest.findUniqueOrThrow({ where: { id: draftId } }))
          .resolves.toMatchObject({ status: ContestStatus.DRAFT });
      } finally {
        await prisma.sportEvent.update({ where: { id: sportEventId }, data: { startDate } });
      }
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
    expect(readRes.json<ContestConfigTemplateListResponse>().templates.length).toBeGreaterThan(0);

    const anonymousRes = await getApp().inject({
      method: 'GET',
      url: CONTEST_CONFIG_TEMPLATES_URL,
    });
    expect(anonymousRes.statusCode).toBe(401);
  });
});

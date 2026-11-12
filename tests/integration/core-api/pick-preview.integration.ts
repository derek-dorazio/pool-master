/**
 * #1612 — the member pick screen for a contest setup before it is saved. Both preview routes
 * answer their published shape, are for the league's commissioners, write nothing, and cost the
 * same SQL statements for a field (or a week) of 2 as of 20.
 */
import { PickEmMode, PredictedResult, SelectionType, SportEventStatus } from '@poolmaster/shared/domain';
import { GamePickPreviewResponseSchema, RosterPickPreviewResponseSchema } from '@poolmaster/shared/dto';
import { expectDefined } from '../../support/expect-defined';
import { cleanupTestData, createTestUser, getApp, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, okBody, seedEventWithField, seedFootballWeek, seedLeagueWithTeams, seedTiers } from '../list-route-seeds';
import { expectSameStatementCount } from '../query-scaling';

// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

type Viewer = Awaited<ReturnType<typeof seedLeagueWithTeams>>['commissioner'];

const TIERED = { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 2 } as const;
const BUDGET = { selectionType: SelectionType.BUDGET_PICK, rosterSize: 2, countedScores: 2 } as const;
const CONFIDENCE = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, againstTheSpread: false } as const;

function preview(kind: 'roster' | 'games', leagueId: string, viewer: Viewer, payload: object) {
  return getApp().inject({ method: 'POST', url: `/api/v1/leagues/${leagueId}/pick-preview/${kind}`, headers: viewer.headers, payload });
}

/** A golf event of `golfers` golfers in two tiers, each priced, its field priced against a $50,000 cap. */
async function pricedGolfEvent(golfers: number) {
  const { event, field } = await seedEventWithField(golfers);
  await seedTiers(event.id, field, 2);
  const prisma = getPrisma();
  await prisma.sportEvent.update({
    where: { id: event.id },
    data: { pricingConfig: { profileName: 'Standard', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 } },
  });
  await Promise.all(field.map((row, index) => prisma.sportEventParticipantValuation.update({
    where: { sportEventParticipantId: row.id },
    data: { price: 12_000 - index * 100 },
  })));
  return { event, field };
}

/** How many contests, entries and picks of either kind there are: a preview leaves them as they were. */
async function storedRows() {
  const prisma = getPrisma();
  return Promise.all([prisma.contest.count(), prisma.contestEntry.count(), prisma.contestEntryPick.count(), prisma.contestEntryMatchPrediction.count()]);
}

describe('POST /leagues/:id/pick-preview/roster', () => {
  it('answers RosterPickPreviewResponse for a tiered setup, with the trial picks marked and nothing stored', async () => {
    const { commissioner, league } = await seedLeagueWithTeams(1);
    const { event, field } = await pricedGolfEvent(4);
    const before = await storedRows();

    const response = await preview('roster', league.id, commissioner, {
      sportEventId: event.id,
      rules: TIERED,
      sportEventParticipantIds: [expectDefined(field[0]).id, expectDefined(field[1]).id],
    });
    expect(response.statusCode).toBe(200);
    const parsed = RosterPickPreviewResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    const body = expectDefined(parsed.data);

    expect(body).toMatchObject({ selectionType: SelectionType.TIERED, rosterSize: 2, pickCount: 2, isComplete: true, lineupSummary: null });
    expect(body.selectionGroups).toHaveLength(2);
    expect(await storedRows()).toEqual(before);
  });

  it('answers a budget setup\'s spend against the event\'s salary cap', async () => {
    const { commissioner, league } = await seedLeagueWithTeams(1);
    const { event, field } = await pricedGolfEvent(4);

    const body = okBody(await preview('roster', league.id, commissioner, {
      sportEventId: event.id,
      rules: BUDGET,
      sportEventParticipantIds: [expectDefined(field[0]).id],
    }), RosterPickPreviewResponseSchema);

    expect(body.lineupSummary).toMatchObject({ salaryCap: 50_000, spent: 12_000, openSlots: 1 });
    expect(body.isComplete).toBe(false);
  });

  it('refuses a league member who is not its commissioner with 403', async () => {
    const { league } = await seedLeagueWithTeams(1);
    const { event } = await pricedGolfEvent(2);
    const member = await createTestUser({ displayName: 'Preview Member' });
    await getPrisma().leagueMembership.create({ data: { leagueId: league.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE' } });

    const response = await preview('roster', league.id, member, { sportEventId: event.id, rules: TIERED, sportEventParticipantIds: [] });

    expect(response.statusCode).toBe(403);
  });

  it('costs the same statements for a field of 2 as of 20, every golfer tapped', async () => {
    await expectSameStatementCount({
      seed: async (golfers) => ({ ...(await seedLeagueWithTeams(0)), ...(await pricedGolfEvent(golfers)) }),
      call: async ({ commissioner, league, event, field }) => okBody(await preview('roster', league.id, commissioner, {
        sportEventId: event.id,
        rules: BUDGET,
        sportEventParticipantIds: field.map((row) => row.id),
      }), RosterPickPreviewResponseSchema),
      rowsShown: (body) => body.pickCount,
    });
  });
});

describe('POST /leagues/:id/pick-preview/games', () => {
  it('answers GamePickPreviewResponse for a pick\'em setup, with the trial pick on its game and nothing stored', async () => {
    const { commissioner, league } = await seedLeagueWithTeams(1);
    const { event, games } = await seedFootballWeek({ games: 2, startDate: new Date(Date.now() + 7 * DAY), status: SportEventStatus.SCHEDULED });
    const first = expectDefined(games[0]);
    const before = await storedRows();

    const response = await preview('games', league.id, commissioner, {
      sportEventId: event.id,
      rules: CONFIDENCE,
      picks: [{ sportEventMatchId: first.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: first.awaySportEventParticipantId, confidence: 2 }],
    });
    expect(response.statusCode).toBe(200);
    const parsed = GamePickPreviewResponseSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    const body = expectDefined(parsed.data);

    expect(body).toMatchObject({ selectionType: SelectionType.PICK_EM, mode: PickEmMode.CONFIDENCE, gameCount: 2, pickedCount: 1 });
    expect(body.games[0]?.pick).toEqual({ predictedResult: PredictedResult.TEAM, sportEventParticipantId: first.awaySportEventParticipantId, confidence: 2 });
    expect(body.games.every((game) => !game.locked)).toBe(true);
    expect(await storedRows()).toEqual(before);
  });

  it('refuses a league member who is not its commissioner a game setup\'s preview with 403', async () => {
    const { league } = await seedLeagueWithTeams(1);
    const { event } = await seedFootballWeek({ games: 2, startDate: new Date(Date.now() + 7 * DAY), status: SportEventStatus.SCHEDULED });
    const member = await createTestUser({ displayName: 'Games Preview Member' });
    await getPrisma().leagueMembership.create({ data: { leagueId: league.id, userId: member.user.id, role: 'MEMBER', status: 'ACTIVE' } });

    const response = await preview('games', league.id, member, { sportEventId: event.id, rules: CONFIDENCE, picks: [] });

    expect(response.statusCode).toBe(403);
  });

  it('costs the same statements for a week of 2 games as of 20, every game picked', async () => {
    await expectSameStatementCount({
      seed: async (games) => ({
        ...(await seedLeagueWithTeams(0)),
        ...(await seedFootballWeek({ games, startDate: new Date(Date.now() + 7 * DAY), status: SportEventStatus.SCHEDULED })),
      }),
      call: async ({ commissioner, league, event, games }) => okBody(await preview('games', league.id, commissioner, {
        sportEventId: event.id,
        rules: CONFIDENCE,
        picks: games.map((game) => ({ sportEventMatchId: game.id, predictedResult: PredictedResult.TEAM, sportEventParticipantId: game.homeSportEventParticipantId, confidence: null })),
      }), GamePickPreviewResponseSchema),
      rowsShown: (body) => body.pickedCount,
    });
  });
});

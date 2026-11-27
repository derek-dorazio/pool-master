/**
 * The competition level's migration (#2153) against the migrated reference data in real Postgres:
 * every phase got one competition and every Season phase its Season competition, every slot
 * definition and Season slot moved under one, and NCAA Men's Football's postseason became the CFP
 * with its four rounds, their windows and window statuses kept. No mocks.
 */
import { expect } from '@jest/globals';
import { LeaguePhase, SeasonCompetitionStatus } from '@poolmaster/shared/domain';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(() => teardownIntegrationTests());

/** NCAA Men's Football's and the NFL's reference rows, seeded by migration. */
const NCAA_FOOTBALL_ID = '37b259d2-b681-4ca5-94d4-894d5e9bcc10';
const NFL_ID = 'f91f2566-1978-4171-a706-ae417c4d601a';

describe('the league competitions migration', () => {
  it('gives every other league\'s seeded phase one competition at order 1, coded as the phase', async () => {
    const phases = await getPrisma().sportLeaguePhase.findMany({
      where: { sportLeagueId: { not: NCAA_FOOTBALL_ID } },
      select: { sportLeagueId: true, phase: true, competitions: { select: { code: true, orderIndex: true } } },
    });

    expect(phases.length).toBeGreaterThan(0);
    expect(phases.filter((phase) => phase.competitions.length !== 1)).toEqual([]);
    expect(phases.filter(({ phase, competitions: [competition] }) => competition.code !== phase || competition.orderIndex !== 1)).toEqual([]);
  });

  it('gives NCAA Men\'s Football\'s postseason the bowls and then the CFP, and its conference postseason the conference championships (#2154)', async () => {
    const phases = await getPrisma().sportLeaguePhase.findMany({
      where: { sportLeagueId: NCAA_FOOTBALL_ID },
      select: { phase: true, isSynced: true, competitions: { select: { code: true, orderIndex: true }, orderBy: { orderIndex: 'asc' } } },
      orderBy: { phase: 'asc' },
    });

    expect(phases).toEqual([
      { phase: LeaguePhase.REGULAR, isSynced: false, competitions: [{ code: 'REGULAR', orderIndex: 1 }] },
      { phase: LeaguePhase.POSTSEASON_CONFERENCE, isSynced: true, competitions: [{ code: 'CONFERENCE_CHAMPIONSHIPS', orderIndex: 1 }] },
      { phase: LeaguePhase.POSTSEASON, isSynced: true, competitions: [{ code: 'BOWLS', orderIndex: 1 }, { code: 'CFP', orderIndex: 2 }] },
    ]);
  });

  it('gives every Season phase a scheduled Season competition for each competition of its phase, with no champion', async () => {
    const seasonPhases = await getPrisma().sportLeagueSeasonPhase.findMany({
      select: {
        status: true, sportLeagueSeasonId: true,
        phase: { select: { competitions: { select: { id: true } } } },
      },
    });
    const seasonCompetitions = await getPrisma().sportLeagueSeasonCompetition.findMany({
      select: { sportLeagueSeasonId: true, sportLeagueCompetitionId: true, status: true, championParticipantId: true },
    });
    const held = new Set(seasonCompetitions.map((each) => `${each.sportLeagueSeasonId}:${each.sportLeagueCompetitionId}`));

    expect(seasonPhases.filter((each) => each.status !== SeasonCompetitionStatus.SCHEDULED)).toEqual([]);
    expect(seasonPhases.flatMap((each) => each.phase.competitions
      .filter((competition) => !held.has(`${each.sportLeagueSeasonId}:${competition.id}`)))).toEqual([]);
    expect(seasonCompetitions.filter((each) => each.status !== SeasonCompetitionStatus.SCHEDULED || each.championParticipantId !== null)).toEqual([]);
  });

  it('puts every Season slot in the Season competition of its own definition\'s competition, in its own Season', async () => {
    const slots = await getPrisma().sportLeagueSeasonCompetitionSlot.findMany({
      where: { isTestData: false },
      select: {
        sportLeagueSeasonId: true,
        definition: { select: { sportLeagueCompetitionId: true } },
        seasonCompetition: { select: { sportLeagueSeasonId: true, sportLeagueCompetitionId: true } },
      },
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter((slot) => slot.seasonCompetition.sportLeagueCompetitionId !== slot.definition.sportLeagueCompetitionId
      || slot.seasonCompetition.sportLeagueSeasonId !== slot.sportLeagueSeasonId)).toEqual([]);
  });

  it('keeps the NFL\'s slots where they were: 18 weeks in its regular season\'s competition and four rounds in its postseason\'s', async () => {
    const competitions = await getPrisma().sportLeagueCompetition.findMany({
      where: { sportLeagueId: NFL_ID },
      select: { code: true, _count: { select: { slots: true } } },
      orderBy: { code: 'asc' },
    });

    expect(competitions.map((each) => [each.code, each._count.slots])).toEqual([['POSTSEASON', 4], ['PRESEASON', 0], ['REGULAR', 18]]);
  });

  it('holds the College Football Playoff\'s four rounds in the CFP competition, each Season\'s with the date window and window status it had', async () => {
    const prisma = getPrisma();
    const cfp = await prisma.sportLeagueCompetition.findUniqueOrThrow({
      where: { sportLeagueId_code: { sportLeagueId: NCAA_FOOTBALL_ID, code: 'CFP' } },
      select: { phase: { select: { phase: true } }, slots: { select: { key: true }, orderBy: { key: 'asc' } } },
    });
    const seasonSlots = await prisma.sportLeagueSeasonCompetitionSlot.findMany({
      where: { sportLeagueId: NCAA_FOOTBALL_ID, isTestData: false, seasonCompetition: { competition: { code: 'CFP' } } },
      select: { windowStartsAt: true, windowEndsAt: true, windowStatus: true, season: { select: { championshipYear: true } }, definition: { select: { key: true } } },
    });

    expect(cfp.phase.phase).toBe(LeaguePhase.POSTSEASON);
    expect(cfp.slots.map((slot) => slot.key)).toEqual(['FINAL', 'QUARTERFINAL', 'ROUND_OF_16', 'SEMIFINAL']);
    // The 2026 Season's windows, set as data by 13 (#2012), came through the move unchanged.
    const of2026 = seasonSlots.filter((slot) => slot.season.championshipYear === 2026);
    expect([...of2026].sort((left, right) => left.definition.key.localeCompare(right.definition.key)).map((slot) => [slot.definition.key, slot.windowStatus])).toEqual([
      ['FINAL', 'CONFIRMED'], ['QUARTERFINAL', 'CONFIRMED'], ['ROUND_OF_16', 'TENTATIVE'], ['SEMIFINAL', 'CONFIRMED'],
    ]);
    expect(of2026.every((slot) => slot.windowStartsAt !== null && slot.windowEndsAt !== null)).toBe(true);
  });

  it('gives the bowls and the conference championships one squares-eligible single-game slot each, matched REST_OF_PHASE, in every Season, with tentative 2026 windows (#2154)', async () => {
    const prisma = getPrisma();
    const definitions = await prisma.sportLeagueCompetitionSlot.findMany({
      where: { sportLeagueId: NCAA_FOOTBALL_ID, key: { in: ['BOWLS', 'CONFERENCE_CHAMPIONSHIPS'] } },
      select: {
        key: true, slotKind: true, squaresEligible: true, seriesFormat: true, matchFormat: true,
        competition: { select: { code: true } },
        providerMappings: { select: { matchType: true, providerValue: true } },
        seasonSlots: { where: { isTestData: false }, select: { windowStatus: true, windowStartsAt: true, season: { select: { championshipYear: true } } } },
      },
      orderBy: { key: 'asc' },
    });

    expect(definitions.map(({ seasonSlots: _seasonSlots, ...definition }) => definition)).toEqual(['BOWLS', 'CONFERENCE_CHAMPIONSHIPS'].map((key) => ({
      key, slotKind: 'TOURNAMENT', squaresEligible: true, seriesFormat: 'SINGLE_GAME', matchFormat: 'HEAD_TO_HEAD',
      competition: { code: key }, providerMappings: [{ matchType: 'REST_OF_PHASE', providerValue: null }],
    })));
    for (const definition of definitions) {
      const byYear = new Map(definition.seasonSlots.map((slot) => [slot.season.championshipYear, slot]));
      expect([...byYear.keys()].sort((left, right) => left - right)).toEqual([2025, 2026, 2027]);
      expect(byYear.get(2026)?.windowStatus).toBe('TENTATIVE');
      expect(byYear.get(2027)?.windowStartsAt).toBeNull();
    }
  });
});

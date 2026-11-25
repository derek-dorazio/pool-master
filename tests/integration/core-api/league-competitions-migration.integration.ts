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
  it('gives every seeded phase one competition at order 1, coded as the phase but for NCAA Men\'s Football\'s postseason, the CFP', async () => {
    const phases = await getPrisma().sportLeaguePhase.findMany({
      select: { sportLeagueId: true, phase: true, competitions: { select: { code: true, orderIndex: true } } },
    });

    expect(phases.length).toBeGreaterThan(0);
    expect(phases.filter((phase) => phase.competitions.length !== 1)).toEqual([]);
    const unexpected = phases.filter(({ sportLeagueId, phase, competitions: [competition] }) => {
      const code = sportLeagueId === NCAA_FOOTBALL_ID && phase === LeaguePhase.POSTSEASON ? 'CFP' : phase;
      return competition.code !== code || competition.orderIndex !== 1;
    });
    expect(unexpected).toEqual([]);
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
    expect(of2026.map((slot) => [slot.definition.key, slot.windowStatus]).sort(([left], [right]) => left.localeCompare(right))).toEqual([
      ['FINAL', 'CONFIRMED'], ['QUARTERFINAL', 'CONFIRMED'], ['ROUND_OF_16', 'TENTATIVE'], ['SEMIFINAL', 'CONFIRMED'],
    ]);
    expect(of2026.every((slot) => slot.windowStartsAt !== null && slot.windowEndsAt !== null)).toBe(true);
  });
});

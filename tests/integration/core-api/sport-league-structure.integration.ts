/**
 * A sport league's phase, competition and slot definitions (#2002, #2153) against real Postgres:
 * the rows the migration seeds for every league, the database checks that keep a definition coherent, and the
 * League page's Structure read over HTTP. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { LeaguePhase, MatchFormat, PeriodUnit, SeriesFormat, SlotKind, SlotPairing, SlotProviderMatchType, Sport } from '@poolmaster/shared/domain';
import { SportLeagueStructureResponseSchema } from '@poolmaster/shared/dto';
import { cleanupTestData, createTestUser, getApp, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';
import { fixtureSeasonId, fixtureTourId } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** The NFL's reference row, seeded by the baseline migration. */
const NFL_ID = 'f91f2566-1978-4171-a706-ae417c4d601a';

async function get(url: string) {
  const rootAdmin = await createTestUser({ isRootAdmin: true });
  return getApp().inject({ method: 'GET', url, headers: rootAdmin.headers });
}

/** A made-up basketball league of this test's own, with no definitions. */
async function testLeague() {
  const prisma = getPrisma();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.BASKETBALL }, select: { id: true } });
  return prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.BASKETBALL), sportId: sport.id, name: `Structure League ${randomUUID().slice(0, 8)}` } });
}

const SLOT_DEFAULTS = {
  awardsTrophy: false, squaresEligible: false, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
  matchFormat: MatchFormat.HEAD_TO_HEAD, canEndTied: false, periodUnit: PeriodUnit.QUARTER, periodCount: 4,
} as const;

describe('the seeded phase and slot definitions', () => {
  it('give every sport league at least one phase, and no unsynced phase any slot', async () => {
    const prisma = getPrisma();
    const leagues = await prisma.sportLeague.findMany({
      select: { id: true, name: true, phases: { select: { isSynced: true, competitions: { select: { _count: { select: { slots: true } } } } } } },
    });
    const seeded = leagues.filter((league) => !league.name.startsWith('Structure League'));
    const slotCount = (phase: (typeof seeded)[number]['phases'][number]) => phase.competitions.reduce((count, competition) => count + competition._count.slots, 0);

    expect(seeded.filter((league) => league.phases.length === 0).map((league) => league.name)).toEqual([]);
    expect(seeded.flatMap((league) => league.phases.filter((phase) => phase.competitions.length === 0)).length).toBe(0);
    expect(seeded.flatMap((league) => league.phases.filter((phase) => !phase.isSynced && slotCount(phase) > 0)).length).toBe(0);
  });

  it('seed the NFL with an unsynced preseason, 18 weeks matched by provider code, and a reseeded postseason ending in the Super Bowl at provider code POST:5', async () => {
    const response = await get(`/api/v1/sport-leagues/${NFL_ID}/structure`);

    expect(response.statusCode).toBe(200);
    const { phases } = SportLeagueStructureResponseSchema.parse(response.json());
    expect(phases.map((phase) => [phase.phase, phase.isSynced, phase.competitions.map((competition) => [competition.code, competition.slots.length])])).toEqual([
      [LeaguePhase.PRESEASON, false, [['PRESEASON', 0]]],
      [LeaguePhase.REGULAR, true, [['REGULAR', 18]]],
      [LeaguePhase.POSTSEASON, true, [['POSTSEASON', 4]]],
    ]);
    const [regular, postseason] = [phases[1].competitions[0], phases[2].competitions[0]];
    expect(regular.slots[13]).toEqual(expect.objectContaining({
      key: 'WEEK_14', slotKind: SlotKind.WEEK, weekNumber: 14, name: null, squaresEligible: true,
      providerMappings: [expect.objectContaining({ providerName: 'BALLDONTLIE', providerLeagueCode: 'nfl', matchType: SlotProviderMatchType.PROVIDER_CODE, providerValue: 'REG:14' })],
    }));
    expect(postseason.slots.map((slot) => [slot.slotKind, slot.name, slot.pairing, slot.providerMappings[0]?.providerValue])).toEqual([
      [SlotKind.ROUND_OF_16, 'Wild Card', SlotPairing.RESEEDED, 'POST:1'],
      [SlotKind.QUARTERFINAL, 'Divisional', SlotPairing.RESEEDED, 'POST:2'],
      [SlotKind.SEMIFINAL, 'Conference Championships', SlotPairing.RESEEDED, 'POST:3'],
      [SlotKind.FINAL, 'Super Bowl', SlotPairing.RESEEDED, 'POST:5'], // the provider's own week for the Super Bowl, after its gap week (#2005)
    ]);
    expect(postseason.slots.at(-1)).toEqual(expect.objectContaining({ awardsTrophy: true, squaresEligible: true }));
  });

  it('seed the NBA\'s best-of-seven rounds as series a squares pool cannot be played on, and its weeks matched by calendar week', async () => {
    const nba = await getPrisma().sportLeague.findFirstOrThrow({ where: { id: '09f45f12-11be-43ac-bfa6-70a53f6e0169' }, select: { id: true } });

    const { phases } = SportLeagueStructureResponseSchema.parse((await get(`/api/v1/sport-leagues/${nba.id}/structure`)).json());

    const regular = phases.find((phase) => phase.phase === LeaguePhase.REGULAR)?.competitions[0];
    const final = phases.find((phase) => phase.phase === LeaguePhase.POSTSEASON)?.competitions[0]?.slots.at(-1);
    expect(regular?.slots[0]?.providerMappings).toEqual([expect.objectContaining({ matchType: SlotProviderMatchType.CALENDAR_WEEK, providerValue: null })]);
    expect(final).toEqual(expect.objectContaining({ name: 'NBA Finals', seriesFormat: SeriesFormat.BEST_OF, seriesGames: 7, squaresEligible: false }));
  });
});

describe('how the seeded slot definitions are played (#2043)', () => {
  /** Every seeded slot with its league's sport, name and scoring family. */
  async function seededSlots() {
    const slots = await getPrisma().sportLeagueCompetitionSlot.findMany({
      where: { sportLeague: { name: { not: { startsWith: 'Structure League' } } } },
      select: {
        key: true, slotKind: true, seriesFormat: true, matchFormat: true, canEndTied: true, periodUnit: true, periodCount: true,
        competition: { select: { phase: { select: { phase: true } } } },
        sportLeague: { select: { name: true, scoringFamily: true, sport: { select: { sport: true } } } },
      },
    });
    return slots.map(({ competition, sportLeague, ...slot }) => ({ ...slot, phase: competition.phase.phase, league: sportLeague.name, scoringFamily: sportLeague.scoringFamily, sport: sportLeague.sport.sport }));
  }

  it('meets two sides in every slot of a head-to-head league and ranks a whole field in every other league\'s', async () => {
    const slots = await seededSlots();

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter((slot) => (slot.scoringFamily === 'HEAD_TO_HEAD') !== (slot.matchFormat === MatchFormat.HEAD_TO_HEAD))).toEqual([]);
  });

  it('lets a soccer matchday (a league\'s week or a tournament\'s group matchday), the legs of its two-legged ties and the NFL\'s regular season end level, never a one-game knockout or another league\'s game', async () => {
    const slots = await seededSlots();
    const tied = (league: string, key: string) => slots.find((slot) => slot.league === league && slot.key === key)?.canEndTied;

    expect(slots.filter((slot) => slot.canEndTied && slot.sport !== Sport.SOCCER && !(slot.league === 'NFL' && slot.phase === LeaguePhase.REGULAR))).toEqual([]);
    expect(slots.filter((slot) => slot.league === 'NFL' && slot.phase === LeaguePhase.REGULAR && !slot.canEndTied)).toEqual([]);
    expect(slots.filter((slot) => slot.sport === Sport.SOCCER && slot.canEndTied !== (slot.slotKind === SlotKind.WEEK || slot.seriesFormat === SeriesFormat.AGGREGATE))).toEqual([]);
    expect([
      tied('Premier League', 'WEEK_1'), tied('FIFA World Cup', 'MATCHDAY_1'), tied('FIFA World Cup', 'ROUND_OF_32'),
      tied('UEFA Champions League', 'ROUND_OF_16'), tied('UEFA Champions League', 'FINAL'), tied('NFL', 'WEEK_1'), tied('NFL', 'FINAL'),
    ]).toEqual([true, true, false, true, false, true, false]);
  });

  it('plays the NFL in four quarters, men\'s college basketball in two halves, MLB in nine innings and the PGA TOUR over eighteen holes, and a race in no periods', async () => {
    const slots = await seededSlots();
    const periods = (sport: Sport, league: string) => [...new Set(slots.filter((slot) => slot.sport === sport && slot.league === league).map((slot) => `${String(slot.periodUnit)}:${String(slot.periodCount)}`))];

    expect(periods(Sport.FOOTBALL, 'NFL')).toEqual(['QUARTER:4']);
    expect(periods(Sport.BASKETBALL, 'NCAA Men\'s Basketball')).toEqual(['HALF:2']);
    expect(periods(Sport.BASEBALL, 'MLB')).toEqual(['INNING:9']);
    expect(periods(Sport.GOLF, 'PGA TOUR')).toEqual(['HOLE:18']);
    expect(periods(Sport.AUTO_RACING, 'Formula 1')).toEqual(['null:null']);
  });
});

describe('the test fixture tour', () => {
  it('has a regular season of one competition of one tournament, as a seeded league has its definitions, however many first uses race', async () => {
    const [tourId] = await Promise.all([fixtureTourId(getPrisma()), fixtureTourId(getPrisma()), fixtureTourId(getPrisma())]);

    const phases = await getPrisma().sportLeaguePhase.findMany({
      where: { sportLeagueId: tourId },
      select: { phase: true, isSynced: true, competitions: { select: { code: true, slots: { select: { slotKind: true } } } } },
    });
    expect(phases).toEqual([{ phase: LeaguePhase.REGULAR, isSynced: true, competitions: [{ code: LeaguePhase.REGULAR, slots: [{ slotKind: SlotKind.TOURNAMENT }] }] }]);
  });
});

/** The league's regular phase and its one competition, which a slot definition sits in. */
async function phaseOf(sportLeagueId: string) {
  const prisma = getPrisma();
  const phase = await prisma.sportLeaguePhase.create({ data: { sportLeagueId, phase: LeaguePhase.REGULAR, isSynced: true } });
  return prisma.sportLeagueCompetition.create({ data: { sportLeagueId, sportLeaguePhaseId: phase.id, code: 'REGULAR', orderIndex: 1 } });
}

describe('the database checks on slot definitions', () => {

  it('refuse a WEEK slot with no week number, and a knockout slot with one', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeagueCompetitionSlot;

    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'WEEK_X', slotKind: SlotKind.WEEK } }))
      .rejects.toThrow(/sport_league_competition_slots_week_number/);
    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL, weekNumber: 3 } }))
      .rejects.toThrow(/sport_league_competition_slots_week_number/);
  });

  it('refuse a period count with no unit, a unit with no count, and a game of no periods (#2043)', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeagueCompetitionSlot;
    const slot = { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL };

    await expect(slots.create({ data: { ...slot, periodUnit: null } })).rejects.toThrow(/sport_league_competition_slots_periods/);
    await expect(slots.create({ data: { ...slot, periodCount: null } })).rejects.toThrow(/sport_league_competition_slots_periods/);
    await expect(slots.create({ data: { ...slot, periodCount: 0 } })).rejects.toThrow(/sport_league_competition_slots_periods/);
    await expect(slots.create({ data: { ...slot, periodUnit: null, periodCount: null } })).resolves.toEqual(expect.objectContaining({ periodUnit: null }));
  });

  it('refuse a best-of series of an even number of games, and a key that is not a code', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeagueCompetitionSlot;

    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL, seriesFormat: SeriesFormat.BEST_OF, seriesGames: 4 } }))
      .rejects.toThrow(/sport_league_competition_slots_series_games/);
    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'final four', slotKind: SlotKind.SEMIFINAL } }))
      .rejects.toThrow(/sport_league_competition_slots_key_format/);
  });

  it('refuse a second FINAL in one competition and a second week of the same number, but take any number of tournaments', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeagueCompetitionSlot;
    const base = { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id };
    await slots.createMany({ data: [
      { ...base, key: 'FINAL', slotKind: SlotKind.FINAL },
      { ...base, key: 'WEEK_1', slotKind: SlotKind.WEEK, weekNumber: 1 },
      { ...base, key: 'OPEN_A', slotKind: SlotKind.TOURNAMENT },
      { ...base, key: 'OPEN_B', slotKind: SlotKind.TOURNAMENT },
    ] });

    await expect(slots.create({ data: { ...base, key: 'FINAL_TWO', slotKind: SlotKind.FINAL } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    await expect(slots.create({ data: { ...base, key: 'WEEK_ONE', slotKind: SlotKind.WEEK, weekNumber: 1 } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('take a FINAL in each of two competitions of one phase, as the bowls and the playoff each end in one', async () => {
    const league = await testLeague();
    const first = await phaseOf(league.id);
    const prisma = getPrisma();
    const second = await prisma.sportLeagueCompetition.create({ data: { sportLeagueId: league.id, sportLeaguePhaseId: first.sportLeaguePhaseId, code: 'PLAYOFF', orderIndex: 2 } });
    const base = { ...SLOT_DEFAULTS, sportLeagueId: league.id, slotKind: SlotKind.FINAL };

    await prisma.sportLeagueCompetitionSlot.create({ data: { ...base, sportLeagueCompetitionId: first.id, key: 'FINAL' } });
    await expect(prisma.sportLeagueCompetitionSlot.create({ data: { ...base, sportLeagueCompetitionId: second.id, key: 'PLAYOFF_FINAL' } })).resolves.toEqual(expect.objectContaining({ key: 'PLAYOFF_FINAL' }));
  });

  it('refuse a slot in another league\'s competition, and a provider mapping with no value unless it matches by calendar week', async () => {
    const league = await testLeague();
    const other = await testLeague();
    const otherPhase = await phaseOf(other.id);
    const prisma = getPrisma();

    await expect(prisma.sportLeagueCompetitionSlot.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: otherPhase.id, key: 'FINAL', slotKind: SlotKind.FINAL } }))
      .rejects.toThrow(Prisma.PrismaClientKnownRequestError);

    const phase = await phaseOf(league.id);
    const slot = await prisma.sportLeagueCompetitionSlot.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL } });
    const mappingId = await syncLeagueTo(prisma, league.id, 'nba');
    await expect(prisma.sportLeagueCompetitionSlotProviderMapping.create({ data: {
      sportLeagueId: league.id, sportLeagueCompetitionSlotId: slot.id, sportLeagueProviderMappingId: mappingId, matchType: SlotProviderMatchType.PROVIDER_CODE,
    } })).rejects.toThrow(/competition_slot_provider_mappings_value/);
  });

  it('refuse a second way for one provider to match a slot, a second calendar week row too', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const prisma = getPrisma();
    const slot = await prisma.sportLeagueCompetitionSlot.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeagueCompetitionId: phase.id, key: 'WEEK_1', slotKind: SlotKind.WEEK, weekNumber: 1 } });
    const mapping = { sportLeagueId: league.id, sportLeagueCompetitionSlotId: slot.id, sportLeagueProviderMappingId: await syncLeagueTo(prisma, league.id, 'nba') };
    await prisma.sportLeagueCompetitionSlotProviderMapping.create({ data: { ...mapping, matchType: SlotProviderMatchType.CALENDAR_WEEK } });

    await expect(prisma.sportLeagueCompetitionSlotProviderMapping.create({ data: { ...mapping, matchType: SlotProviderMatchType.CALENDAR_WEEK } }))
      .rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    await expect(prisma.sportLeagueCompetitionSlotProviderMapping.create({ data: { ...mapping, matchType: SlotProviderMatchType.PROVIDER_CODE, providerValue: 'REG:1' } }))
      .rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });
});

describe('the database checks on competitions', () => {
  async function regularPhase(sportLeagueId: string) {
    return getPrisma().sportLeaguePhase.create({ data: { sportLeagueId, phase: LeaguePhase.REGULAR, isSynced: true } });
  }

  it('refuse a code that is not a code, an order index below 1, a second competition of one code in a league and a second of one order in a phase', async () => {
    const league = await testLeague();
    const phase = await regularPhase(league.id);
    const competitions = getPrisma().sportLeagueCompetition;
    const base = { sportLeagueId: league.id, sportLeaguePhaseId: phase.id };
    await competitions.create({ data: { ...base, code: 'REGULAR', orderIndex: 1 } });

    await expect(competitions.create({ data: { ...base, code: 'conference tournament', orderIndex: 2 } })).rejects.toThrow(/sport_league_competitions_code_format/);
    await expect(competitions.create({ data: { ...base, code: 'CUP', orderIndex: 0 } })).rejects.toThrow(/sport_league_competitions_order_index/);
    await expect(competitions.create({ data: { ...base, code: 'REGULAR', orderIndex: 2 } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    await expect(competitions.create({ data: { ...base, code: 'CUP', orderIndex: 1 } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('refuse a competition in another league\'s phase', async () => {
    const league = await testLeague();
    const otherPhase = await regularPhase((await testLeague()).id);

    await expect(getPrisma().sportLeagueCompetition.create({ data: { sportLeagueId: league.id, sportLeaguePhaseId: otherPhase.id, code: 'REGULAR', orderIndex: 1 } }))
      .rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('refuse a Season competition whose Season does not hold its phase, or whose competition is in another phase', async () => {
    const prisma = getPrisma();
    const league = await testLeague();
    const regular = await regularPhase(league.id);
    const postseason = await prisma.sportLeaguePhase.create({ data: { sportLeagueId: league.id, phase: LeaguePhase.POSTSEASON, isSynced: true } });
    const regularCompetition = await prisma.sportLeagueCompetition.create({ data: { sportLeagueId: league.id, sportLeaguePhaseId: regular.id, code: 'REGULAR', orderIndex: 1 } });
    const playoff = await prisma.sportLeagueCompetition.create({ data: { sportLeagueId: league.id, sportLeaguePhaseId: postseason.id, code: 'PLAYOFF', orderIndex: 1 } });
    const sportLeagueSeasonId = await fixtureSeasonId(prisma, league.id, 2026);
    await prisma.sportLeagueSeasonPhase.create({ data: { sportLeagueId: league.id, sportLeagueSeasonId, sportLeaguePhaseId: regular.id } });
    const base = { sportLeagueId: league.id, sportLeagueSeasonId };

    await expect(prisma.sportLeagueSeasonCompetition.create({ data: { ...base, sportLeaguePhaseId: postseason.id, sportLeagueCompetitionId: playoff.id } }))
      .rejects.toThrow(/sport_league_season_competitions_season_phase_fkey/);
    await expect(prisma.sportLeagueSeasonCompetition.create({ data: { ...base, sportLeaguePhaseId: regular.id, sportLeagueCompetitionId: playoff.id } }))
      .rejects.toThrow(/sport_league_season_competitions_competition_fkey/);
    await expect(prisma.sportLeagueSeasonCompetition.create({ data: { ...base, sportLeaguePhaseId: regular.id, sportLeagueCompetitionId: regularCompetition.id } }))
      .resolves.toMatchObject({ sportLeagueCompetitionId: regularCompetition.id });
  });
});

describe('GET /api/v1/sport-leagues/{sportLeagueId}/structure', () => {
  it('lists phases in Season order, each phase\'s competitions in their order and each competition\'s slots in play order, however they were written', async () => {
    const league = await testLeague();
    const prisma = getPrisma();
    const postseason = await prisma.sportLeaguePhase.create({ data: { sportLeagueId: league.id, phase: LeaguePhase.POSTSEASON, isSynced: true } });
    const regular = await prisma.sportLeaguePhase.create({ data: { sportLeagueId: league.id, phase: LeaguePhase.REGULAR, isSynced: true } });
    const competition = (sportLeaguePhaseId: string, code: string, orderIndex: number) =>
      prisma.sportLeagueCompetition.create({ data: { sportLeagueId: league.id, sportLeaguePhaseId, code, orderIndex } });
    const playoff = await competition(postseason.id, 'PLAYOFF', 2);
    const bowls = await competition(postseason.id, 'BOWLS', 1);
    const season = await competition(regular.id, 'REGULAR', 1);
    const base = { ...SLOT_DEFAULTS, sportLeagueId: league.id };
    await prisma.sportLeagueCompetitionSlot.createMany({ data: [
      { ...base, sportLeagueCompetitionId: playoff.id, key: 'FINAL', slotKind: SlotKind.FINAL, name: 'The Final' },
      { ...base, sportLeagueCompetitionId: playoff.id, key: 'SEMIFINAL', slotKind: SlotKind.SEMIFINAL },
      { ...base, sportLeagueCompetitionId: bowls.id, key: 'ROSE_BOWL', slotKind: SlotKind.TOURNAMENT },
      { ...base, sportLeagueCompetitionId: season.id, key: 'WEEK_10', slotKind: SlotKind.WEEK, weekNumber: 10 },
      { ...base, sportLeagueCompetitionId: season.id, key: 'WEEK_2', slotKind: SlotKind.WEEK, weekNumber: 2 },
    ] });

    const response = await get(`/api/v1/sport-leagues/${league.id}/structure`);

    expect(response.statusCode).toBe(200);
    const { phases } = SportLeagueStructureResponseSchema.parse(response.json());
    expect(phases.map((phase) => [phase.phase, phase.competitions.map((each) => [each.code, each.slots.map((slot) => slot.key)])])).toEqual([
      [LeaguePhase.REGULAR, [['REGULAR', ['WEEK_2', 'WEEK_10']]]],
      [LeaguePhase.POSTSEASON, [['BOWLS', ['ROSE_BOWL']], ['PLAYOFF', ['SEMIFINAL', 'FINAL']]]],
    ]);
  });

  it('answers an empty list for a league with no definitions, 403 for a member who is not a root admin, and 404 for a league that does not exist', async () => {
    const league = await testLeague();
    const member = await createTestUser();

    const empty = await get(`/api/v1/sport-leagues/${league.id}/structure`);
    const refused = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${league.id}/structure`, headers: member.headers });
    const missing = await get(`/api/v1/sport-leagues/${randomUUID()}/structure`);

    expect(empty.json()).toEqual({ phases: [] });
    expect(refused.statusCode).toBe(403);
    expect(missing.statusCode).toBe(404);
  });
});

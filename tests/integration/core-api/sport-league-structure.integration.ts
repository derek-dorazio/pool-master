/**
 * A sport league's phase and slot definitions (#2002) against real Postgres: the rows the
 * migration seeds for every league, the database checks that keep a definition coherent, and the
 * League page's Structure read over HTTP. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { LeaguePhase, SeriesFormat, SlotKind, SlotPairing, SlotProviderMatchType, Sport } from '@poolmaster/shared/domain';
import { SportLeagueStructureResponseSchema } from '@poolmaster/shared/dto';
import { cleanupTestData, createTestUser, getApp, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { leagueProfiles } from '../../support/league-profiles';
import { syncLeagueTo } from '../../support/league-sync';

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
  return prisma.sportLeague.create({ data: { ...(await leagueProfiles(prisma)), sportId: sport.id, name: `Structure League ${randomUUID().slice(0, 8)}` } });
}

const SLOT_DEFAULTS = {
  awardsTrophy: false, squaresEligible: false, seriesFormat: SeriesFormat.SINGLE_GAME, seriesGames: 1, pairing: SlotPairing.FIXED,
} as const;

describe('the seeded phase and slot definitions', () => {
  it('give every sport league at least one phase, and no unsynced phase any slot', async () => {
    const prisma = getPrisma();
    const leagues = await prisma.sportLeague.findMany({ select: { id: true, name: true, phases: { select: { isSynced: true, _count: { select: { slots: true } } } } } });
    const seeded = leagues.filter((league) => !league.name.startsWith('Structure League'));

    expect(seeded.filter((league) => league.phases.length === 0).map((league) => league.name)).toEqual([]);
    expect(seeded.flatMap((league) => league.phases.filter((phase) => !phase.isSynced && phase._count.slots > 0)).length).toBe(0);
  });

  it('seed the NFL with an unsynced preseason, 18 weeks matched by provider code, and a reseeded postseason ending in the Super Bowl', async () => {
    const response = await get(`/api/v1/sport-leagues/${NFL_ID}/structure`);

    expect(response.statusCode).toBe(200);
    const { phases } = SportLeagueStructureResponseSchema.parse(response.json());
    expect(phases.map((phase) => [phase.phase, phase.isSynced, phase.slots.length])).toEqual([
      [LeaguePhase.PRESEASON, false, 0],
      [LeaguePhase.REGULAR, true, 18],
      [LeaguePhase.POSTSEASON, true, 4],
    ]);
    const [, regular, postseason] = phases;
    expect(regular.slots[13]).toEqual(expect.objectContaining({
      key: 'WEEK_14', slotKind: SlotKind.WEEK, weekNumber: 14, name: null, squaresEligible: true,
      providerMappings: [expect.objectContaining({ providerName: 'BALLDONTLIE', providerLeagueCode: 'nfl', matchType: SlotProviderMatchType.PROVIDER_CODE, providerValue: 'REG:14' })],
    }));
    expect(postseason.slots.map((slot) => [slot.slotKind, slot.name, slot.pairing, slot.providerMappings[0]?.providerValue])).toEqual([
      [SlotKind.ROUND_OF_16, 'Wild Card', SlotPairing.RESEEDED, 'POST:1'],
      [SlotKind.QUARTERFINAL, 'Divisional', SlotPairing.RESEEDED, 'POST:2'],
      [SlotKind.SEMIFINAL, 'Conference Championships', SlotPairing.RESEEDED, 'POST:3'],
      [SlotKind.FINAL, 'Super Bowl', SlotPairing.RESEEDED, 'POST:4'],
    ]);
    expect(postseason.slots.at(-1)).toEqual(expect.objectContaining({ awardsTrophy: true, squaresEligible: true }));
  });

  it('seed the NBA\'s best-of-seven rounds as series a squares pool cannot be played on, and its weeks matched by calendar week', async () => {
    const nba = await getPrisma().sportLeague.findFirstOrThrow({ where: { id: '09f45f12-11be-43ac-bfa6-70a53f6e0169' }, select: { id: true } });

    const { phases } = SportLeagueStructureResponseSchema.parse((await get(`/api/v1/sport-leagues/${nba.id}/structure`)).json());

    const regular = phases.find((phase) => phase.phase === LeaguePhase.REGULAR);
    const final = phases.find((phase) => phase.phase === LeaguePhase.POSTSEASON)?.slots.at(-1);
    expect(regular?.slots[0]?.providerMappings).toEqual([expect.objectContaining({ matchType: SlotProviderMatchType.CALENDAR_WEEK, providerValue: null })]);
    expect(final).toEqual(expect.objectContaining({ name: 'NBA Finals', seriesFormat: SeriesFormat.BEST_OF, seriesGames: 7, squaresEligible: false }));
  });
});

describe('the database checks on slot definitions', () => {
  async function phaseOf(sportLeagueId: string) {
    return getPrisma().sportLeaguePhase.create({ data: { sportLeagueId, phase: LeaguePhase.REGULAR, isSynced: true } });
  }

  it('refuse a WEEK slot with no week number, and a knockout slot with one', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeaguePhaseSlot;

    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: phase.id, key: 'WEEK_X', slotKind: SlotKind.WEEK } }))
      .rejects.toThrow(/sport_league_phase_slots_week_number/);
    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL, weekNumber: 3 } }))
      .rejects.toThrow(/sport_league_phase_slots_week_number/);
  });

  it('refuse a best-of series of an even number of games, and a key that is not a code', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeaguePhaseSlot;

    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL, seriesFormat: SeriesFormat.BEST_OF, seriesGames: 4 } }))
      .rejects.toThrow(/sport_league_phase_slots_series_games/);
    await expect(slots.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: phase.id, key: 'final four', slotKind: SlotKind.SEMIFINAL } }))
      .rejects.toThrow(/sport_league_phase_slots_key_format/);
  });

  it('refuse a second FINAL in one phase and a second week of the same number, but take any number of tournaments', async () => {
    const league = await testLeague();
    const phase = await phaseOf(league.id);
    const slots = getPrisma().sportLeaguePhaseSlot;
    const base = { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: phase.id };
    await slots.createMany({ data: [
      { ...base, key: 'FINAL', slotKind: SlotKind.FINAL },
      { ...base, key: 'WEEK_1', slotKind: SlotKind.WEEK, weekNumber: 1 },
      { ...base, key: 'OPEN_A', slotKind: SlotKind.TOURNAMENT },
      { ...base, key: 'OPEN_B', slotKind: SlotKind.TOURNAMENT },
    ] });

    await expect(slots.create({ data: { ...base, key: 'FINAL_TWO', slotKind: SlotKind.FINAL } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    await expect(slots.create({ data: { ...base, key: 'WEEK_ONE', slotKind: SlotKind.WEEK, weekNumber: 1 } })).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('refuse a slot in another league\'s phase, and a provider mapping with no value unless it matches by calendar week', async () => {
    const league = await testLeague();
    const other = await testLeague();
    const otherPhase = await phaseOf(other.id);
    const prisma = getPrisma();

    await expect(prisma.sportLeaguePhaseSlot.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: otherPhase.id, key: 'FINAL', slotKind: SlotKind.FINAL } }))
      .rejects.toThrow(Prisma.PrismaClientKnownRequestError);

    const phase = await phaseOf(league.id);
    const slot = await prisma.sportLeaguePhaseSlot.create({ data: { ...SLOT_DEFAULTS, sportLeagueId: league.id, sportLeaguePhaseId: phase.id, key: 'FINAL', slotKind: SlotKind.FINAL } });
    const mappingId = await syncLeagueTo(prisma, league.id, 'nba');
    await expect(prisma.sportLeaguePhaseSlotProviderMapping.create({ data: {
      sportLeagueId: league.id, sportLeaguePhaseSlotId: slot.id, sportLeagueProviderMappingId: mappingId, matchType: SlotProviderMatchType.PROVIDER_CODE,
    } })).rejects.toThrow(/sport_league_phase_slot_provider_mappings_value/);
  });
});

describe('GET /api/v1/sport-leagues/{sportLeagueId}/structure', () => {
  it('lists phases in Season order and each phase\'s slots in play order, however they were written', async () => {
    const league = await testLeague();
    const prisma = getPrisma();
    const postseason = await prisma.sportLeaguePhase.create({ data: { sportLeagueId: league.id, phase: LeaguePhase.POSTSEASON, isSynced: true } });
    const regular = await prisma.sportLeaguePhase.create({ data: { sportLeagueId: league.id, phase: LeaguePhase.REGULAR, isSynced: true } });
    const base = { ...SLOT_DEFAULTS, sportLeagueId: league.id };
    await prisma.sportLeaguePhaseSlot.createMany({ data: [
      { ...base, sportLeaguePhaseId: postseason.id, key: 'FINAL', slotKind: SlotKind.FINAL, name: 'The Final' },
      { ...base, sportLeaguePhaseId: postseason.id, key: 'SEMIFINAL', slotKind: SlotKind.SEMIFINAL },
      { ...base, sportLeaguePhaseId: regular.id, key: 'WEEK_10', slotKind: SlotKind.WEEK, weekNumber: 10 },
      { ...base, sportLeaguePhaseId: regular.id, key: 'WEEK_2', slotKind: SlotKind.WEEK, weekNumber: 2 },
    ] });

    const response = await get(`/api/v1/sport-leagues/${league.id}/structure`);

    expect(response.statusCode).toBe(200);
    const { phases } = SportLeagueStructureResponseSchema.parse(response.json());
    expect(phases.map((phase) => [phase.phase, phase.slots.map((slot) => slot.key)])).toEqual([
      [LeaguePhase.REGULAR, ['WEEK_2', 'WEEK_10']],
      [LeaguePhase.POSTSEASON, ['SEMIFINAL', 'FINAL']],
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

import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { MatchSide, Sport, SportEventStatus, sideNumberOfMatchSide } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import type { ProviderBracketMatch, ProviderScheduledGame } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests, integrationSportEventServices } from '../helpers';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo } from '../../support/league-sync';
import { sportRowKeys } from '../../support/sport-rows';
import { eventRoundSlots, fixtureSeasonId } from '../../support/event-edition';
import { sportPlay } from '../../support/sport-play';
import { AWAY_SIDE, HOME_SIDE } from '../../support/match-sides';
import { rowSideTeam } from '../../support/match-rows';

// A synced league's game week and fixed-shape playoff take their games from its provider (ADR
// 0011, #1728), against real Postgres: the draft's matches written through the bracket's own
// load, each side the field row of the team the provider names, a released week's moved kickoff
// written to its match, and a released playoff's reseeded round placed from the provider's games.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

const PROVIDER = SYNCED_PROVIDER_ID;
const KICKOFF = new Date('2026-11-15T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** A synced league's draft NFL week linked to the provider, its four teams in the field and mapped. */
async function syncedWeek() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.FOOTBALL },
    create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL), tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `NFL ${randomUUID()}` } });
  await syncLeagueTo(prisma, sportLeague.id, 'nfl');
  const externalId = `nfl-2026-week-11-${randomUUID().slice(0, 6)}`;
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    sportLeagueId: sportLeague.id,
    sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2026),
    providerRef: { providerId: PROVIDER, externalId },
    name: 'NFL Week 11',
    startDate: KICKOFF,
    status: SportEventStatus.DRAFT,
    rounds: 1,
    autoLifecycleEnabled: true,
  });
  await createRoundRows(getPrisma(), new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: KICKOFF }]);
  const field = { Bears: '', Lions: '', Packers: '', Vikings: '' };
  for (const name of ['Bears', 'Lions', 'Packers', 'Vikings'] as const) {
    // poolmaster-allow-query-in-loop: four test fixture teams
    const team = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' } });
    // poolmaster-allow-query-in-loop: four test fixture teams
    await prisma.participantProviderMapping.create({ data: { participantId: team.id, sportLeagueId: team.sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'TEAM', externalId: `${externalId}-${name}` } });
    // poolmaster-allow-query-in-loop: four test fixture teams
    const row = await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: team.id } });
    field[name] = row.id;
  }
  const game = (id: string, home: string, away: string, hoursAfterKickoff: number): ProviderScheduledGame => ({
    games: [{ providerGameId: id, gameNumber: 1 }],
    roundNumber: 1,
    homeTeamExternalId: `${externalId}-${home}`,
    awayTeamExternalId: `${externalId}-${away}`,
    scheduledAt: new Date(KICKOFF.getTime() + hoursAfterKickoff * HOUR),
    isNeutralSite: false,
  });
  return { event, externalId, field, game };
}

async function matchesOf(sportEventId: string) {
  const rows = await getPrisma().sportEventRoundMatch.findMany({ where: { sportEventId }, include: { sides: true }, orderBy: [{ sportEventRound: { roundNumber: 'asc' } }, { matchNumber: 'asc' }] });
  return rows.map((row) => [row.matchNumber, rowSideTeam(row, HOME_SIDE), rowSideTeam(row, AWAY_SIDE), row.scheduledDate?.toISOString() ?? null]);
}

/** The event's one match's sides: each side's number, its team and where it plays Game 1. */
async function sidesOf(sportEventId: string) {
  const sides = await getPrisma().sportEventRoundMatchSide.findMany({
    where: { sportEventId },
    orderBy: { sideNumber: 'asc' },
    include: { gameResults: { where: { game: { gameNumber: 1 } }, select: { homeAway: true } } },
  });
  return sides.map((side) => [side.sideNumber, side.sportEventParticipantId, side.gameResults[0]?.homeAway ?? null]);
}

describe('Provider game slate (#1728)', () => {
  it('writes a synced draft week\'s games as its matches, then moves a released week\'s kickoff the provider moved', async () => {
    const { event, externalId, field, game } = await syncedWeek();
    const { providerGames } = integrationSportEventServices();

    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: externalId, games: [game('g2', 'Packers', 'Vikings', 3), game('g1', 'Bears', 'Lions', 0)] }))
      .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 2 });
    expect(await matchesOf(event.id)).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 3 * HOUR).toISOString()],
    ]);

    await getPrisma().sportEvent.update({ where: { id: event.id }, data: { status: SportEventStatus.SCHEDULED } });
    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: externalId, games: [game('g1', 'Bears', 'Lions', 0), game('g2', 'Packers', 'Vikings', 7)] }))
      .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matches: [{ roundNumber: 1, matchNumber: 2 }] });
    expect(await matchesOf(event.id)).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 7 * HOUR).toISOString()],
    ]);
  });

  it('writes each synced game with its away team on side 1 and its home team on side 2, and a released game the provider lists the other way round keeps its sides and changes only where each plays Game 1 (#2046)', async () => {
    const { event, externalId, field, game } = await syncedWeek();
    const { providerGames } = integrationSportEventServices();
    await providerGames.afterFieldLoad({ providerId: PROVIDER, externalId, games: [game('g1', 'Bears', 'Lions', 0)] });
    const loaded = await sidesOf(event.id);

    await getPrisma().sportEvent.update({ where: { id: event.id }, data: { status: SportEventStatus.SCHEDULED } });
    await providerGames.afterFieldLoad({ providerId: PROVIDER, externalId, games: [game('g1', 'Lions', 'Bears', 0)] });

    expect(loaded).toEqual([[1, field.Lions, 'AWAY'], [2, field.Bears, 'HOME']]);
    expect(await sidesOf(event.id)).toEqual([[1, field.Lions, 'HOME'], [2, field.Bears, 'AWAY']]);
  });

  it('leaves an event of a league that is not synced without games', async () => {
    const { event, externalId, game } = await syncedWeek();
    await getPrisma().sportLeague.updateMany({ where: { id: event.sportLeagueId }, data: { selectedProviderMappingId: null } });
    const { providerGames } = integrationSportEventServices();

    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: externalId, games: [game('g1', 'Bears', 'Lions', 0)] }))
      .resolves.toEqual({ outcome: 'SKIPPED', reason: 'NOT_SYNCED' });
    expect(await matchesOf(event.id)).toEqual([]);
  });

  it('loads a synced draft playoff\'s whole bracket, then places its reseeded round from the provider\'s games once the round before is played', async () => {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.FOOTBALL },
      create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL), tournamentFormat: 'MATCHES' },
      update: {},
    });
    const sportLeague = await prisma.sportLeague.create({
      data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `NFL ${randomUUID()}` },
    });
    await syncLeagueTo(prisma, sportLeague.id, 'nfl');
    const externalId = `nfl-2026-postseason-${randomUUID().slice(0, 6)}`;
    const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
      sportLeagueId: sportLeague.id,
      sportLeagueSeasonId: await fixtureSeasonId(prisma, sportLeague.id, 2026),
      providerRef: { providerId: PROVIDER, externalId },
      name: 'NFL Playoffs',
      startDate: KICKOFF,
      status: SportEventStatus.DRAFT,
      rounds: 3,
        autoLifecycleEnabled: true,
    });
    const WEEK = 7 * 24 * HOUR;
    // The Divisional round reseeds; each round is its own synced slot, so the event stays synced.
    const eventSlotIds = await eventRoundSlots(prisma, event.id, [{ slotKind: 'QUARTERFINAL' }, { slotKind: 'SEMIFINAL', pairing: 'RESEEDED' }, { slotKind: 'FINAL' }], { isTestData: false });
    const eventSlots = await prisma.sportEventSlot.findMany({ where: { id: { in: eventSlotIds } }, select: { id: true, sportLeagueSeasonCompetitionSlotId: true } });
    const seasonSlotOf = new Map(eventSlots.map((eventSlot) => [eventSlot.id, eventSlot.sportLeagueSeasonCompetitionSlotId]));
    await new PrismaSportEventRoundRepository(getAppPrisma()).createMany(eventSlotIds.map((eventSlotId, index) => ({
      sportEventId: event.id, seasonSlotId: seasonSlotOf.get(eventSlotId) ?? '', roundNumber: index + 1, scheduledDate: new Date(KICKOFF.getTime() + index * WEEK),
    })));
    // One conference: seeds 2 to 7 play the Wild Card while the 1 seed waits in the reseeded round.
    const team = (seed: number) => `${externalId}-seed-${seed}`;
    const row = new Map<number, string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7]) {
      // poolmaster-allow-query-in-loop: seven test fixture teams
      const participant = await prisma.participant.create({ data: { sportLeagueId: sportLeague.id, name: `Seed ${seed} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' } });
      // poolmaster-allow-query-in-loop: seven test fixture teams
      await prisma.participantProviderMapping.create({ data: { participantId: participant.id, sportLeagueId: participant.sportLeagueId, providerId: BALLDONTLIE_TEST_PROVIDER_ID, participantType: 'TEAM', externalId: team(seed) } });
      // poolmaster-allow-query-in-loop: seven test fixture teams
      row.set(seed, (await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id, seedNumber: seed } })).id);
    }
    const slot = (matchNumber: number, roundNumber: number, home: number | null, away: number | null, advancesTo: ProviderBracketMatch['advancesTo'] = null): ProviderBracketMatch => ({
      matchNumber,
      roundNumber,
      homeTeamExternalId: home === null ? null : team(home),
      awayTeamExternalId: away === null ? null : team(away),
      isNeutralSite: roundNumber === 3,
      scheduledAt: roundNumber === 1 ? KICKOFF : null,
      advancesTo,
      regionLabel: roundNumber === 3 ? null : 'AFC',
    });
    const bracket = [
      slot(1, 1, 2, 7), slot(2, 1, 3, 6), slot(3, 1, 4, 5),
      // Each round numbers its games from 1 (#2161).
      slot(1, 2, 1, null, { roundNumber: 3, matchNumber: 1, side: MatchSide.HOME }), slot(2, 2, null, null, { roundNumber: 3, matchNumber: 1, side: MatchSide.AWAY }),
      slot(1, 3, null, null),
    ];
    const game = (id: string, roundNumber: number, home: number, away: number, at: Date): ProviderScheduledGame => ({
      games: [{ providerGameId: id, gameNumber: 1 }], roundNumber, homeTeamExternalId: team(home), awayTeamExternalId: team(away), scheduledAt: at, isNeutralSite: false,
    });
    const wildCard = [game('w1', 1, 2, 7, KICKOFF), game('w2', 1, 3, 6, KICKOFF), game('w3', 1, 4, 5, KICKOFF)];
    const { providerGames } = integrationSportEventServices();
    const sides = async () => (await matchesOf(event.id)).map(([matchNumber, home, away]) => [matchNumber, home, away]);

    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: externalId, games: wildCard, bracket }))
      .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 6 });
    const seedRow = (seed: number) => row.get(seed) ?? null;
    expect(await sides()).toEqual([
      [1, seedRow(2), seedRow(7)], [2, seedRow(3), seedRow(6)], [3, seedRow(4), seedRow(5)],
      [1, seedRow(1), null], [2, null, null], [1, null, null],
    ]);

    // Released, and the Wild Card played: the 2 and 4 seeds win at home, the 6 seed away.
    await prisma.sportEvent.update({ where: { id: event.id }, data: { status: SportEventStatus.SCHEDULED } });
    for (const [matchNumber, winnerSide] of [[1, 'HOME'], [2, 'AWAY'], [3, 'HOME']] as const) {
      // poolmaster-allow-query-in-loop: three test fixture results
      const { id } = await prisma.sportEventRoundMatch.findFirstOrThrow({ where: { sportEventId: event.id, sportEventRound: { roundNumber: 1 }, matchNumber }, select: { id: true } });
      await prisma.sportEventRoundMatch.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      const winner = sideNumberOfMatchSide(winnerSide);
      await prisma.sportEventRoundMatchSide.updateMany({ where: { sportEventRoundMatchId: id, sideNumber: winner }, data: { outcome: 'WON' } });
      await prisma.sportEventRoundMatchSide.updateMany({ where: { sportEventRoundMatchId: id, sideNumber: { not: winner } }, data: { outcome: 'LOST' } });
    }
    const divisionalKickoff = new Date(KICKOFF.getTime() + WEEK);
    await expect(providerGames.afterFieldLoad({
      providerId: PROVIDER,
      externalId: externalId,
      games: [...wildCard, game('d1', 2, 1, 6, divisionalKickoff), game('d2', 2, 2, 4, divisionalKickoff)],
      bracket,
    })).resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matches: [{ roundNumber: 2, matchNumber: 1 }, { roundNumber: 2, matchNumber: 2 }] });
    expect((await matchesOf(event.id)).slice(3, 5)).toEqual([
      [1, seedRow(1), seedRow(6), divisionalKickoff.toISOString()],
      [2, seedRow(2), seedRow(4), divisionalKickoff.toISOString()],
    ]);
  });
});

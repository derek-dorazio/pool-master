import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { MatchSide, Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { createSportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import type { ProviderBracketMatch, ProviderScheduledGame } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

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

const PROVIDER = 'integration-test';
const KICKOFF = new Date('2026-11-15T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;

/** A synced league's draft NFL week linked to the provider, its four teams in the field and mapped. */
async function syncedWeek() {
  const prisma = getPrisma();
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.AMERICAN_FOOTBALL },
    create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
    update: {},
  });
  const sportLeague = await prisma.sportLeague.create({ data: { sportId: sport.id, name: `NFL ${randomUUID()}`, matchKeyword: 'NFL', eventSyncProviderId: PROVIDER } });
  const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `Week 11 ${randomUUID()}` } });
  const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
    eventSeriesId: eventSeries.id,
    eventYear: 2026,
    externalId: `nfl-2026-week-11-${randomUUID().slice(0, 6)}`,
    providerId: PROVIDER,
    sport: Sport.AMERICAN_FOOTBALL,
    name: 'NFL Week 11',
    startDate: KICKOFF,
    status: SportEventStatus.DRAFT,
    rounds: 1,
    syncScope: 'SCORES_ONLY',
    autoLifecycleEnabled: true,
  });
  await createRoundRows(new PrismaSportEventRoundRepository(getAppPrisma()), event.id, [{ roundNumber: 1, scheduledDate: KICKOFF }]);
  const field = { Bears: '', Lions: '', Packers: '', Vikings: '' };
  for (const name of ['Bears', 'Lions', 'Packers', 'Vikings'] as const) {
    // poolmaster-allow-query-in-loop: four test fixture teams
    const team = await prisma.participant.create({ data: { sportId: sport.id, name: `${name} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' } });
    // poolmaster-allow-query-in-loop: four test fixture teams
    await prisma.participantProviderMapping.create({ data: { participantId: team.id, providerId: PROVIDER, externalId: `${event.externalId}-${name}`, confidence: 'EXACT' } });
    // poolmaster-allow-query-in-loop: four test fixture teams
    const row = await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: team.id } });
    field[name] = row.id;
  }
  const game = (id: string, home: string, away: string, hoursAfterKickoff: number): ProviderScheduledGame => ({
    externalGameId: id,
    roundNumber: 1,
    homeTeamExternalId: `${event.externalId}-${home}`,
    awayTeamExternalId: `${event.externalId}-${away}`,
    scheduledAt: new Date(KICKOFF.getTime() + hoursAfterKickoff * HOUR),
    isNeutralSite: false,
  });
  return { event, field, game };
}

async function matchesOf(sportEventId: string) {
  const rows = await getPrisma().sportEventMatch.findMany({ where: { sportEventId }, orderBy: { matchNumber: 'asc' } });
  return rows.map((row) => [row.matchNumber, row.homeSportEventParticipantId, row.awaySportEventParticipantId, row.scheduledDate?.toISOString() ?? null]);
}

describe('Provider game slate (#1728)', () => {
  it('writes a synced draft week\'s games as its matches, then moves a released week\'s kickoff the provider moved', async () => {
    const { event, field, game } = await syncedWeek();
    const { providerGames } = createSportEventServices(getAppPrisma());

    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, games: [game('g2', 'Packers', 'Vikings', 3), game('g1', 'Bears', 'Lions', 0)] }))
      .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 2 });
    expect(await matchesOf(event.id)).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 3 * HOUR).toISOString()],
    ]);

    await getPrisma().sportEvent.update({ where: { id: event.id }, data: { status: SportEventStatus.SCHEDULED } });
    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, games: [game('g1', 'Bears', 'Lions', 0), game('g2', 'Packers', 'Vikings', 7)] }))
      .resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [2] });
    expect(await matchesOf(event.id)).toEqual([
      [1, field.Bears, field.Lions, KICKOFF.toISOString()],
      [2, field.Packers, field.Vikings, new Date(KICKOFF.getTime() + 7 * HOUR).toISOString()],
    ]);
  });

  it('leaves an event of a league that is not synced without games', async () => {
    const { event, game } = await syncedWeek();
    await getPrisma().sportLeague.updateMany({ where: { eventSeries: { some: { id: event.eventSeriesId } } }, data: { eventSyncProviderId: null } });
    const { providerGames } = createSportEventServices(getAppPrisma());

    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, games: [game('g1', 'Bears', 'Lions', 0)] }))
      .resolves.toEqual({ outcome: 'SKIPPED', reason: 'NOT_SYNCED' });
    expect(await matchesOf(event.id)).toEqual([]);
  });

  it('loads a synced draft playoff\'s whole bracket, then places its reseeded round from the provider\'s games once the round before is played', async () => {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.AMERICAN_FOOTBALL },
      create: { sport: Sport.AMERICAN_FOOTBALL, participantType: 'TEAM', tournamentFormat: 'MATCHES' },
      update: {},
    });
    const sportLeague = await prisma.sportLeague.create({
      data: { sportId: sport.id, name: `NFL ${randomUUID()}`, matchKeyword: 'NFL', eventSyncProviderId: PROVIDER, bracketAdvancement: 'RESEED_BY_SEED' },
    });
    const eventSeries = await prisma.eventSeries.create({ data: { sportLeagueId: sportLeague.id, name: `NFL Playoffs ${randomUUID()}` } });
    const event = await createSportEventRow(new PrismaSportEventRepository(getAppPrisma()), {
      eventSeriesId: eventSeries.id,
      eventYear: 2026,
      externalId: `nfl-2026-postseason-${randomUUID().slice(0, 6)}`,
      providerId: PROVIDER,
      sport: Sport.AMERICAN_FOOTBALL,
      name: 'NFL Playoffs',
      startDate: KICKOFF,
      status: SportEventStatus.DRAFT,
      rounds: 3,
      syncScope: 'SCORES_ONLY',
      autoLifecycleEnabled: true,
    });
    const WEEK = 7 * 24 * HOUR;
    await createRoundRows(new PrismaSportEventRoundRepository(getAppPrisma()), event.id, [1, 2, 3].map((roundNumber) => ({ roundNumber, scheduledDate: new Date(KICKOFF.getTime() + (roundNumber - 1) * WEEK) })));
    // One conference: seeds 2 to 7 play the Wild Card while the 1 seed waits in the reseeded round.
    const team = (seed: number) => `${event.externalId}-seed-${seed}`;
    const row = new Map<number, string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7]) {
      // poolmaster-allow-query-in-loop: seven test fixture teams
      const participant = await prisma.participant.create({ data: { sportId: sport.id, name: `Seed ${seed} ${randomUUID().slice(0, 6)}`, participantType: 'TEAM' } });
      // poolmaster-allow-query-in-loop: seven test fixture teams
      await prisma.participantProviderMapping.create({ data: { participantId: participant.id, providerId: PROVIDER, externalId: team(seed), confidence: 'EXACT' } });
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
      slot(4, 2, 1, null, { matchNumber: 6, side: MatchSide.HOME }), slot(5, 2, null, null, { matchNumber: 6, side: MatchSide.AWAY }),
      slot(6, 3, null, null),
    ];
    const game = (id: string, roundNumber: number, home: number, away: number, at: Date): ProviderScheduledGame => ({
      externalGameId: id, roundNumber, homeTeamExternalId: team(home), awayTeamExternalId: team(away), scheduledAt: at, isNeutralSite: false,
    });
    const wildCard = [game('w1', 1, 2, 7, KICKOFF), game('w2', 1, 3, 6, KICKOFF), game('w3', 1, 4, 5, KICKOFF)];
    const { providerGames } = createSportEventServices(getAppPrisma());
    const sides = async () => (await matchesOf(event.id)).map(([matchNumber, home, away]) => [matchNumber, home, away]);

    await expect(providerGames.afterFieldLoad({ providerId: PROVIDER, externalId: event.externalId, games: wildCard, bracket }))
      .resolves.toEqual({ outcome: 'LOADED', sportEventId: event.id, matchCount: 6 });
    const seedRow = (seed: number) => row.get(seed) ?? null;
    expect(await sides()).toEqual([
      [1, seedRow(2), seedRow(7)], [2, seedRow(3), seedRow(6)], [3, seedRow(4), seedRow(5)],
      [4, seedRow(1), null], [5, null, null], [6, null, null],
    ]);

    // Released, and the Wild Card played: the 2 and 4 seeds win at home, the 6 seed away.
    await prisma.sportEvent.update({ where: { id: event.id }, data: { status: SportEventStatus.SCHEDULED } });
    for (const [matchNumber, winnerSide] of [[1, 'HOME'], [2, 'AWAY'], [3, 'HOME']] as const) {
      // poolmaster-allow-query-in-loop: three test fixture results
      await prisma.sportEventMatch.updateMany({ where: { sportEventId: event.id, matchNumber }, data: { status: 'COMPLETED', winnerSide, homeScore: 20, awayScore: 17 } });
    }
    const divisionalKickoff = new Date(KICKOFF.getTime() + WEEK);
    await expect(providerGames.afterFieldLoad({
      providerId: PROVIDER,
      externalId: event.externalId,
      games: [...wildCard, game('d1', 2, 1, 6, divisionalKickoff), game('d2', 2, 2, 4, divisionalKickoff)],
      bracket,
    })).resolves.toEqual({ outcome: 'MATCHES_UPDATED', sportEventId: event.id, matchNumbers: [4, 5] });
    expect((await matchesOf(event.id)).slice(3, 5)).toEqual([
      [4, seedRow(1), seedRow(6), divisionalKickoff.toISOString()],
      [5, seedRow(2), seedRow(4), divisionalKickoff.toISOString()],
    ]);
  });
});

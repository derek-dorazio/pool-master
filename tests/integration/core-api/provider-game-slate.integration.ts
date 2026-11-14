import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Sport, SportEventStatus } from '@poolmaster/shared/domain';
import { PrismaSportEventRepository, PrismaSportEventRoundRepository } from '../../../packages/core-api/src/adapters';
import { createSportEventServices } from '../../../packages/core-api/src/modules/events/wiring';
import type { ProviderScheduledGame } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { createRoundRows, createSportEventRow } from '../../support/sport-event-rows';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

// A synced league's game week takes its games from its provider (ADR 0011, #1728), against real
// Postgres: the draft's matches written through the bracket's own load, each side the field row
// of the team the provider names, and a released week's moved kickoff written to its match.

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
});

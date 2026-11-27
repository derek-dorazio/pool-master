/**
 * A player's roster row (#2025, plan §4) against real Postgres: one row per Season and player,
 * naming his team and position by id, every key held inside one sport league. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ParticipantType, Sport } from '@poolmaster/shared/domain';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { insertTestSportLeague } from '../../support/test-sport-league';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** A football league of the test's own with its current Season, a QB position, a team and a player. */
async function footballLeague(name: string) {
  const prisma = getPrisma();
  const league = await insertTestSportLeague(prisma, { sport: Sport.FOOTBALL, name: `${name} ${randomUUID().slice(0, 8)}` });
  const { currentSeasonId } = await prisma.sportLeague.findUniqueOrThrow({ where: { id: league.id }, select: { currentSeasonId: true } });
  if (currentSeasonId === null) throw new Error('the test league has no current Season');
  const position = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: league.id, code: 'QB', displayOrder: 1, isFieldEligible: true } });
  const participant = (participantName: string, participantType: ParticipantType) => prisma.participant.create({
    data: { sportLeagueId: league.id, name: participantName, participantType },
  });
  const team = await participant('Kansas City Chiefs', ParticipantType.TEAM);
  const player = await participant('Patrick Mahomes', ParticipantType.INDIVIDUAL);
  return { league, seasonId: currentSeasonId, position, team, player };
}

const SEEN = new Date('2027-09-01T12:00:00.000Z');

describe('a player\'s roster row', () => {
  it('names his team and position in the Season, and a team reads its players through it', async () => {
    const { league, seasonId, position, team, player } = await footballLeague('Roster League');
    const prisma = getPrisma();

    await prisma.sportLeagueSeasonParticipantTeam.create({
      data: { sportLeagueId: league.id, sportLeagueSeasonId: seasonId, participantId: player.id, teamParticipantId: team.id, sportLeaguePositionId: position.id, lastSeenAt: SEEN },
    });

    const players = await prisma.participant.findUniqueOrThrow({
      where: { id: team.id },
      select: { rosterPlayers: { select: { player: { select: { name: true } }, position: { select: { code: true } }, lastSeenAt: true } } },
    });
    expect(players.rosterPlayers).toEqual([{ player: { name: 'Patrick Mahomes' }, position: { code: 'QB' }, lastSeenAt: SEEN }]);
  });

  it('refuses a second row for the same player in one Season', async () => {
    const { league, seasonId, position, team, player } = await footballLeague('One Row League');
    const prisma = getPrisma();
    const row = { sportLeagueId: league.id, sportLeagueSeasonId: seasonId, participantId: player.id, teamParticipantId: team.id, sportLeaguePositionId: position.id, lastSeenAt: SEEN };

    await prisma.sportLeagueSeasonParticipantTeam.create({ data: row });

    await expect(prisma.sportLeagueSeasonParticipantTeam.create({ data: row })).rejects.toThrow(/Unique constraint/);
  });

  it('refuses a team, a position or a Season of another sport league', async () => {
    const home = await footballLeague('Home League');
    const away = await footballLeague('Away League');
    const prisma = getPrisma();
    const row = {
      sportLeagueId: home.league.id,
      sportLeagueSeasonId: home.seasonId,
      participantId: home.player.id,
      teamParticipantId: home.team.id,
      sportLeaguePositionId: home.position.id,
      lastSeenAt: SEEN,
    };

    await expect(prisma.sportLeagueSeasonParticipantTeam.create({ data: { ...row, teamParticipantId: away.team.id } }))
      .rejects.toThrow(/sport_league_season_participant_teams_team_fkey/);
    await expect(prisma.sportLeagueSeasonParticipantTeam.create({ data: { ...row, sportLeaguePositionId: away.position.id } }))
      .rejects.toThrow(/sport_league_season_participant_teams_position_fkey/);
    await expect(prisma.sportLeagueSeasonParticipantTeam.create({ data: { ...row, sportLeagueSeasonId: away.seasonId } }))
      .rejects.toThrow(/sport_league_season_participant_teams_season_fkey/);
    await expect(prisma.sportLeagueSeasonParticipantTeam.count({ where: { sportLeagueId: home.league.id } })).resolves.toBe(0);
  });
});

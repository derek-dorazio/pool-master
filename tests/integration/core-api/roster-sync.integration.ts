/**
 * The roster sync (#2025) against real Postgres: the league's current Season's roster rows, written
 * from a feed's roster through the Prisma repository, with the players they name. Only the provider
 * is stood in for. No mocks of the database.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { JobTrigger, ParticipantType, ProviderCode, Sport } from '@poolmaster/shared/domain';
import { PrismaParticipantProviderMappingRepository } from '../../../packages/core-api/src/adapters/prisma-participant-provider-mapping-repository';
import { PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters/prisma-sport-catalog-repositories';
import { PrismaSportLeagueRosterRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-roster-repository';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import type { ProviderRosterPlayer } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { LeagueRosterSync } from '../../../packages/core-api/src/modules/ingestion/roster/league-roster-sync';
import { expectSameStatementCount } from '../query-scaling';
import { inMemorySyncRuns } from '../../support/in-memory-sync-runs';
import { syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { insertTestSportLeague } from '../../support/test-sport-league';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** A synced football league of the test's own: a current Season, QB (eligible) and K (not), both mapped, and the Chiefs mapped from feed id 17. */
async function rosteredLeague() {
  const prisma = getPrisma();
  const league = await insertTestSportLeague(prisma, { sport: Sport.FOOTBALL, name: `Roster Sync ${randomUUID().slice(0, 8)}`, championshipYear: 2025 });
  const mappingId = await syncLeagueTo(prisma, league.id, 'nfl');
  const [seasonId] = await syncSeasonsTo(prisma, league.id, mappingId, [2026]);
  const provider = await prisma.provider.findUniqueOrThrow({ where: { code: ProviderCode.BALLDONTLIE }, select: { id: true } });
  for (const [code, isFieldEligible, displayOrder] of [['QB', true, 1], ['K', false, 2]] as const) {
    // poolmaster-allow-query-in-loop: two fixture positions
    const position = await prisma.sportLeaguePosition.create({ data: { sportLeagueId: league.id, code, displayOrder, isFieldEligible } });
    // poolmaster-allow-query-in-loop: two fixture positions
    await prisma.sportLeaguePositionProviderMapping.create({ data: { sportLeagueId: league.id, sportLeaguePositionId: position.id, sportLeagueProviderMappingId: mappingId, providerCode: code } });
  }
  const chiefs = await prisma.participant.create({ data: { sportLeagueId: league.id, name: 'Kansas City Chiefs', participantType: ParticipantType.TEAM } });
  await prisma.participantProviderMapping.create({
    data: { participantId: chiefs.id, sportLeagueId: league.id, participantType: ParticipantType.TEAM, providerId: provider.id, externalId: '17' },
  });
  return { league, seasonId, chiefs, providerId: provider.id };
}

function rosterSync(roster: () => ProviderRosterPlayer[]) {
  const prisma = getPrisma();
  const findings = { raiseUnmappedParticipants: jest.fn(async (..._input: unknown[]) => undefined), checkRunOutcome: jest.fn(async () => undefined) };
  const sync = new LeagueRosterSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    rosterSource: { listSeasonRoster: async () => roster() },
    rosters: new PrismaSportLeagueRosterRepository(prisma),
    findings,
    syncRuns: inMemorySyncRuns(),
    domainEvents: { collect: async () => ({ jobs: [], queued: () => undefined }) },
  });
  return { run: (sportLeagueId: string) => sync.run({ sportLeagueId }, { jobId: randomUUID(), trigger: JobTrigger.SCHEDULE }), findings };
}

const rowsOf = (sportLeagueSeasonId: string) => getPrisma().sportLeagueSeasonParticipantTeam.findMany({
  where: { sportLeagueSeasonId },
  select: { player: { select: { name: true, participantType: true } }, team: { select: { name: true } }, position: { select: { code: true } }, lastSeenAt: true },
  orderBy: { player: { name: 'asc' } },
});

describe('the roster sync', () => {
  it('rosters each player with an eligible position on a mapped team as a new player of the league, and leaves off the rest', async () => {
    const { league, seasonId } = await rosteredLeague();
    const { run } = rosterSync(() => [
      { externalId: '33', name: 'Patrick Mahomes', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB' },
      { externalId: '35', name: 'Harrison Butker', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'K' },
      { externalId: '36', name: 'Nick Bolton', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'LB' },
      { externalId: '39', name: 'Free Agent', teamExternalId: null, teamName: null, positionCode: 'QB' },
    ]);

    await run(league.id);

    expect(await rowsOf(seasonId)).toEqual([
      { player: { name: 'Patrick Mahomes', participantType: ParticipantType.INDIVIDUAL }, team: { name: 'Kansas City Chiefs' }, position: { code: 'QB' }, lastSeenAt: expect.any(Date) },
    ]);
    await expect(getPrisma().participantProviderMapping.count({ where: { sportLeagueId: league.id, participantType: ParticipantType.INDIVIDUAL } })).resolves.toBe(1);
  });

  it('writes a Season\'s first roster in the same statements for 2 new players as for 20', async () => {
    await expectSameStatementCount({
      seed: async (players) => {
        const { league, seasonId } = await rosteredLeague();
        const roster = Array.from({ length: players }, (_, index): ProviderRosterPlayer => (
          { externalId: String(100 + index), name: `Rookie ${String(index)}`, teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB' }
        ));
        return { league, seasonId, run: rosterSync(() => roster).run };
      },
      call: async ({ league, seasonId, run }) => {
        await run(league.id);
        return rowsOf(seasonId);
      },
      rowsShown: (rows) => rows.length,
    });
  });

  it('keeps a player the feed no longer lists, with the time it last listed them, and renames one it names differently', async () => {
    const { league, seasonId } = await rosteredLeague();
    let roster: ProviderRosterPlayer[] = [
      { externalId: '33', name: 'Patrick Mahomes', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB' },
      { externalId: '34', name: 'Carson Wentz', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB' },
    ];
    const { run } = rosterSync(() => roster);
    await run(league.id);
    const [, wentz] = await rowsOf(seasonId);

    roster = [{ externalId: '33', name: 'Patrick Mahomes II', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB' }];
    await run(league.id);

    const rows = await rowsOf(seasonId);
    expect(rows.map((row) => row.player.name)).toEqual(['Carson Wentz', 'Patrick Mahomes II']);
    expect(rows[0].lastSeenAt).toEqual(wentz.lastSeenAt);
    expect(rows[1].lastSeenAt.getTime()).toBeGreaterThanOrEqual(wentz.lastSeenAt.getTime());
    await expect(getPrisma().participant.count({ where: { sportLeagueId: league.id, participantType: ParticipantType.INDIVIDUAL } })).resolves.toBe(2);
  });

  it('leaves off a player whose team id is mapped to a player rather than a team, and raises an unmapped participant finding for it', async () => {
    const { league, seasonId, providerId } = await rosteredLeague();
    const prisma = getPrisma();
    const notATeam = await prisma.participant.create({ data: { sportLeagueId: league.id, name: 'Someone', participantType: ParticipantType.INDIVIDUAL } });
    await prisma.participantProviderMapping.create({
      data: { participantId: notATeam.id, sportLeagueId: league.id, participantType: ParticipantType.INDIVIDUAL, providerId, externalId: '50' },
    });
    const { run, findings } = rosterSync(() => [{ externalId: '51', name: 'Pat Doe', teamExternalId: '50', teamName: null, positionCode: 'QB' }]);

    await run(league.id);

    expect(await rowsOf(seasonId)).toEqual([]);
    expect(findings.raiseUnmappedParticipants).toHaveBeenCalledWith(expect.objectContaining({ participants: [{ externalId: '50', name: 'Pat Doe\'s team' }] }));
  });

  it('refuses to write a roster row whose team is not a TEAM participant of the league', async () => {
    const { league, seasonId, providerId } = await rosteredLeague();
    const prisma = getPrisma();
    const player = await prisma.participant.create({ data: { sportLeagueId: league.id, name: 'Pat Doe', participantType: ParticipantType.INDIVIDUAL } });
    const position = await prisma.sportLeaguePosition.findFirstOrThrow({ where: { sportLeagueId: league.id, code: 'QB' } });

    await expect(new PrismaSportLeagueRosterRepository(prisma).applyRoster({
      sportLeagueId: league.id,
      sportLeagueSeasonId: seasonId,
      providerId,
      newPlayers: [],
      renamedPlayers: [],
      newRows: [{ participantId: player.id, teamParticipantId: player.id, sportLeaguePositionId: position.id }],
      movedRows: [],
      seenPlayerIds: [player.id],
      seenAt: new Date(),
      jobs: [],
    })).rejects.toThrow('TEAM participant');
    expect(await rowsOf(seasonId)).toEqual([]);
  });

  it('keeps a rostered player out of the league\'s team lookups when the provider numbers them as it numbers a team', async () => {
    const { league, chiefs } = await rosteredLeague();
    const { run } = rosterSync(() => [{ externalId: '17', name: 'Player Seventeen', teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB' }]);
    await run(league.id);

    const mappings = await new PrismaParticipantProviderMappingRepository(getPrisma())
      .findByProviderExternalIds(ProviderCode.BALLDONTLIE, { sportLeagueId: league.id }, ['17']);

    expect(mappings.map((mapping) => mapping.participantId)).toEqual([chiefs.id]);
  });
});

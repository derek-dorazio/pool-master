import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { RosterIds, RosterPositionCode, RosterWrite, SportLeagueRosterRepository, SyncableSportLeagueSeason } from '@poolmaster/shared/db';
import { JobTrigger, ProviderSyncKind, ProviderSyncRunStatus, type SportLeague } from '@poolmaster/shared/domain';
import { PermanentBackgroundJobError } from '../../../packages/core-api/src/modules/background-jobs/background-job-runner';
import { ProviderSeasonScheduleError } from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import type { ProviderRosterPlayer } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { LeagueRosterSync } from '../../../packages/core-api/src/modules/ingestion/roster/league-roster-sync';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { inMemorySyncRuns } from '../../support/in-memory-sync-runs';

// A sport league's roster sync (#2025): which players its current Season's roster rows name, with
// their team and position, read by the Season's provider id. That the rows land, one per Season and
// player, with their composite keys, is the repository's, proved against Postgres in
// roster-sync.integration.ts.

const NOW = new Date('2027-06-15T12:00:00Z');
const KC = 'team-kc';
const QB = 'position-qb';
const K = 'position-k';

function season(overrides: Partial<SyncableSportLeagueSeason> = {}): SyncableSportLeagueSeason {
  return {
    id: randomUUID(),
    sportLeagueId: 'league',
    name: '2026',
    championshipYear: 2027,
    startsAt: new Date('2026-09-01T00:00:00Z'),
    endsAt: new Date('2027-02-28T00:00:00Z'),
    providerSeasonId: '2026',
    ...overrides,
  };
}

function player(externalId: string, overrides: Partial<ProviderRosterPlayer> = {}): ProviderRosterPlayer {
  return { externalId, name: `Player ${externalId}`, teamExternalId: '17', teamName: 'Kansas City Chiefs', positionCode: 'QB', ...overrides };
}

const POSITION_CODES: RosterPositionCode[] = [
  { providerCode: 'QB', sportLeaguePositionId: QB, isFieldEligible: true },
  { providerCode: 'K', sportLeaguePositionId: K, isFieldEligible: false },
];

function build(options: {
  roster?: ProviderRosterPlayer[];
  seasons?: SyncableSportLeagueSeason[];
  current?: 'first' | 'none';
  ids?: Partial<RosterIds>;
  listSeasonRoster?: jest.Mock;
}) {
  const seasons = options.seasons ?? [season()];
  const league: SportLeague = buildSportLeague({
    id: randomUUID(),
    name: 'NFL',
    currentSeasonId: options.current === 'none' ? null : seasons[0].id,
    selectedProviderMapping: buildProviderMapping({ id: randomUUID(), providerLeagueCode: 'nfl' }),
  });
  const writes: RosterWrite[] = [];
  const rosters: SportLeagueRosterRepository = {
    findPositionCodes: jest.fn(async () => POSITION_CODES),
    findRosterIds: jest.fn(async () => ({
      providerId: 'provider-row',
      teamIdByExternalId: new Map([['17', KC]]),
      playerByExternalId: new Map(),
      rowByPlayerId: new Map(),
      ...options.ids,
    })),
    applyRoster: jest.fn(async (write: RosterWrite) => { writes.push(write); }),
  };
  const listSeasonRoster = options.listSeasonRoster ?? jest.fn(async () => options.roster ?? []);
  const findings = {
    raiseUnmappedParticipants: jest.fn(async (..._input: unknown[]) => undefined),
    checkRunOutcome: jest.fn(async () => undefined),
  };
  const syncRuns = inMemorySyncRuns();
  const collect = jest.fn(async (..._input: unknown[]) => ({ jobs: [], queued: jest.fn() }));
  const sync = new LeagueRosterSync({
    sportLeagues: { findById: jest.fn(async () => league) },
    seasons: { findForSync: jest.fn(async () => seasons) },
    rosterSource: { listSeasonRoster },
    rosters,
    findings,
    syncRuns,
    domainEvents: { collect },
    now: () => NOW,
  });
  const run = () => sync.run({ sportLeagueId: league.id }, { jobId: randomUUID(), trigger: JobTrigger.SCHEDULE });
  return { run, league, seasons, writes, rosters, listSeasonRoster, findings, syncRuns, collect };
}

describe('LeagueRosterSync', () => {
  it('reads the roster of the league\'s current Season by the provider\'s id for it, not a season worked out from the clock', async () => {
    const later = season({ name: '2027', providerSeasonId: '2027' });
    const current = season({ providerSeasonId: '2026' });
    const { run, listSeasonRoster, league } = build({ seasons: [current, later] });

    await run();

    expect(listSeasonRoster).toHaveBeenCalledWith(league.id, '2026');
  });

  it('writes a row naming each player\'s team and eligible position, and a new participant for a player named for the first time', async () => {
    const { run, writes, seasons, collect } = build({ roster: [player('33', { name: 'Patrick Mahomes' })] });

    const outcome = await run();

    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(write.sportLeagueSeasonId).toBe(seasons[0].id);
    expect(write.newPlayers).toEqual([{ participantId: expect.any(String), externalId: '33', name: 'Patrick Mahomes' }]);
    expect(write.newRows).toEqual([{ participantId: write.newPlayers[0].participantId, teamParticipantId: KC, sportLeaguePositionId: QB }]);
    expect(write.movedRows).toEqual([]);
    expect(write.seenPlayerIds).toEqual([write.newPlayers[0].participantId]);
    expect(write.seenAt).toEqual(NOW);
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ externalIds: ['33'], providerId: 'provider-row' }));
    expect(outcome.result).toMatchObject({ listed: 1, rostered: 1, playersCreated: 1, rowsChanged: 1 });
  });

  it('leaves off a player whose position is not eligible for a field, not one of the league\'s, or not sent, and counts them', async () => {
    const { run, writes } = build({
      roster: [player('35', { positionCode: 'K' }), player('36', { positionCode: 'LB' }), player('37', { positionCode: null }), player('38')],
    });

    const outcome = await run();

    expect(writes[0].newPlayers.map((each) => each.externalId)).toEqual(['38']);
    expect(outcome.result).toMatchObject({ listed: 4, rostered: 1, notEligible: 3 });
  });

  it('leaves off a player on no team, and one whose team is mapped to no team of the league with an unmapped participant finding named for the team as the feed names it', async () => {
    const { run, writes, findings, league } = build({
      roster: [
        player('39', { teamExternalId: null }),
        player('40', { teamExternalId: '99', teamName: 'Buffalo Bills', name: 'Pat Doe' }),
        player('41', { teamExternalId: '98', teamName: null, name: 'Sam Roe' }),
      ],
    });

    const outcome = await run();

    expect(writes[0].newRows).toEqual([]);
    expect(findings.raiseUnmappedParticipants).toHaveBeenCalledWith({
      sportLeagueId: league.id,
      providerSourceId: league.selectedProviderMapping?.providerId,
      participants: [{ externalId: '99', name: 'Buffalo Bills' }, { externalId: '98', name: 'Sam Roe\'s team' }],
    });
    expect(outcome.result).toMatchObject({ listed: 3, rostered: 0, notEligible: 1, teamUnmapped: 2 });
  });

  it('keeps a known player\'s row as it is when the team and position have not changed, renames them when the feed does, and moves them on a trade', async () => {
    const same = { participantId: 'p-same', name: 'Player 41' };
    const renamed = { participantId: 'p-renamed', name: 'Old Name' };
    const traded = { participantId: 'p-traded', name: 'Player 43' };
    const { run, writes } = build({
      roster: [player('41'), player('42', { name: 'New Name' }), player('43')],
      ids: {
        playerByExternalId: new Map([['41', same], ['42', renamed], ['43', traded]]),
        rowByPlayerId: new Map([
          ['p-same', { teamParticipantId: KC, sportLeaguePositionId: QB }],
          ['p-renamed', { teamParticipantId: KC, sportLeaguePositionId: QB }],
          ['p-traded', { teamParticipantId: 'team-buf', sportLeaguePositionId: QB }],
        ]),
      },
    });

    await run();

    expect(writes[0].newPlayers).toEqual([]);
    expect(writes[0].renamedPlayers).toEqual([{ participantId: 'p-renamed', name: 'New Name' }]);
    expect(writes[0].newRows).toEqual([]);
    expect(writes[0].movedRows).toEqual([{ participantId: 'p-traded', teamParticipantId: KC, sportLeaguePositionId: QB }]);
    expect(writes[0].seenPlayerIds).toEqual(['p-same', 'p-renamed', 'p-traded']);
  });

  it('records a completed ROSTER run with what it wrote', async () => {
    const { run, syncRuns } = build({ roster: [player('33')] });

    await run();

    expect(syncRuns.rows).toEqual([expect.objectContaining({ kind: ProviderSyncKind.ROSTER, status: ProviderSyncRunStatus.COMPLETED, changedCount: 2 })]);
  });

  it('reads nothing when the league has no current Season, or the provider has no id for it, and says so on its run', async () => {
    const noCurrent = build({ current: 'none' });
    await noCurrent.run();
    expect(noCurrent.listSeasonRoster).not.toHaveBeenCalled();
    expect(noCurrent.syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.COMPLETED, summary: expect.stringContaining('no current Season') });

    const unmapped = build({ seasons: [season({ providerSeasonId: null })] });
    await unmapped.run();
    expect(unmapped.listSeasonRoster).not.toHaveBeenCalled();
  });

  it('fails for good when the provider\'s plan refuses the league, and records the run as failed', async () => {
    const refused = jest.fn(async () => { throw new ProviderSeasonScheduleError('Plan refuses NFL', 'PROVIDER_LEAGUE_REFUSED', 422); });
    const { run, syncRuns, writes } = build({ listSeasonRoster: refused });

    await expect(run()).rejects.toBeInstanceOf(PermanentBackgroundJobError);
    expect(writes).toEqual([]);
    expect(syncRuns.rows[0]).toMatchObject({ status: ProviderSyncRunStatus.FAILED, summary: 'Failed: Plan refuses NFL' });
  });

  it('lets the runner try again when the provider is unreachable', async () => {
    const down = jest.fn(async () => { throw new Error('socket hang up'); });
    const { run } = build({ listSeasonRoster: down });

    const failure = await run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PermanentBackgroundJobError);
  });
});

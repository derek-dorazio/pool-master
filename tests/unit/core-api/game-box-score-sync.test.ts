import type { GamePlayerStatRepository, GamePlayerStatRow, StatGame } from '@poolmaster/shared/db';
import { ProviderSyncFindingKind, ProviderSyncFindingSeverity, SportStat, type ProviderSyncFindingRaise, type SportLeague } from '@poolmaster/shared/domain';
import { ProviderSeasonScheduleError } from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
import type { ProviderPlayerGameStats } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { GameBoxScoreSync } from '../../../packages/core-api/src/modules/ingestion/stats/game-box-score-sync';
import { buildProviderMapping, buildSportLeague } from '../../factories';
import { balldontlieTestProvider } from '../../support/balldontlie-provider-rows';

/**
 * A league's box score read (#2026): a league must be on a provider plan with player stats, or it
 * reads nothing and raises one PROVIDER_PLAN_HAS_NO_STATS error, which a read that succeeds
 * resolves; otherwise its Games' provider ids are read and written.
 */

const GAME: StatGame = {
  sportEventRoundMatchGameId: 'game-1',
  sportEventRoundMatchId: 'match-1',
  sportEventId: 'event-1',
  sportLeagueId: 'league-nfl',
  sportLeagueSeasonId: 'season-2026',
  providerGameId: '7001',
  sides: [{ sportEventRoundMatchSideId: 'side-1', participantId: 'team-chiefs' }, { sportEventRoundMatchSideId: 'side-2', participantId: 'team-bills' }],
};

function harness(options: { hasPlayerStats?: boolean; source?: (sportLeagueId: string, ids: readonly string[]) => Promise<ProviderPlayerGameStats[]>; league?: SportLeague | null } = {}) {
  const league = options.league === undefined
    ? buildSportLeague({ id: 'league-nfl', selectedProviderMapping: buildProviderMapping({ providerLeagueCode: 'nfl' }) })
    : options.league;
  const asked: Array<readonly string[]> = [];
  const raised: Array<Omit<ProviderSyncFindingRaise, 'providerId'>> = [];
  const resolved: ProviderSyncFindingKind[] = [];
  let rows: GamePlayerStatRow[] = [];
  const stats: GamePlayerStatRepository = {
    findStatGames: () => Promise.resolve([GAME, { ...GAME, sportEventRoundMatchGameId: 'game-unmapped', providerGameId: null }]),
    findStatPlayers: () => Promise.resolve(new Map([['33', { participantId: 'mahomes', teamParticipantId: 'team-chiefs' }]])),
    findGameStats: () => Promise.resolve(rows),
    replaceGameStats: (input) => { rows = [...input.rows]; return Promise.resolve(); },
  };
  const sync = new GameBoxScoreSync({
    sportLeagues: { findById: () => Promise.resolve(league) },
    providers: { all: () => [balldontlieTestProvider({ hasPlayerStats: options.hasPlayerStats ?? true })] },
    boxScoreSource: {
      listBoxScores: (sportLeagueId, ids) => {
        asked.push(ids);
        return options.source?.(sportLeagueId, ids) ?? Promise.resolve([{ providerGameId: '7001', playerExternalId: '33', playerName: 'Patrick Mahomes', stats: [{ stat: SportStat.PASSING_YARDS, value: 291 }] }]);
      },
    },
    stats,
    findings: {
      raiseOfSource: (_source, raises) => { raised.push(...raises); return Promise.resolve(); },
      raiseUnmappedParticipants: () => Promise.resolve(),
      resolveOfSource: (_source, input) => { resolved.push(input.kind); return Promise.resolve(1); },
    },
  });
  return { sync, asked, raised, resolved, rows: () => rows };
}

const PLAN_HAS_NO_STATS: Omit<ProviderSyncFindingRaise, 'providerId'> = {
  kind: ProviderSyncFindingKind.PROVIDER_PLAN_HAS_NO_STATS,
  severity: ProviderSyncFindingSeverity.ERROR,
  sportLeagueId: 'league-nfl',
  sportEventId: null,
  providerValue: null,
  providerValueName: null,
};

describe('GameBoxScoreSync', () => {
  it('reads the box scores of the Games its provider has ids for, writes them, and resolves the stats-plan finding', async () => {
    const { sync, asked, resolved, rows } = harness();

    const result = await sync.syncGames('league-nfl', ['game-1', 'game-unmapped']);

    expect(result).toEqual({ planHasStats: true, gamesRead: 1, gamesChanged: 1, rowsWritten: 1, playersNotInGame: 0, playersUnmapped: 0 });
    expect(asked).toEqual([['7001']]);
    expect(rows().map((row) => `${row.participantId}:${row.sportEventRoundMatchSideId}:${row.stat}=${String(row.value)}`)).toEqual(['mahomes:side-1:PASSING_YARDS=291']);
    expect(resolved).toEqual([ProviderSyncFindingKind.PROVIDER_PLAN_HAS_NO_STATS]);
  });

  it('reads nothing and raises the stats-plan error when the league\'s provider plan has no player stats', async () => {
    const { sync, asked, raised, rows } = harness({ hasPlayerStats: false });

    await expect(sync.syncGames('league-nfl', ['game-1'])).resolves.toEqual({ planHasStats: false });

    expect(asked).toEqual([]);
    expect(rows()).toEqual([]);
    expect(raised).toEqual([PLAN_HAS_NO_STATS]);
  });

  it('writes nothing and raises the stats-plan error when the provider refuses the league\'s stats reads', async () => {
    const { sync, raised, resolved, rows } = harness({ source: () => Promise.reject(new ProviderSeasonScheduleError('refused', 'PROVIDER_LEAGUE_REFUSED', 422)) });

    await expect(sync.syncGames('league-nfl', ['game-1'])).resolves.toEqual({ planHasStats: false });

    expect(rows()).toEqual([]);
    expect(raised).toEqual([PLAN_HAS_NO_STATS]);
    expect(resolved).toEqual([]);
  });

  it('lets any other read failure through for the caller to retry', async () => {
    const { sync, raised } = harness({ source: () => Promise.reject(new Error('socket hang up')) });

    await expect(sync.syncGames('league-nfl', ['game-1'])).rejects.toThrow('socket hang up');
    expect(raised).toEqual([]);
  });

  it('refuses a league that does not exist or that no provider syncs', async () => {
    await expect(harness({ league: null }).sync.syncGames('league-nfl', [])).rejects.toThrow('was not found');
    await expect(harness({ league: buildSportLeague({ selectedProviderMapping: null }) }).sync.syncGames('league-nfl', [])).rejects.toThrow('No provider syncs');
  });
});

import type { GamePlayerStatRepository, GamePlayerStatRow, StatGame, StatPlayer } from '../../../packages/shared/db';
import { ProviderCode, ProviderSyncFindingKind, ProviderSyncFindingSeverity, SportStat, type ProviderSyncFindingRaise } from '../../../packages/shared/domain';
import { GamePlayerStatWriter } from '../../../packages/core-api/src/modules/ingestion/stats/game-player-stat-writer';
import type { ProviderPlayerGameStats } from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { UnmappedFeedParticipant } from '../../../packages/core-api/src/modules/ingestion/findings/provider-sync-finding-service';

/**
 * The box score writer (#2026): each line goes on its player's own side, else their Season roster
 * team's side, of the Game's Match, the same rule in every sport; a player who plays neither is
 * refused with a finding; only Games whose rows changed are rewritten.
 */

const SEASON = 'season-2026';
const CHIEFS = 'team-chiefs';
const BILLS = 'team-bills';
const RAVENS = 'team-ravens';

function headToHeadGame(id: string, providerGameId: string | null, home = CHIEFS, away = BILLS): StatGame {
  return {
    sportEventRoundMatchGameId: id,
    sportEventRoundMatchId: `match-${id}`,
    sportEventId: 'event-week-12',
    sportLeagueId: 'league-nfl',
    sportLeagueSeasonId: SEASON,
    providerGameId,
    sides: [
      { sportEventRoundMatchSideId: `side-1-${id}`, participantId: home },
      { sportEventRoundMatchSideId: `side-2-${id}`, participantId: away },
    ],
  };
}

const line = (providerGameId: string, playerExternalId: string, stats: ProviderPlayerGameStats['stats'], playerName: string | null = null): ProviderPlayerGameStats => ({ providerGameId, playerExternalId, playerName, stats });

/** The writer's port over arrays, counting its reads and writes. */
class InMemoryStats implements GamePlayerStatRepository {
  rows: GamePlayerStatRow[] = [];
  readonly calls: string[] = [];
  constructor(private readonly players: ReadonlyMap<string, StatPlayer>) {}

  findStatGames(): Promise<StatGame[]> {
    throw new Error('The writer is handed its Games');
  }

  findStatPlayers(input: { playerExternalIds: readonly string[] }): Promise<Map<string, StatPlayer>> {
    this.calls.push('findStatPlayers');
    return Promise.resolve(new Map(input.playerExternalIds.flatMap((id) => {
      const player = this.players.get(id);
      return player === undefined ? [] : [[id, player] as const];
    })));
  }

  findGameStats(gameIds: readonly string[]): Promise<GamePlayerStatRow[]> {
    this.calls.push('findGameStats');
    return Promise.resolve(this.rows.filter((row) => gameIds.includes(row.sportEventRoundMatchGameId)));
  }

  replaceGameStats(input: { sportEventRoundMatchGameIds: readonly string[]; rows: readonly GamePlayerStatRow[] }): Promise<void> {
    this.calls.push(`replaceGameStats:${input.sportEventRoundMatchGameIds.join(',')}`);
    this.rows = [...this.rows.filter((row) => !input.sportEventRoundMatchGameIds.includes(row.sportEventRoundMatchGameId)), ...input.rows];
    return Promise.resolve();
  }
}

function harness() {
  const stats = new InMemoryStats(new Map<string, StatPlayer>([
    ['33', { participantId: 'mahomes', teamParticipantId: CHIEFS }],
    ['17', { participantId: 'allen', teamParticipantId: BILLS }],
    ['8', { participantId: 'lamar', teamParticipantId: RAVENS }],
    ['99', { participantId: 'rookie', teamParticipantId: null }],
    ['2', { participantId: 'mcilroy', teamParticipantId: null }],
  ]));
  const raised: Array<Omit<ProviderSyncFindingRaise, 'providerId'>> = [];
  const unmapped: UnmappedFeedParticipant[] = [];
  const writer = new GamePlayerStatWriter({
    stats,
    findings: {
      raiseOfSource: (_source, raises) => { raised.push(...raises); return Promise.resolve(); },
      raiseUnmappedParticipants: (input) => { unmapped.push(...input.participants); return Promise.resolve(); },
    },
  });
  const write = (games: StatGame[], lines: ProviderPlayerGameStats[]) => writer.write({ sportLeagueId: 'league-nfl', providerCode: ProviderCode.BALLDONTLIE, providerSourceId: 'balldontlie', games, lines });
  return { stats, raised, unmapped, write };
}

describe('GamePlayerStatWriter', () => {
  const week = [headToHeadGame('game-1', '7001'), headToHeadGame('game-2', '7002', RAVENS, 'team-steelers')];
  const box = [
    line('7001', '33', [{ stat: SportStat.PASSING_TOUCHDOWNS, value: 3 }, { stat: SportStat.PASSING_YARDS, value: 291 }]),
    line('7001', '17', [{ stat: SportStat.RUSHING_TOUCHDOWNS, value: 1 }]),
    line('7002', '8', [{ stat: SportStat.RUSHING_YARDS, value: 120 }]),
  ];

  it('writes every line onto its Game in a fixed three calls, however many Games and players', async () => {
    const { stats, write } = harness();

    const counts = await write(week, box);

    expect(counts).toEqual({ gamesRead: 2, gamesChanged: 2, rowsWritten: 4, playersNotInGame: 0, playersUnmapped: 0 });
    expect(stats.rows.map((row) => `${row.sportEventRoundMatchGameId}:${row.participantId}:${row.stat}=${String(row.value)}`)).toEqual([
      'game-1:mahomes:PASSING_TOUCHDOWNS=3', 'game-1:mahomes:PASSING_YARDS=291', 'game-1:allen:RUSHING_TOUCHDOWNS=1', 'game-2:lamar:RUSHING_YARDS=120',
    ]);
    expect(stats.calls).toEqual(['findStatPlayers', 'findGameStats', 'replaceGameStats:game-1,game-2']);
  });

  it('rewrites only the Game whose box score changed, and none when the feed says the same again', async () => {
    const { stats, write } = harness();
    await write(week, box);
    stats.calls.length = 0;

    await write(week, box);
    expect(stats.calls).toEqual(['findStatPlayers', 'findGameStats', 'replaceGameStats:']);

    const corrected = await write(week, [box[0], box[1], line('7002', '8', [{ stat: SportStat.RUSHING_YARDS, value: 121 }])]);
    expect(corrected).toMatchObject({ gamesChanged: 1, rowsWritten: 1 });
    expect(stats.rows.find((row) => row.participantId === 'lamar')?.value).toBe(121);
  });

  it('drops a stat the feed no longer sends for a Game it sent a box score for', async () => {
    const { stats, write } = harness();
    await write(week, box);

    await write(week, [line('7001', '33', [{ stat: SportStat.PASSING_YARDS, value: 291 }]), box[1]]);

    expect(stats.rows.filter((row) => row.sportEventRoundMatchGameId === 'game-1').map((row) => row.stat)).toEqual([SportStat.PASSING_YARDS, SportStat.RUSHING_TOUCHDOWNS]);
    expect(stats.rows.filter((row) => row.sportEventRoundMatchGameId === 'game-2')).toHaveLength(1);
  });

  it('places a player on their Season roster team\'s side of the Match', async () => {
    const { stats, write } = harness();

    await write([week[0]], [box[0], box[1]]);

    expect(stats.rows.map((row) => `${row.participantId}:${row.sportEventRoundMatchSideId}`)).toEqual(['mahomes:side-1-game-1', 'mahomes:side-1-game-1', 'allen:side-2-game-1']);
  });

  it('refuses a stat row whose team is not a side of the Game\'s Match, and a player with no roster row in the Season', async () => {
    const { stats, raised, write } = harness();

    const counts = await write([week[0]], [line('7001', '8', [{ stat: SportStat.RUSHING_YARDS, value: 80 }]), line('7001', '99', [{ stat: SportStat.RECEPTIONS, value: 1 }])]);

    expect(counts).toMatchObject({ playersNotInGame: 2, rowsWritten: 0 });
    expect(stats.rows).toEqual([]);
    expect(raised.map((finding) => finding.providerValue)).toEqual(['8', '99']);
  });

  it('places a player who is a side of the Match themselves on their own side, as a golfer or a driver is, with no roster row needed', async () => {
    const { stats, write } = harness();
    const field: StatGame = { ...week[0], sides: [{ sportEventRoundMatchSideId: 'side-scheffler', participantId: 'scheffler' }, { sportEventRoundMatchSideId: 'side-mcilroy', participantId: 'mcilroy' }] };

    await write([field], [line('7001', '2', [{ stat: SportStat.POINTS, value: 1 }])]);

    expect(stats.rows.map((row) => row.sportEventRoundMatchSideId)).toEqual(['side-mcilroy']);
  });

  it('takes a stat the feed names twice for a player in one Game at its last word', async () => {
    const { stats, write } = harness();

    await write([week[0]], [line('7001', '33', [{ stat: SportStat.PASSING_YARDS, value: 280 }, { stat: SportStat.PASSING_YARDS, value: 291 }])]);

    expect(stats.rows.map((row) => row.value)).toEqual([291]);
  });

  it('refuses a player whose team plays neither side of the Game with one warning per event and player, and writes the rest', async () => {
    const { stats, raised, write } = harness();

    const counts = await write([week[0]], [box[0], line('7001', '8', [{ stat: SportStat.RUSHING_YARDS, value: 80 }], 'Lamar Jackson'), line('7001', '8', [{ stat: SportStat.RUSHING_TOUCHDOWNS, value: 1 }], 'Lamar Jackson')]);

    expect(counts).toMatchObject({ playersNotInGame: 1, rowsWritten: 2 });
    expect(stats.rows.map((row) => row.participantId)).toEqual(['mahomes', 'mahomes']);
    expect(raised).toEqual([{
      kind: ProviderSyncFindingKind.BOX_SCORE_PLAYER_NOT_IN_GAME,
      severity: ProviderSyncFindingSeverity.WARNING,
      sportLeagueId: 'league-nfl',
      sportEventId: 'event-week-12',
      providerValue: '8',
      providerValueName: 'Lamar Jackson',
    }]);
  });

  it('raises an unmapped participant for a feed id no player is mapped from, once', async () => {
    const { unmapped, write } = harness();

    const counts = await write([week[0]], [line('7001', '404', [{ stat: SportStat.RECEPTIONS, value: 2 }], 'New Guy'), line('7001', '404', [], 'New Guy')]);

    expect(counts).toMatchObject({ playersUnmapped: 1, rowsWritten: 0 });
    expect(unmapped).toEqual([{ externalId: '404', name: 'New Guy' }]);
  });

  it('keeps the rows of a Game the feed sent no line for, since an empty answer is no correction', async () => {
    const { stats, write } = harness();
    await write(week, box);

    await write(week, [box[2]]);

    expect(stats.rows.filter((row) => row.sportEventRoundMatchGameId === 'game-1')).toHaveLength(3);
  });

  it('ignores a line for a game it was not asked to write, and a Game with no provider id', async () => {
    const { stats, write } = harness();

    const counts = await write([headToHeadGame('game-1', null)], box);

    expect(counts).toMatchObject({ gamesRead: 0, gamesChanged: 0 });
    expect(stats.calls).toEqual(['findGameStats', 'replaceGameStats:']);
  });
});

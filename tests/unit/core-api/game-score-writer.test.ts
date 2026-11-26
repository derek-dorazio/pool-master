import { BackgroundJobType, MatchResultSource, MatchSide, MatchStatus, ProviderCode, ProviderGameState, type SportEventRoundMatch, type BackgroundJobRequest, type SportEventRoundMatchGame } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { MatchLiveScoreWrite, ProviderMappedGame, SportEventRoundMatchGameSync } from '@poolmaster/shared/db';
import { writeGameScores, type GameScoreWriterDeps } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/game-score-writer';
import { SportEventError } from '../../../packages/core-api/src/modules/events/errors';
import { bracketMatches } from '../../support/bracket-fixtures';
import { bracketRoundSlots } from '../../support/round-slots';
import { expectDefined } from '../../support/expect-defined';
import { fakeLogger } from '../../support/fake-logger';
import { testDomainEvents } from '../../support/domain-events';

// A provider's final for a match's Game is written through the admin's result path (#1496); a
// provider game id is the Game it is mapped to (#2007).
// Field rows `sep-<team>` play for participants `p-<team>`; the provider calls the teams `bdl-<team>`.

const EVENT_ID = 'event-1';
/** A league that plays single games in every round. */
const EVENT = { id: EVENT_ID, rounds: null };

/** The provider game id each match's Game 1 is mapped to, by match id; null while it has none. */
const LINKS = new Map<string, string | null>();
beforeEach(() => LINKS.clear());

function linked(match: SportEventRoundMatch, providerGameId: string | null, overrides: Partial<SportEventRoundMatch> = {}): SportEventRoundMatch {
  LINKS.set(match.id, providerGameId);
  return { ...match, ...overrides };
}

/** A match's Game 1 as stored: every match has one. */
function gameOne(match: SportEventRoundMatch): SportEventRoundMatchGame {
  return {
    id: `${match.id}-g1`, sportEventId: match.sportEventId, sportEventRoundMatchId: match.id, sportEventSlotId: 'event-slot-1', gameNumber: 1,
    scheduledDate: null, status: MatchStatus.SCHEDULED, winnerSide: null, homeScore: null, awayScore: null, completedAt: null,
    movedToGameId: null, lastProviderNotificationAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  };
}

function bracket(): SportEventRoundMatch[] {
  const [first, second, third] = bracketMatches(EVENT_ID, [
    { matchNumber: 1, round: 1, home: 'sep-KC', away: 'sep-BUF' },
    { matchNumber: 2, round: 1, home: 'sep-PHI', away: 'sep-DAL' },
    { matchNumber: 3, round: 2, home: null, away: null },
  ]);
  return [linked(first, 'g1'), linked(second, 'g2'), linked(third, 'g3')];
}

function game(providerGameId: string, home: string, away: string, homeScore: number | null, awayScore: number | null, state: ProviderGameState = ProviderGameState.FINAL): GameScoreUpdate {
  return { providerGameId, homeTeamExternalId: `bdl-${home}`, awayTeamExternalId: `bdl-${away}`, homeScore, awayScore, state };
}

/** A series game: `game`, numbered in its series. */
function nth(gameNumber: number, each: GameScoreUpdate): GameScoreUpdate {
  return { ...each, gameNumber };
}

/** The provider ids one sync mapped, as `[Game id, provider id]`. */
function mappedOf(applySync: jest.Mock<Promise<void>, [SportEventRoundMatchGameSync, (readonly BackgroundJobRequest[])?]>): [string, string][] {
  return applySync.mock.calls.flatMap(([sync]) => sync.mapped.map((each): [string, string] => [each.sportEventRoundMatchGameId, each.externalId]));
}

function writer(matches: SportEventRoundMatch[], unmappedTeams: readonly string[] = [], elsewhere: readonly ProviderMappedGame[] = []) {
  const recordResult = jest.fn<ReturnType<GameScoreWriterDeps['results']['recordResult']>, Parameters<GameScoreWriterDeps['results']['recordResult']>>()
    .mockResolvedValue([]);
  const findByIds = jest.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, participantId: id.replace('sep-', 'p-') })));
  const findByProviderExternalIds = jest.fn(async (providerId: string, _scope: unknown, ids: readonly string[]) => ids
    .filter((id) => !unmappedTeams.includes(id))
    .map((externalId) => ({ id: `map-${externalId}`, providerId, externalId, participantId: externalId.replace('bdl-', 'p-') })));
  const logger = fakeLogger();
  const applySync = jest.fn<Promise<void>, [SportEventRoundMatchGameSync, (readonly BackgroundJobRequest[])?]>().mockResolvedValue();
  const applyLiveScores = jest.fn<Promise<void>, [readonly MatchLiveScoreWrite[]]>().mockResolvedValue();
  const games = {
    findBySportEvent: jest.fn(async (): Promise<ProviderMappedGame[]> => matches.map((match) => ({ game: gameOne(match), externalId: LINKS.get(match.id) ?? null }))),
    findByProviderExternalIds: jest.fn(async (_code: string, ids: readonly string[]) => elsewhere.filter((each) => each.externalId !== null && ids.includes(each.externalId))),
    applySync,
  };
  const deps = {
    providerId: 'balldontlie',
    matches: { findBySportEvent: jest.fn(async () => matches), applyLiveScores },
    games,
    eventParticipants: { findByIds },
    mappings: { findByProviderExternalIds },
    results: { recordResult },
    domainEvents: testDomainEvents(),
    now: () => NOW,
    logger,
  } as unknown as GameScoreWriterDeps;
  return { deps, recordResult, findByIds, findByProviderExternalIds, applySync, applyLiveScores, logger };
}

const NOW = new Date('2027-01-10T20:00:00.000Z');

describe('writeGameScores', () => {
  it('records a final game\'s winner and score on the match linked to it, through the admin\'s result path', async () => {
    const { deps, recordResult } = writer(bracket());

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
    expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 1, updatesSkipped: 0 });
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 1, updated: 1 });
    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      entityType: 'SportEventRoundMatch', disposition: 'UPDATED', providerId: 'balldontlie', externalId: 'g1', internalId: 'm1', name: 'Round 1 match 1',
      before: { winnerSide: null, homeScore: null, awayScore: null }, after: { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 },
    });
  });

  it('scores the right sides when the provider lists the match\'s teams the other way round', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'BUF', 'KC', 24, 27)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
  });

  it('records an away win, and level scores as a tie for the result service to accept or refuse', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 10, 13), game('g2', 'PHI', 'DAL', 20, 20)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.AWAY, homeScore: 10, awayScore: 13 });
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 2 }, { winnerSide: null, homeScore: 20, awayScore: 20 });
  });

  it('writes nothing for games not under way on matches with no live score, and reads nothing while every game is linked', async () => {
    const matches = bracket();
    matches[1] = { ...matches[1], status: MatchStatus.POSTPONED };
    const { deps, recordResult, findByIds, findByProviderExternalIds, applySync, applyLiveScores } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED),
      game('g2', 'PHI', 'DAL', null, null, ProviderGameState.POSTPONED),
    ]);

    expect(recordResult).not.toHaveBeenCalled();
    expect(findByIds).not.toHaveBeenCalled();
    expect(findByProviderExternalIds).not.toHaveBeenCalled();
    expect(mappedOf(applySync)).toEqual([]);
    expect(applyLiveScores).toHaveBeenCalledWith([]);
    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 0, updatesSkipped: 2 });
    expect(result.writeDiagnostics.summary.total).toBe(0);
  });

  it('puts a live game\'s score on its match from the match\'s sides, deciding nothing, and writes it once', async () => {
    const matches = bracket();
    const { deps, recordResult, applyLiveScores } = writer(matches);

    // The provider lists Buffalo at home; the match has Kansas City at home.
    const result = await writeGameScores(deps, EVENT, [game('g1', 'BUF', 'KC', 3, 7, ProviderGameState.IN_PROGRESS)]);
    matches[0] = { ...matches[0], status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 3 };
    const again = await writeGameScores(deps, EVENT, [game('g1', 'BUF', 'KC', 3, 7, ProviderGameState.IN_PROGRESS)]);

    expect(recordResult).not.toHaveBeenCalled();
    expect(applyLiveScores.mock.calls).toEqual([
      [[{ id: 'm1', status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 3 }]],
      [[]],
    ]);
    expect(result).toMatchObject({ updatesPersisted: 1, updatesSkipped: 0 });
    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      name: 'Round 1 match 1',
      disposition: 'UPDATED',
      before: { status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
      after: { status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 3 },
    });
    expect(again.writeDiagnostics.rows[0]).toMatchObject({ disposition: 'UNCHANGED' });
  });

  it('takes a live score back off a match once the provider says its game has not started or was cancelled, and marks it postponed when the provider postpones it', async () => {
    const matches = bracket();
    matches[0] = { ...matches[0], status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 3 };
    matches[1] = { ...matches[1], status: MatchStatus.IN_PROGRESS, homeScore: 0, awayScore: 0 };
    const { deps, applyLiveScores } = writer(matches);

    await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'BUF', null, null, ProviderGameState.POSTPONED),
      game('g2', 'PHI', 'DAL', null, null, ProviderGameState.CANCELLED),
    ]);

    expect(applyLiveScores).toHaveBeenCalledWith([
      { id: 'm1', status: MatchStatus.POSTPONED, homeScore: null, awayScore: null },
      { id: 'm2', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
    ]);
  });

  it('marks a scheduled game postponed when the provider postpones it, and scheduled again once the provider reschedules it', async () => {
    const matches = bracket();
    const { deps, applyLiveScores } = writer(matches);

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', null, null, ProviderGameState.POSTPONED)]);
    matches[0] = { ...matches[0], status: MatchStatus.POSTPONED };
    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED)]);

    expect(applyLiveScores.mock.calls).toEqual([
      [[{ id: 'm1', status: MatchStatus.POSTPONED, homeScore: null, awayScore: null }]],
      [[{ id: 'm1', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null }]],
    ]);
  });

  it('puts a postponed game\'s live score on it once the provider says it is being played', async () => {
    const matches = bracket();
    matches[0] = { ...matches[0], status: MatchStatus.POSTPONED };
    const { deps, applyLiveScores } = writer(matches);

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 7, 0, ProviderGameState.IN_PROGRESS)]);

    expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 0 }]);
  });

  it('puts no live score on a match with a result or cancelled, from a live game with no score yet, or from one whose teams are not the match\'s', async () => {
    const matches = bracket();
    matches[0] = { ...matches[0], status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 };
    matches[1] = { ...matches[1], status: MatchStatus.CANCELLED };
    matches[2] = linked(matches[2], 'g3', { homeSportEventParticipantId: 'sep-KC', awaySportEventParticipantId: 'sep-PHI' });
    const extra = linked(bracketMatches(EVENT_ID, [{ matchNumber: 4, round: 2, home: 'sep-BUF', away: 'sep-DAL' }])[0], 'g4');
    const { deps, applyLiveScores } = writer([...matches, extra]);

    const result = await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'BUF', 30, 24, ProviderGameState.IN_PROGRESS),
      game('g2', 'PHI', 'DAL', 7, 0, ProviderGameState.IN_PROGRESS),
      game('g3', 'KC', 'PHI', null, null, ProviderGameState.IN_PROGRESS),
      game('g4', 'BUF', 'KC', 3, 0, ProviderGameState.IN_PROGRESS),
    ]);

    expect(applyLiveScores).toHaveBeenCalledWith([]);
    expect(result.writeDiagnostics.summary.total).toBe(0);
  });

  it('links a game no match is linked to yet to the match its two teams play, in either order, and records its final or live score', async () => {
    const matches = bracket().map((match) => linked(match, null));
    const { deps, recordResult, applySync, applyLiveScores, logger } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [
      game('p-1', 'BUF', 'KC', 24, 27),
      game('p-2', 'PHI', 'DAL', 14, 10, ProviderGameState.IN_PROGRESS),
      game('p-3', 'NYJ', 'MIA', 3, 0),
    ]);

    expect(mappedOf(applySync)).toEqual([['m1-g1', 'p-1'], ['m2-g1', 'p-2']]);
    expect(logger.info).toHaveBeenCalledWith({ action: 'liveScore.game.linked', data: { sportEventId: EVENT_ID, roundNumber: 1, matchNumber: 1, gameNumber: 1, providerGameId: 'p-1' } }, expect.any(String));
    expect(recordResult.mock.calls).toEqual([[EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }]]);
    expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm2', status: MatchStatus.IN_PROGRESS, homeScore: 14, awayScore: 10 }]);
    expect(result).toMatchObject({ updatesPersisted: 2, updatesSkipped: 1 });
  });

  it('moves a re-issued id onto the Game its teams and game number place it at, the Game\'s old id gone from the batch, with a GAME_ID_REISSUED finding', async () => {
    const { deps, applySync } = writer(bracket());

    const result = await writeGameScores(deps, EVENT, [game('g1-new', 'KC', 'BUF', 27, 24)]);

    expect(mappedOf(applySync)).toEqual([['m1-g1', 'g1-new']]);
    expect(applySync.mock.calls[0]?.[0].moved).toEqual([]);
    expect(result.gameFindings).toEqual([{ kind: 'GAME_ID_REISSUED', providerValue: 'g1-new' }]);
  });

  it('marks a game mapped to another event\'s Game moved to the Game it is placed at here, with a GAME_MOVED finding, and keeps the old Game', async () => {
    const matches = bracket().map((match) => linked(match, null));
    const oldGame = { ...gameOne(matches[0] ?? expectDefined(undefined, 'match')), id: 'week-11-g1', sportEventId: 'week-11' };
    const { deps, applySync } = writer(matches, [], [{ game: oldGame, externalId: 'p-1' }]);

    const result = await writeGameScores(deps, EVENT, [game('p-1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED)]);

    expect(mappedOf(applySync)).toEqual([['m1-g1', 'p-1']]);
    expect(applySync.mock.calls[0]?.[0].moved).toEqual([{ id: 'week-11-g1', movedToGameId: 'm1-g1' }]);
    expect(result.gameFindings).toEqual([{ kind: 'GAME_MOVED', providerValue: 'p-1' }]);
  });

  it('writes the job running the tiebreaker rule of the event a game moved out of, with the move, and none for a sync that moves nothing', async () => {
    const matches = bracket().map((match) => linked(match, null));
    const oldGame = { ...gameOne(matches[0] ?? expectDefined(undefined, 'match')), id: 'week-11-g1', sportEventId: 'week-11' };
    const moving = writer(matches, [], [{ game: oldGame, externalId: 'p-1' }]);
    const still = writer(bracket());

    await writeGameScores(moving.deps, EVENT, [game('p-1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED)]);
    await writeGameScores(still.deps, EVENT, [game('g1', 'KC', 'BUF', 7, 3, ProviderGameState.IN_PROGRESS)]);

    expect(moving.applySync.mock.calls[0]?.[1]?.map((job) => [job.type, job.payload])).toEqual([[BackgroundJobType.REFRESH_SLOT_TIEBREAKERS, { sportEventId: 'week-11' }]]);
    expect(still.applySync.mock.calls.flatMap(([, jobs]) => jobs ?? [])).toEqual([]);
  });

  it('maps nothing, and logs it, when a game\'s place is a Game whose own id is still in the batch: two provider games for one Game', async () => {
    const { deps, applySync, logger } = writer(bracket());

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED), game('g1-twin', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED)]);

    expect(mappedOf(applySync)).toEqual([]);
    expect(result.gameFindings).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'liveScore.game.ambiguous', data: { sportEventId: EVENT_ID, providerGameId: 'g1-twin' } }), expect.any(String));
  });

  it('fails the sync rather than create a Game with no slot when a match was loaded without its Game 1', async () => {
    const matches = bracket().map((match) => linked(match, null));
    const { deps } = writer(matches);
    (deps.games.findBySportEvent as jest.Mock).mockResolvedValue([]);

    await expect(writeGameScores(deps, EVENT, [game('p-1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED)])).rejects.toThrow('Match m1 has no Game');
  });

  it('links nothing it would have to guess: two games for one match, a match with a side to come, a team not mapped, or a side with no field row', async () => {
    const twoGames = writer(bracket().map((match) => linked(match, null)));
    await writeGameScores(twoGames.deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0), game('p-1b', 'BUF', 'KC', 0, 1)]);
    expect(mappedOf(twoGames.applySync)).toEqual([]);

    const sideToCome = bracket().map((match) => linked(match, null));
    sideToCome[2] = { ...sideToCome[2], homeSportEventParticipantId: 'sep-KC' };
    const undecided = writer(sideToCome);
    await writeGameScores(undecided.deps, EVENT, [game('p-3', 'KC', 'PHI', 1, 0)]);
    expect(mappedOf(undecided.applySync)).toEqual([]);

    const unmapped = writer(bracket().map((match) => linked(match, null)), ['bdl-BUF']);
    await writeGameScores(unmapped.deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0)]);
    expect(mappedOf(unmapped.applySync)).toEqual([]);
    expect(unmapped.recordResult).not.toHaveBeenCalled();

    const noFieldRow = writer(bracket().map((match) => linked(match, null)));
    noFieldRow.findByIds.mockResolvedValue([]);
    await writeGameScores(noFieldRow.deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0)]);
    expect(mappedOf(noFieldRow.applySync)).toEqual([]);
  });

  it('links nothing when a game\'s two teams play two of the event\'s open matches', async () => {
    const rematch = bracket().map((match) => linked(match, null));
    rematch[2] = { ...rematch[2], homeSportEventParticipantId: 'sep-BUF', awaySportEventParticipantId: 'sep-KC' };
    const { deps, applySync } = writer(rematch);

    await writeGameScores(deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0)]);

    expect(mappedOf(applySync)).toEqual([]);
  });

  it('records a level bracket game settled by a shoot-out as the shoot-out\'s winner, keeping the shoot-out apart from the score', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [
      { ...game('g1', 'KC', 'BUF', 1, 1), homeShootoutScore: 2, awayShootoutScore: 4 },
      { ...game('g2', 'DAL', 'PHI', 0, 0), homeShootoutScore: 3, awayShootoutScore: 5 },
    ]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4 });
    // The provider lists match 2's teams the other way round: its shoot-out turns with its score.
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 2 }, { winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 0, homeShootoutScore: 5, awayShootoutScore: 3 });
  });

  it('reads a shoot-out only for a level game with both of its scores, leaving a level game without one a tie', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [
      { ...game('g1', 'KC', 'BUF', 2, 1), homeShootoutScore: 3, awayShootoutScore: 4 },
      { ...game('g2', 'PHI', 'DAL', 1, 1), homeShootoutScore: 4, awayShootoutScore: null },
    ]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 2, awayScore: 1 });
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 2 }, { winnerSide: null, homeScore: 1, awayScore: 1 });
  });

  it('writes nothing for a match that already holds a shoot-out result, and corrects one whose shoot-out score changed', async () => {
    const matches = bracket();
    const settled = { status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4, resultSource: MatchResultSource.PROVIDER };
    matches[0] = linked(matches[0], 'g1', settled);
    matches[1] = linked(matches[1], 'g2', { ...settled, homeShootoutScore: 3, awayShootoutScore: 4 });
    const { deps, recordResult } = writer(matches);

    await writeGameScores(deps, EVENT, [
      { ...game('g1', 'KC', 'BUF', 1, 1), homeShootoutScore: 2, awayShootoutScore: 4 },
      { ...game('g2', 'PHI', 'DAL', 1, 1), homeShootoutScore: 2, awayShootoutScore: 4 },
    ]);

    expect(recordResult).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 2 }, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4 });
  });

  it('writes nothing, and says so, for a match that already holds the final result', async () => {
    const matches = bracket();
    matches[0] = linked(matches[0], 'g1', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
    const { deps, recordResult } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult).not.toHaveBeenCalled();
    expect(result.writeDiagnostics.rows[0]).toMatchObject({ disposition: 'UNCHANGED' });
    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 1 });
  });

  it('corrects a completed match whose score the provider set and has since changed', async () => {
    const matches = bracket();
    matches[0] = linked(matches[0], 'g1', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 21, resultSource: MatchResultSource.PROVIDER });
    const { deps, recordResult } = writer(matches);

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
  });

  it('overwrites a recorded result with the provider\'s final when the two disagree, since the feed is the only writer', async () => {
    const matches = bracket();
    matches[0] = linked(matches[0], 'g1', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 24, resultSource: MatchResultSource.PROVIDER });
    const { deps, recordResult } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24), game('g2', 'PHI', 'DAL', 31, 17)]);

    expect(recordResult.mock.calls).toEqual([
      [EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }],
      [EVENT_ID, { roundNumber: 1, matchNumber: 2 }, { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 17 }],
    ]);
    expect(result.writeDiagnostics.rows.map((row) => [row.name, row.disposition])).toEqual([['Round 1 match 1', 'UPDATED'], ['Round 1 match 2', 'UPDATED']]);
  });

  it('skips with a warning a final whose teams are not the match\'s, or are not mapped, or that has no score', async () => {
    const matches = bracket();
    matches[2] = linked(matches[2], 'g3', { homeSportEventParticipantId: 'sep-KC', awaySportEventParticipantId: null });
    const { deps, recordResult, logger } = writer(matches, ['bdl-DAL']);

    const result = await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'NYJ', 27, 24),
      game('g2', 'PHI', 'DAL', 30, 10),
      game('g3', 'KC', 'PHI', 20, 17),
      { ...game('g1', 'KC', 'BUF', null, null) },
    ]);

    expect(recordResult).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'liveScore.game.teamsDoNotFit' }), expect.any(String));
    expect(result).toMatchObject({ updatesPersisted: 0, updatesSkipped: 4 });
  });

  it('skips with a warning a final the match refuses, such as one locked by the next round\'s result, and writes the rest', async () => {
    const { deps, recordResult, logger } = writer(bracket());
    recordResult.mockRejectedValueOnce(new SportEventError('locked', 'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED', 409));

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24), game('g2', 'PHI', 'DAL', 30, 10)]);

    expect(recordResult).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.game.refused', data: { sportEventId: EVENT_ID, roundNumber: 1, matchNumber: 1, providerGameId: 'g1', code: 'SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED' } },
      expect.any(String),
    );
    expect(result).toMatchObject({ updatesPersisted: 1, updatesSkipped: 1 });
  });

  it('records a semifinal and the final it feeds when both are final in one sync, the semifinal first', async () => {
    const matches = bracket();
    // The other semifinal was decided in an earlier sync, so the final already has its away side.
    matches[2] = linked(matches[2], 'g3', { awaySportEventParticipantId: 'sep-PHI' });
    const { deps, recordResult, logger } = writer(matches);
    recordResult.mockImplementation(async (_event, place) => {
      await Promise.resolve();
      return place.roundNumber === 1 && place.matchNumber === 1 ? [{ ...matches[2], homeSportEventParticipantId: 'sep-KC' }] : [];
    });

    const result = await writeGameScores(deps, EVENT, [game('g3', 'KC', 'PHI', 31, 28), game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult.mock.calls).toEqual([
      [EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }],
      [EVENT_ID, { roundNumber: 2, matchNumber: 3 }, { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 28 }],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updatesPersisted: 2, updatesSkipped: 0 });
  });

  it('lets any other failure fail the sync rather than report it as a skipped game', async () => {
    const { deps, recordResult } = writer(bracket());
    recordResult.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)])).rejects.toThrow('database unavailable');
  });

  describe('a best-of series (one match whose score is games won)', () => {
    const SEVENS = { id: EVENT_ID, rounds: 2 };

    /** A two-round playoff, each round's best-of length its slot's (#2006): both best of seven unless given. */
    function series(lengths: readonly [number, number] = [7, 7]): SportEventRoundMatch[] {
      const slots = bracketRoundSlots(2).map((slot, index) => ({ ...slot, seriesGames: lengths[index] ?? 1 }));
      return bracketMatches(EVENT_ID, [
        { matchNumber: 1, round: 1, home: 'sep-KC', away: 'sep-BUF' },
        { matchNumber: 2, round: 1, home: 'sep-PHI', away: 'sep-DAL' },
        { matchNumber: 3, round: 2, home: null, away: null },
      ], (roundNumber) => expectDefined(slots[roundNumber - 1], `round ${roundNumber}'s slot`)).map((match) => linked(match, null));
    }

    it('holds each game of a series at its own Game, counts each final game as a win from the match\'s sides, and records the series 4-1 once a side has four', async () => {
      const { deps, recordResult, applySync, applyLiveScores } = writer(series());

      const result = await writeGameScores(deps, SEVENS, [
        nth(1, game('s1', 'KC', 'BUF', 100, 90)),
        nth(2, game('s2', 'KC', 'BUF', 88, 95)),
        nth(3, game('s3', 'BUF', 'KC', 97, 101)),
        nth(4, game('s4', 'BUF', 'KC', 99, 104)),
        nth(5, game('s5', 'KC', 'BUF', 110, 102)),
      ]);

      const [[sync]] = applySync.mock.calls;
      expect(sync.created.map((each) => [each.sportEventRoundMatchId, each.gameNumber, each.sportEventSlotId])).toEqual([2, 3, 4, 5].map((number) => ['m1', number, 'event-slot-1']));
      expect(mappedOf(applySync)).toEqual([['m1-g1', 's1'], ...sync.created.map((each, index) => [each.id, `s${index + 2}`])]);
      expect(sync.scores.map((each) => [each.status, each.winnerSide, each.homeScore, each.awayScore])).toEqual([
        [MatchStatus.COMPLETED, MatchSide.HOME, 100, 90],
        [MatchStatus.COMPLETED, MatchSide.AWAY, 88, 95],
        [MatchStatus.COMPLETED, MatchSide.HOME, 101, 97],
        [MatchStatus.COMPLETED, MatchSide.HOME, 104, 99],
        [MatchStatus.COMPLETED, MatchSide.HOME, 110, 102],
      ]);
      expect(recordResult.mock.calls).toEqual([[EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 1 }]]);
      expect(applyLiveScores).toHaveBeenCalledWith([]);
      expect(result.writeDiagnostics.rows).toEqual([expect.objectContaining({ externalId: 's1,s2,s3,s4,s5', disposition: 'UPDATED' })]);
    });

    it('records the away side as the winner when the series\' away team wins four, and writes nothing again for a series already holding that result', async () => {
      const decided = series();
      decided[1] = { ...decided[1], status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 0, awayScore: 4, resultSource: MatchResultSource.PROVIDER };
      const { deps, recordResult } = writer(decided);
      const sweep = ['d1', 'd2', 'd3', 'd4'].map((id, index) => nth(index + 1, game(id, 'DAL', 'PHI', 5, 2)));

      const result = await writeGameScores(deps, SEVENS, sweep);

      expect(recordResult).not.toHaveBeenCalled();
      expect(result.writeDiagnostics.rows).toEqual([expect.objectContaining({ id: 'm2', disposition: 'UNCHANGED' })]);
    });

    it('puts the wins so far on the series\' match as its live score while no side has four, a game under way adding none', async () => {
      const { deps, recordResult, applyLiveScores } = writer(series());

      await writeGameScores(deps, SEVENS, [
        nth(1, game('s1', 'KC', 'BUF', 100, 90)),
        nth(2, game('s2', 'BUF', 'KC', 101, 99)),
        nth(3, game('s3', 'KC', 'BUF', 104, 100)),
        nth(4, game('s4', 'BUF', 'KC', 50, 61, ProviderGameState.IN_PROGRESS)),
        nth(5, game('s5', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED)),
      ]);

      expect(recordResult).not.toHaveBeenCalled();
      expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.IN_PROGRESS, homeScore: 2, awayScore: 1 }]);
    });

    it('takes a series\' live score back off when none of its games has started, and leaves alone a series not yet under way', async () => {
      const matches = series();
      matches[0] = { ...matches[0], status: MatchStatus.IN_PROGRESS, homeScore: 0, awayScore: 0 };
      const { deps, applyLiveScores } = writer(matches);

      await writeGameScores(deps, SEVENS, [
        nth(1, game('s1', 'KC', 'BUF', null, null, ProviderGameState.POSTPONED)),
        nth(1, game('t1', 'PHI', 'DAL', null, null, ProviderGameState.SCHEDULED)),
      ]);

      expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null }]);
    });

    it('counts no win for a final game with no score, and puts no live score on a series an admin has already decided', async () => {
      const matches = series();
      matches[1] = { ...matches[1], status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 0, resultSource: MatchResultSource.PROVIDER };
      const { deps, applyLiveScores } = writer(matches);

      await writeGameScores(deps, SEVENS, [
        nth(1, game('s1', 'KC', 'BUF', 100, 90)),
        nth(2, game('s2', 'KC', 'BUF', null, null)),
        nth(1, game('t1', 'PHI', 'DAL', 101, 99)),
      ]);

      expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.IN_PROGRESS, homeScore: 1, awayScore: 0 }]);
    });

    it('counts a level game settled by a shoot-out as the shoot-out winner\'s, so a best-of-three takes its result at two wins', async () => {
      const { deps, recordResult } = writer(series([3, 1]));
      const shootout = { ...nth(2, game('s2', 'BUF', 'KC', 1, 1)), homeShootoutScore: 3, awayShootoutScore: 5 };

      await writeGameScores(deps, SEVENS, [nth(1, game('s1', 'KC', 'BUF', 2, 0)), shootout]);

      expect(recordResult).toHaveBeenCalledWith(EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 2, awayScore: 0 });
    });

    it('leaves alone a series whose feed has more decided games than the series is long, or whose two teams two matches share', async () => {
      const matches = series([3, 3]);
      matches[2] = { ...matches[2], homeSportEventParticipantId: 'sep-DAL', awaySportEventParticipantId: 'sep-PHI' };
      const { deps, recordResult, applyLiveScores, logger } = writer(matches);

      await writeGameScores(deps, SEVENS, [
        nth(1, game('s1', 'KC', 'BUF', 2, 0)),
        nth(2, game('s2', 'BUF', 'KC', 2, 0)),
        nth(3, game('s3', 'KC', 'BUF', 1, 0)),
        nth(4, game('s4', 'BUF', 'KC', 1, 0)),
        nth(1, game('t1', 'PHI', 'DAL', 2, 1)),
      ]);

      expect(recordResult).not.toHaveBeenCalled();
      expect(applyLiveScores).toHaveBeenCalledWith([]);
      expect(logger.warn).toHaveBeenCalledWith(
        { action: 'liveScore.series.tooManyGames', data: { sportEventId: EVENT_ID, roundNumber: 1, matchNumber: 1, providerGameIds: 's1,s2,s3,s4', length: 3 } },
        expect.any(String),
      );
      expect(logger.warn).toHaveBeenCalledWith({ action: 'liveScore.game.ambiguous', data: { sportEventId: EVENT_ID, providerGameId: 't1' } }, expect.any(String));
    });

    it('leaves alone a series in which a side has won more games than it takes, a game counted after the series was over', async () => {
      const { deps, recordResult, logger } = writer(series());
      const fiveNil = ['s1', 's2', 's3', 's4', 's5'].map((id, index) => nth(index + 1, game(id, 'KC', 'BUF', 3, 1)));

      await writeGameScores(deps, SEVENS, fiveNil);

      expect(recordResult).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { action: 'liveScore.series.tooManyGames', data: { sportEventId: EVENT_ID, roundNumber: 1, matchNumber: 1, providerGameIds: 's1,s2,s3,s4,s5', length: 7 } },
        expect.any(String),
      );
    });

    it('plays single games in a round whose slot is played in single games, and a series in the final\'s best-of-seven slot', async () => {
      const matches = series([1, 7]);
      matches[2] = { ...matches[2], homeSportEventParticipantId: 'sep-KC', awaySportEventParticipantId: 'sep-PHI' };
      const { deps, recordResult, applySync } = writer(matches);

      await writeGameScores(deps, SEVENS, [
        game('r1', 'KC', 'BUF', 20, 17),
        ...['f1', 'f2', 'f3', 'f4'].map((id, index) => nth(index + 1, game(id, 'PHI', 'KC', 3, 1))),
      ]);

      expect(mappedOf(applySync)).toEqual(expect.arrayContaining([['m1-g1', 'r1'], ['m3-g1', 'f1']]));
      expect(recordResult.mock.calls).toEqual([
        [EVENT_ID, { roundNumber: 1, matchNumber: 1 }, { winnerSide: MatchSide.HOME, homeScore: 20, awayScore: 17 }],
        [EVENT_ID, { roundNumber: 2, matchNumber: 3 }, { winnerSide: MatchSide.AWAY, homeScore: 0, awayScore: 4 }],
      ]);
    });
  });

  it('reads the sides and the team mappings once for the whole batch, however many games it holds', async () => {
    const { deps, findByIds, findByProviderExternalIds } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24), game('g2', 'PHI', 'DAL', 30, 10)]);

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds).toHaveBeenCalledWith(['sep-KC', 'sep-BUF', 'sep-PHI', 'sep-DAL']);
    expect(findByProviderExternalIds).toHaveBeenCalledTimes(1);
    expect(findByProviderExternalIds).toHaveBeenCalledWith(ProviderCode.BALLDONTLIE, { sportEventId: 'event-1' }, ['bdl-KC', 'bdl-BUF', 'bdl-PHI', 'bdl-DAL']);
  });
});

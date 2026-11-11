import { MatchResultSource, MatchSide, MatchStatus, ProviderGameState, type SportEventMatch } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import type { MatchLiveScoreWrite } from '@poolmaster/shared/db';
import { writeGameScores, type GameScoreWriterDeps } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/game-score-writer';
import { SportEventError } from '../../../packages/core-api/src/modules/events/errors';
import { bracketMatches } from '../../support/bracket-fixtures';
import { fakeLogger } from '../../support/fake-logger';

// A provider's final for a linked match is written through the admin's result path (#1496).
// Field rows `sep-<team>` play for participants `p-<team>`; the provider calls the teams `bdl-<team>`.

const EVENT_ID = 'event-1';
/** A league that plays single games in every round. */
const EVENT = { id: EVENT_ID, rounds: null, roundSeriesLengths: [] };

function linked(match: SportEventMatch, externalGameId: string | null, overrides: Partial<SportEventMatch> = {}): SportEventMatch {
  return { ...match, externalGameId, ...overrides };
}

function bracket(): SportEventMatch[] {
  const [first, second, third] = bracketMatches(EVENT_ID, [
    { matchNumber: 1, round: 1, home: 'sep-KC', away: 'sep-BUF' },
    { matchNumber: 2, round: 1, home: 'sep-PHI', away: 'sep-DAL' },
    { matchNumber: 3, round: 2, home: null, away: null },
  ]);
  return [linked(first, 'g1'), linked(second, 'g2'), linked(third, 'g3')];
}

function game(externalGameId: string, home: string, away: string, homeScore: number | null, awayScore: number | null, state: ProviderGameState = ProviderGameState.FINAL): GameScoreUpdate {
  return { externalGameId, homeTeamExternalId: `bdl-${home}`, awayTeamExternalId: `bdl-${away}`, homeScore, awayScore, state };
}

function writer(matches: SportEventMatch[], unmappedTeams: readonly string[] = []) {
  const recordResult = jest.fn<ReturnType<GameScoreWriterDeps['results']['recordResult']>, Parameters<GameScoreWriterDeps['results']['recordResult']>>()
    .mockResolvedValue([]);
  const findByIds = jest.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, participantId: id.replace('sep-', 'p-') })));
  const findByProviderExternalIds = jest.fn(async (providerId: string, ids: readonly string[]) => ids
    .filter((id) => !unmappedTeams.includes(id))
    .map((externalId) => ({ id: `map-${externalId}`, providerId, externalId, participantId: externalId.replace('bdl-', 'p-') })));
  const logger = fakeLogger();
  const linkGames = jest.fn<Promise<void>, [readonly { id: string; externalGameId: string }[]]>().mockResolvedValue();
  const applyLiveScores = jest.fn<Promise<void>, [readonly MatchLiveScoreWrite[]]>().mockResolvedValue();
  const deps = {
    providerId: 'balldontlie',
    matches: { findBySportEvent: jest.fn(async () => matches), linkGames, applyLiveScores },
    eventParticipants: { findByIds },
    mappings: { findByProviderExternalIds },
    results: { recordResult },
    logger,
  } as unknown as GameScoreWriterDeps;
  return { deps, recordResult, findByIds, findByProviderExternalIds, linkGames, applyLiveScores, logger };
}

describe('writeGameScores', () => {
  it('records a final game\'s winner and score on the match linked to it, through the admin\'s result path', async () => {
    const { deps, recordResult } = writer(bracket());

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }, MatchResultSource.PROVIDER);
    expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 1, updatesSkipped: 0 });
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 1, updated: 1 });
    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      entityType: 'SportEventMatch', disposition: 'UPDATED', providerId: 'balldontlie', externalId: 'g1', internalId: 'm1', name: 'Match 1',
      before: { winnerSide: null, homeScore: null, awayScore: null }, after: { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 },
    });
  });

  it('scores the right sides when the provider lists the match\'s teams the other way round', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'BUF', 'KC', 24, 27)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }, MatchResultSource.PROVIDER);
  });

  it('records an away win, and level scores as a tie for the result service to accept or refuse', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 10, 13), game('g2', 'PHI', 'DAL', 20, 20)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.AWAY, homeScore: 10, awayScore: 13 }, MatchResultSource.PROVIDER);
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 2, { winnerSide: null, homeScore: 20, awayScore: 20 }, MatchResultSource.PROVIDER);
  });

  it('writes nothing for games not under way on matches with no live score, and reads nothing while every game is linked', async () => {
    const { deps, recordResult, findByIds, findByProviderExternalIds, linkGames, applyLiveScores } = writer(bracket());

    const result = await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED),
      game('g2', 'PHI', 'DAL', null, null, ProviderGameState.POSTPONED),
    ]);

    expect(recordResult).not.toHaveBeenCalled();
    expect(findByIds).not.toHaveBeenCalled();
    expect(findByProviderExternalIds).not.toHaveBeenCalled();
    expect(linkGames).toHaveBeenCalledWith([]);
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
      name: 'Match 1',
      disposition: 'UPDATED',
      before: { status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
      after: { status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 3 },
    });
    expect(again.writeDiagnostics.rows[0]).toMatchObject({ disposition: 'UNCHANGED' });
  });

  it('takes a live score back off a match once the provider says its game has not started, was postponed or was cancelled', async () => {
    const matches = bracket();
    matches[0] = { ...matches[0], status: MatchStatus.IN_PROGRESS, homeScore: 7, awayScore: 3 };
    matches[1] = { ...matches[1], status: MatchStatus.IN_PROGRESS, homeScore: 0, awayScore: 0 };
    const { deps, applyLiveScores } = writer(matches);

    await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'BUF', null, null, ProviderGameState.POSTPONED),
      game('g2', 'PHI', 'DAL', null, null, ProviderGameState.CANCELLED),
    ]);

    expect(applyLiveScores).toHaveBeenCalledWith([
      { id: 'm1', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
      { id: 'm2', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null },
    ]);
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
    const { deps, recordResult, linkGames, applyLiveScores, logger } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [
      game('p-1', 'BUF', 'KC', 24, 27),
      game('p-2', 'PHI', 'DAL', 14, 10, ProviderGameState.IN_PROGRESS),
      game('p-3', 'NYJ', 'MIA', 3, 0),
    ]);

    expect(linkGames).toHaveBeenCalledWith([{ id: 'm1', externalGameId: 'p-1' }, { id: 'm2', externalGameId: 'p-2' }]);
    expect(logger.info).toHaveBeenCalledWith({ action: 'liveScore.game.linked', data: { sportEventId: EVENT_ID, matchNumber: 1, externalGameId: 'p-1' } }, expect.any(String));
    expect(recordResult.mock.calls).toEqual([[EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }, MatchResultSource.PROVIDER]]);
    expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm2', status: MatchStatus.IN_PROGRESS, homeScore: 14, awayScore: 10 }]);
    expect(result).toMatchObject({ updatesPersisted: 2, updatesSkipped: 1 });
  });

  it('links nothing it would have to guess: two games for one match, a match with a side to come, a team not mapped, or a side with no field row', async () => {
    const twoGames = writer(bracket().map((match) => linked(match, null)));
    await writeGameScores(twoGames.deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0), game('p-1b', 'BUF', 'KC', 0, 1)]);
    expect(twoGames.linkGames).toHaveBeenCalledWith([]);

    const sideToCome = bracket().map((match) => linked(match, null));
    sideToCome[2] = { ...sideToCome[2], homeSportEventParticipantId: 'sep-KC' };
    const undecided = writer(sideToCome);
    await writeGameScores(undecided.deps, EVENT, [game('p-3', 'KC', 'PHI', 1, 0)]);
    expect(undecided.linkGames).toHaveBeenCalledWith([]);

    const unmapped = writer(bracket().map((match) => linked(match, null)), ['bdl-BUF']);
    await writeGameScores(unmapped.deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0)]);
    expect(unmapped.linkGames).toHaveBeenCalledWith([]);
    expect(unmapped.recordResult).not.toHaveBeenCalled();

    const noFieldRow = writer(bracket().map((match) => linked(match, null)));
    noFieldRow.findByIds.mockResolvedValue([]);
    await writeGameScores(noFieldRow.deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0)]);
    expect(noFieldRow.linkGames).toHaveBeenCalledWith([]);
  });

  it('links nothing when a game\'s two teams play two of the event\'s open matches', async () => {
    const rematch = bracket().map((match) => linked(match, null));
    rematch[2] = { ...rematch[2], homeSportEventParticipantId: 'sep-BUF', awaySportEventParticipantId: 'sep-KC' };
    const { deps, linkGames } = writer(rematch);

    await writeGameScores(deps, EVENT, [game('p-1', 'KC', 'BUF', 1, 0)]);

    expect(linkGames).toHaveBeenCalledWith([]);
  });

  it('records a level bracket game settled by a shoot-out as the shoot-out\'s winner, keeping the shoot-out apart from the score', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [
      { ...game('g1', 'KC', 'BUF', 1, 1), homeShootoutScore: 2, awayShootoutScore: 4 },
      { ...game('g2', 'DAL', 'PHI', 0, 0), homeShootoutScore: 3, awayShootoutScore: 5 },
    ]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4 }, MatchResultSource.PROVIDER);
    // The provider lists match 2's teams the other way round: its shoot-out turns with its score.
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 2, { winnerSide: MatchSide.HOME, homeScore: 0, awayScore: 0, homeShootoutScore: 5, awayShootoutScore: 3 }, MatchResultSource.PROVIDER);
  });

  it('reads a shoot-out only for a level game with both of its scores, leaving a level game without one a tie', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [
      { ...game('g1', 'KC', 'BUF', 2, 1), homeShootoutScore: 3, awayShootoutScore: 4 },
      { ...game('g2', 'PHI', 'DAL', 1, 1), homeShootoutScore: 4, awayShootoutScore: null },
    ]);

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 2, awayScore: 1 }, MatchResultSource.PROVIDER);
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 2, { winnerSide: null, homeScore: 1, awayScore: 1 }, MatchResultSource.PROVIDER);
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
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 2, { winnerSide: MatchSide.AWAY, homeScore: 1, awayScore: 1, homeShootoutScore: 2, awayShootoutScore: 4 }, MatchResultSource.PROVIDER);
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

    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }, MatchResultSource.PROVIDER);
  });

  it('keeps a result an admin entered when the provider\'s final disagrees, and logs the disagreement instead', async () => {
    const matches = bracket();
    matches[0] = linked(matches[0], 'g1', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 24, resultSource: MatchResultSource.ADMIN });
    const { deps, recordResult, logger } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24), game('g2', 'PHI', 'DAL', 31, 17)]);

    expect(recordResult).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 2, { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 17 }, MatchResultSource.PROVIDER);
    expect(logger.warn).toHaveBeenCalledWith({
      action: 'liveScore.game.adminResultKept',
      data: {
        sportEventId: EVENT_ID,
        matchNumber: 1,
        externalGameId: 'g1',
        before: { winnerSide: MatchSide.AWAY, homeScore: 20, awayScore: 24, homeShootoutScore: null, awayShootoutScore: null },
        provider: { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 },
      },
    }, expect.any(String));
    expect(result.writeDiagnostics.rows.map((row) => [row.name, row.disposition])).toEqual([['Match 1', 'UNCHANGED'], ['Match 2', 'UPDATED']]);
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
    recordResult.mockRejectedValueOnce(new SportEventError('locked', 'SPORT_EVENT_MATCH_RESULT_LOCKED', 409));

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24), game('g2', 'PHI', 'DAL', 30, 10)]);

    expect(recordResult).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.game.refused', data: { sportEventId: EVENT_ID, matchNumber: 1, externalGameId: 'g1', code: 'SPORT_EVENT_MATCH_RESULT_LOCKED' } },
      expect.any(String),
    );
    expect(result).toMatchObject({ updatesPersisted: 1, updatesSkipped: 1 });
  });

  it('records a semifinal and the final it feeds when both are final in one sync, the semifinal first', async () => {
    const matches = bracket();
    // The other semifinal was decided in an earlier sync, so the final already has its away side.
    matches[2] = linked(matches[2], 'g3', { awaySportEventParticipantId: 'sep-PHI' });
    const { deps, recordResult, logger } = writer(matches);
    recordResult.mockImplementation(async (_event, matchNumber) => {
      await Promise.resolve();
      return matchNumber === 1 ? [{ ...matches[2], homeSportEventParticipantId: 'sep-KC' }] : [];
    });

    const result = await writeGameScores(deps, EVENT, [game('g3', 'KC', 'PHI', 31, 28), game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult.mock.calls).toEqual([
      [EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }, MatchResultSource.PROVIDER],
      [EVENT_ID, 3, { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 28 }, MatchResultSource.PROVIDER],
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
    /** A league whose two playoff rounds are both best of seven. */
    const SEVENS = { id: EVENT_ID, rounds: 2, roundSeriesLengths: [7, 7] };

    function series(): SportEventMatch[] {
      return bracketMatches(EVENT_ID, [
        { matchNumber: 1, round: 1, home: 'sep-KC', away: 'sep-BUF' },
        { matchNumber: 2, round: 1, home: 'sep-PHI', away: 'sep-DAL' },
        { matchNumber: 3, round: 2, home: null, away: null },
      ]).map((match) => linked(match, null));
    }

    it('counts each final game between the series\' two teams as a win, from the match\'s sides, and records the series 4-1 once a side has four', async () => {
      const { deps, recordResult, linkGames, applyLiveScores } = writer(series());

      const result = await writeGameScores(deps, SEVENS, [
        game('s1', 'KC', 'BUF', 100, 90),
        game('s2', 'KC', 'BUF', 88, 95),
        game('s3', 'BUF', 'KC', 97, 101),
        game('s4', 'BUF', 'KC', 99, 104),
        game('s5', 'KC', 'BUF', 110, 102),
      ]);

      expect(linkGames).toHaveBeenCalledWith([]);
      expect(recordResult.mock.calls).toEqual([[EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 1 }, MatchResultSource.PROVIDER]]);
      expect(applyLiveScores).toHaveBeenCalledWith([]);
      expect(result.writeDiagnostics.rows).toEqual([expect.objectContaining({ externalId: 's1,s2,s3,s4,s5', disposition: 'UPDATED' })]);
    });

    it('records the away side as the winner when the series\' away team wins four, and writes nothing again for a series already holding that result', async () => {
      const decided = series();
      decided[1] = { ...decided[1], status: MatchStatus.COMPLETED, winnerSide: MatchSide.AWAY, homeScore: 0, awayScore: 4, resultSource: MatchResultSource.PROVIDER };
      const { deps, recordResult } = writer(decided);
      const sweep = ['d1', 'd2', 'd3', 'd4'].map((id) => game(id, 'DAL', 'PHI', 5, 2));

      const result = await writeGameScores(deps, SEVENS, sweep);

      expect(recordResult).not.toHaveBeenCalled();
      expect(result.writeDiagnostics.rows).toEqual([expect.objectContaining({ id: 'm2', disposition: 'UNCHANGED' })]);
    });

    it('puts the wins so far on the series\' match as its live score while no side has four, a game under way adding none', async () => {
      const { deps, recordResult, applyLiveScores } = writer(series());

      await writeGameScores(deps, SEVENS, [
        game('s1', 'KC', 'BUF', 100, 90),
        game('s2', 'BUF', 'KC', 101, 99),
        game('s3', 'KC', 'BUF', 104, 100),
        game('s4', 'BUF', 'KC', 50, 61, ProviderGameState.IN_PROGRESS),
        game('s5', 'KC', 'BUF', null, null, ProviderGameState.SCHEDULED),
      ]);

      expect(recordResult).not.toHaveBeenCalled();
      expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.IN_PROGRESS, homeScore: 2, awayScore: 1 }]);
    });

    it('takes a series\' live score back off when none of its games has started, and leaves alone a series not yet under way', async () => {
      const matches = series();
      matches[0] = { ...matches[0], status: MatchStatus.IN_PROGRESS, homeScore: 0, awayScore: 0 };
      const { deps, applyLiveScores } = writer(matches);

      await writeGameScores(deps, SEVENS, [
        game('s1', 'KC', 'BUF', null, null, ProviderGameState.POSTPONED),
        game('t1', 'PHI', 'DAL', null, null, ProviderGameState.SCHEDULED),
      ]);

      expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.SCHEDULED, homeScore: null, awayScore: null }]);
    });

    it('counts no win for a final game with no score, and puts no live score on a series an admin has already decided', async () => {
      const matches = series();
      matches[1] = { ...matches[1], status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 4, awayScore: 0, resultSource: MatchResultSource.ADMIN };
      const { deps, applyLiveScores } = writer(matches);

      await writeGameScores(deps, SEVENS, [
        game('s1', 'KC', 'BUF', 100, 90),
        game('s2', 'KC', 'BUF', null, null),
        game('t1', 'PHI', 'DAL', 101, 99),
      ]);

      expect(applyLiveScores).toHaveBeenCalledWith([{ id: 'm1', status: MatchStatus.IN_PROGRESS, homeScore: 1, awayScore: 0 }]);
    });

    it('counts a level game settled by a shoot-out as the shoot-out winner\'s, so a best-of-three takes its result at two wins', async () => {
      const { deps, recordResult } = writer(series());
      const shootout = { ...game('s2', 'BUF', 'KC', 1, 1), homeShootoutScore: 3, awayShootoutScore: 5 };

      await writeGameScores(deps, { id: EVENT_ID, rounds: 2, roundSeriesLengths: [3, 1] }, [game('s1', 'KC', 'BUF', 2, 0), shootout]);

      expect(recordResult).toHaveBeenCalledWith(EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 2, awayScore: 0 }, MatchResultSource.PROVIDER);
    });

    it('leaves alone a series whose feed has more decided games than the series is long, or whose two teams two matches share', async () => {
      const matches = series();
      matches[2] = { ...matches[2], homeSportEventParticipantId: 'sep-DAL', awaySportEventParticipantId: 'sep-PHI' };
      const { deps, recordResult, applyLiveScores, logger } = writer(matches);

      await writeGameScores(deps, { id: EVENT_ID, rounds: 2, roundSeriesLengths: [3, 3] }, [
        game('s1', 'KC', 'BUF', 2, 0),
        game('s2', 'BUF', 'KC', 2, 0),
        game('s3', 'KC', 'BUF', 1, 0),
        game('s4', 'BUF', 'KC', 1, 0),
        game('t1', 'PHI', 'DAL', 2, 1),
      ]);

      expect(recordResult).not.toHaveBeenCalled();
      expect(applyLiveScores).toHaveBeenCalledWith([]);
      expect(logger.warn).toHaveBeenCalledWith(
        { action: 'liveScore.series.tooManyGames', data: { sportEventId: EVENT_ID, matchNumber: 1, externalGameIds: 's1,s2,s3,s4', length: 3 } },
        expect.any(String),
      );
    });

    it('leaves alone a series in which a side has won more games than it takes, a game counted after the series was over', async () => {
      const { deps, recordResult, logger } = writer(series());
      const fiveNil = ['s1', 's2', 's3', 's4', 's5'].map((id) => game(id, 'KC', 'BUF', 3, 1));

      await writeGameScores(deps, SEVENS, fiveNil);

      expect(recordResult).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { action: 'liveScore.series.tooManyGames', data: { sportEventId: EVENT_ID, matchNumber: 1, externalGameIds: 's1,s2,s3,s4,s5', length: 7 } },
        expect.any(String),
      );
    });

    it('plays single games in a round the league names no length for, lining the lengths up with the final', async () => {
      const matches = series();
      matches[2] = { ...matches[2], homeSportEventParticipantId: 'sep-KC', awaySportEventParticipantId: 'sep-PHI' };
      const { deps, recordResult, linkGames } = writer(matches);

      // One length for two rounds: the final is a best of seven, the first round single games.
      await writeGameScores(deps, { id: EVENT_ID, rounds: null, roundSeriesLengths: [7] }, [
        game('r1', 'KC', 'BUF', 20, 17),
        ...['f1', 'f2', 'f3', 'f4'].map((id) => game(id, 'PHI', 'KC', 3, 1)),
      ]);

      expect(linkGames).toHaveBeenCalledWith([{ id: 'm1', externalGameId: 'r1' }]);
      expect(recordResult.mock.calls).toEqual([
        [EVENT_ID, 1, { winnerSide: MatchSide.HOME, homeScore: 20, awayScore: 17 }, MatchResultSource.PROVIDER],
        [EVENT_ID, 3, { winnerSide: MatchSide.AWAY, homeScore: 0, awayScore: 4 }, MatchResultSource.PROVIDER],
      ]);
    });
  });

  it('reads the sides and the team mappings once for the whole batch, however many games it holds', async () => {
    const { deps, findByIds, findByProviderExternalIds } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24), game('g2', 'PHI', 'DAL', 30, 10)]);

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(findByIds).toHaveBeenCalledWith(['sep-KC', 'sep-BUF', 'sep-PHI', 'sep-DAL']);
    expect(findByProviderExternalIds).toHaveBeenCalledTimes(1);
    expect(findByProviderExternalIds).toHaveBeenCalledWith('balldontlie', ['bdl-KC', 'bdl-BUF', 'bdl-PHI', 'bdl-DAL']);
  });
});

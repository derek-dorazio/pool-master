import { MatchSide, MatchStatus, ProviderGameState, type SportEventMatch } from '@poolmaster/shared/domain';
import type { GameScoreUpdate } from '@poolmaster/shared/dto';
import { writeGameScores, type GameScoreWriterDeps } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/game-score-writer';
import { SportEventError } from '../../../packages/core-api/src/modules/events/errors';
import { bracketMatches } from '../../support/bracket-fixtures';
import { fakeLogger } from '../../support/fake-logger';

// A provider's final for a linked match is written through the admin's result path (#1496).
// Field rows `sep-<team>` play for participants `p-<team>`; the provider calls the teams `bdl-<team>`.

const EVENT = 'event-1';

function linked(match: SportEventMatch, externalGameId: string | null, overrides: Partial<SportEventMatch> = {}): SportEventMatch {
  return { ...match, externalGameId, ...overrides };
}

function bracket(): SportEventMatch[] {
  const [first, second, third] = bracketMatches(EVENT, [
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
  const deps = {
    providerId: 'balldontlie',
    matches: { findBySportEvent: jest.fn(async () => matches) },
    eventParticipants: { findByIds },
    mappings: { findByProviderExternalIds },
    results: { recordResult },
    logger,
  } as unknown as GameScoreWriterDeps;
  return { deps, recordResult, findByIds, findByProviderExternalIds, logger };
}

describe('writeGameScores', () => {
  it('records a final game\'s winner and score on the match linked to it, through the admin\'s result path', async () => {
    const { deps, recordResult } = writer(bracket());

    const result = await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
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

    expect(recordResult).toHaveBeenCalledWith(EVENT, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
  });

  it('records an away win, and level scores as a tie for the result service to accept or refuse', async () => {
    const { deps, recordResult } = writer(bracket());

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 10, 13), game('g2', 'PHI', 'DAL', 20, 20)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT, 1, { winnerSide: MatchSide.AWAY, homeScore: 10, awayScore: 13 });
    expect(recordResult).toHaveBeenCalledWith(EVENT, 2, { winnerSide: null, homeScore: 20, awayScore: 20 });
  });

  it('writes nothing for a game that is not final, or that no match is linked to', async () => {
    const matches = bracket();
    matches[1] = linked(matches[1], null);
    const { deps, recordResult, findByIds, findByProviderExternalIds } = writer(matches);

    const result = await writeGameScores(deps, EVENT, [
      game('g1', 'KC', 'BUF', 7, 3, ProviderGameState.IN_PROGRESS),
      game('g2', 'PHI', 'DAL', 30, 10),
      game('other', 'NYJ', 'MIA', 3, 0),
    ]);

    expect(recordResult).not.toHaveBeenCalled();
    expect(findByIds).not.toHaveBeenCalled();
    expect(findByProviderExternalIds).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updatesReturned: 3, updatesPersisted: 0, updatesSkipped: 3 });
    expect(result.writeDiagnostics.summary.total).toBe(0);
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

  it('corrects a completed match whose score the provider has since changed', async () => {
    const matches = bracket();
    matches[0] = linked(matches[0], 'g1', { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 21 });
    const { deps, recordResult } = writer(matches);

    await writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)]);

    expect(recordResult).toHaveBeenCalledWith(EVENT, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 });
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
      { action: 'liveScore.game.refused', data: { sportEventId: EVENT, matchNumber: 1, externalGameId: 'g1', code: 'SPORT_EVENT_MATCH_RESULT_LOCKED' } },
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
      [EVENT, 1, { winnerSide: MatchSide.HOME, homeScore: 27, awayScore: 24 }],
      [EVENT, 3, { winnerSide: MatchSide.HOME, homeScore: 31, awayScore: 28 }],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ updatesPersisted: 2, updatesSkipped: 0 });
  });

  it('lets any other failure fail the sync rather than report it as a skipped game', async () => {
    const { deps, recordResult } = writer(bracket());
    recordResult.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(writeGameScores(deps, EVENT, [game('g1', 'KC', 'BUF', 27, 24)])).rejects.toThrow('database unavailable');
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

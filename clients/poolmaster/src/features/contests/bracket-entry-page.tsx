import { useParams } from 'react-router';
import { PredictedResult, type Sport } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import {
  Notice,
  ErrorState,
  Heading,
  LoadingState,
  MetricGrid,
  MetricTile,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage, type ErrorCodeMessages } from '@/lib/errors';
import { BracketBoard } from './bracket-board';
import { BracketSubmitPanel } from './bracket-entry-submit';
import { buildBracketRounds, describeBracketClose, formatPickProgress, formatPoints, type BracketGame, type BracketTeam } from './bracket-layout';
import { ContestEntryFrame } from './contest-header';
import { useContestLeagueCode } from './use-contest-league';
import { contestEventStart, contestMatchNoun, contestParticipantNoun, contestScoreUnit } from './contest-sport';
import { firstContestEvent } from './contest-events';
import { contestStatusLabel } from './contest-status';
import { useBracketRoundLabel } from './use-bracket-round-label';
import { useContestEntryQuery } from './use-contest-entries';
import { useGamePicks } from './use-game-picks';

/**
 * Copy for the refusals a bracket's picks, tiebreaker and submit can meet (#721), in the
 * contest's sport's words (#704). The codes are the contract; the server's own sentences are a
 * fallback for anything not listed.
 */
function bracketCodeMessages(sport: Sport | null | undefined): ErrorCodeMessages {
  const match = contestMatchNoun(sport);
  const participant = contestParticipantNoun(sport);
  return {
    PREDICTION_WEEK_INCOMPLETE: `Every ${match.one} needs a pick before your bracket can be submitted.`,
    PREDICTION_TIEBREAKER_MISSING: `Save your tiebreaker, the total ${contestScoreUnit(sport)} of the final, before you submit.`,
    PREDICTION_GAME_STARTED: `That ${match.one} has started, so its pick is locked.`,
    PREDICTION_TEAM_NOT_IN_GAME: `That ${participant.one} can’t reach this ${match.one} in your bracket any more. Your bracket has been refreshed.`,
    CONTEST_ENTRY_LOCKED: `The ${match.many} have started, so this bracket can no longer change.`,
  };
}

/** What the entry has scored, once anyone can see it; a dash before. */
function formatScore(points: number | null) {
  return points === null ? '—' : formatPoints(points);
}

/**
 * A bracket contest's entry page (#721): the entry's own bracket to fill in and submit before the
 * event starts, and afterwards, for any entry of the league, the filled bracket with each pick
 * marked. Every pick answers with the whole bracket, which replaces the view: a changed pick may
 * have cleared later picks that no longer follow from it.
 */
export function BracketEntryPage({ contest }: { contest: ContestDto }) {
  const { entryId = '' } = useParams<{ entryId: string }>();
  const contestId = contest.id;
  // A bracket covers one event (#721).
  const sportEventId = firstContestEvent(contest)?.sportEventId ?? '';
  const roundLabel = useBracketRoundLabel(contest.sport, sportEventId);

  const { gamePicksQuery, saveMutation, setTiebreakerDraft, submitMutation, tiebreakerDraft } = useGamePicks({
    action: 'bracket',
    contest,
    entryId,
    feature: 'bracket-entry-page',
    sportEventId,
  });
  const entryQuery = useContestEntryQuery(contestId, entryId);
  const leagueCode = useContestLeagueCode();

  if (gamePicksQuery.isLoading || entryQuery.isLoading) {
    return <LoadingState body="Loading bracket..." />;
  }
  if (gamePicksQuery.isError || !gamePicksQuery.data) {
    return (
      <ErrorState
        body="We couldn't load this bracket."
        onRetry={() => void gamePicksQuery.refetch()}
        testId="bracket-entry-error"
      />
    );
  }

  const gamePicks = gamePicksQuery.data;
  const eventStart = contestEventStart(contest.sport);
  const match = contestMatchNoun(contest.sport);
  const participant = contestParticipantNoun(contest.sport);
  const entrySummary = entryQuery.data?.entry ?? null;
  const rounds = buildBracketRounds(gamePicks.games, roundLabel);
  // A full bracket closes at the event's start; a second-chance one at its first round's first game.
  const closesAt = describeBracketClose(rounds, eventStart);
  const isOpen = gamePicks.games.some((game) => !game.locked);
  const canPick = gamePicks.ownEntry && isOpen;
  // Another entry's picks come back hidden until its games are revealed.
  const picksHidden = !gamePicks.ownEntry && !gamePicks.games.some((game) => game.revealed);

  const pick = (game: BracketGame, team: BracketTeam) => {
    saveMutation.reset();
    saveMutation.mutate({
      picks: [{ sportEventMatchId: game.sportEventMatchId, predictedResult: PredictedResult.TEAM, sportEventParticipantId: team.sportEventParticipantId }],
    });
  };
  const errorMessage = (error: Error | null, fallback: string) => (error
    ? extractErrorMessage(error, { codeMessages: bracketCodeMessages(contest.sport), fallback })
    : null);
  // A save with no picks is the tiebreaker's: its refusal shows beside the tiebreaker field.
  const isTiebreakerSave = saveMutation.variables?.picks.length === 0;
  const pickError = isTiebreakerSave ? null : errorMessage(saveMutation.error, 'We could not save that pick. Please try again.');
  const tiebreakerError = isTiebreakerSave
    ? errorMessage(saveMutation.error, 'We could not save your tiebreaker. Please try again.')
    : null;

  return (
    <ContestEntryFrame
      contest={contest}
      entry={entrySummary}
      entryId={entryId}
      leagueCode={leagueCode}
      phase={isOpen ? `Open until ${closesAt}` : contestStatusLabel(contest.status)}
      picksRevealed={entryQuery.data?.picksRevealed ?? false}
      status={picksHidden ? null : gamePicks.status}
      testId="bracket-entry-page"
      title={gamePicks.entryName}
    >

      {picksHidden ? (
        <Notice data-testid="bracket-picks-hidden">
          {`This bracket stays hidden until ${closesAt}. Every bracket is revealed then.`}
        </Notice>
      ) : (
        <>
          <Tile>
            <MetricGrid className="md:grid-cols-3">
              <MetricTile
                helperText={gamePicks.ownEntry && isOpen ? `Picks lock at ${closesAt}.` : 'Every pick is locked.'}
                label="Picked"
                value={<span data-testid="bracket-picked-count">{formatPickProgress(gamePicks.pickedCount, gamePicks.gameCount)}</span>}
              />
              <MetricTile
                helperText="Correct picks so far."
                label="Points"
                value={<span data-testid="bracket-points">{formatScore(gamePicks.points)}</span>}
              />
              <MetricTile
                helperText="Points so far plus every pick still alive."
                label="Max possible"
                value={<span data-testid="bracket-max-possible">{formatScore(gamePicks.maxPossiblePoints)}</span>}
              />
            </MetricGrid>
          </Tile>

          {pickError ? <Notice data-testid="bracket-pick-error" tone="danger">{pickError}</Notice> : null}

          <Tile>
            <Heading level={3} variant="card" size="xl" tone="inherit" className="mb-5" data-testid="contest-entry-builder-heading">
              {canPick ? 'Fill in your bracket' : 'Bracket'}
            </Heading>
            {canPick ? (
              <p className="mb-5 text-sm text-muted-foreground">
                {`Pick the winner of each ${match.one}. A later ${match.one} offers the ${participant.many} you picked to get there, and changing a pick clears the later picks that depended on it.`}
              </p>
            ) : null}
            <BracketBoard canPick={canPick} isBusy={saveMutation.isPending} onPick={pick} rounds={rounds} />
          </Tile>

          {canPick ? (
            <BracketSubmitPanel
              gamePicks={gamePicks}
              sport={contest.sport}
              isSaving={saveMutation.isPending}
              isSubmitting={submitMutation.isPending}
              onSaveTiebreaker={(tiebreakerValue) => {
                saveMutation.reset();
                saveMutation.mutate({ picks: [], tiebreakerValue });
              }}
              onSubmit={() => {
                submitMutation.reset();
                submitMutation.mutate();
              }}
              onTiebreakerChange={setTiebreakerDraft}
              saveError={tiebreakerError}
              submitError={errorMessage(submitMutation.error, 'We could not submit this bracket. Please try again.')}
              tiebreakerText={tiebreakerDraft ?? (gamePicks.tiebreakerValue === null ? '' : String(gamePicks.tiebreakerValue))}
            />
          ) : (
            <Tile data-testid="bracket-tiebreaker-summary">
              <p className="text-sm">
                {gamePicks.tiebreakerValue === null
                  ? 'No tiebreaker was saved.'
                  : `Tiebreaker: ${gamePicks.tiebreakerValue} total ${contestScoreUnit(contest.sport)} in the final.`}
              </p>
            </Tile>
          )}
        </>
      )}
    </ContestEntryFrame>
  );
}

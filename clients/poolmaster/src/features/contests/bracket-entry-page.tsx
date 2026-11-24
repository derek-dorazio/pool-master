import { useNavigate, useParams } from 'react-router';
import { ContestEntryStatus, PredictedResult } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { ContestDto } from '@/lib/api';
import {
  Notice,
  ErrorState,
  LoadingState,
  SectionCard,
  StatStrip,
} from '@/features/shared/ui';
import { buildHowToPlayFormatPath } from '@/features/event-pages/event-page-paths';
import { extractErrorMessage } from '@/lib/errors';
import { buildBracketRounds, describeBracketClose, describeBracketTiebreaker, formatEntryScore, type BracketGame, type BracketTeam } from './bracket-layout';
import { BracketView } from './bracket-view';
import { drawBracket } from './bracket-view-model';
import { ContestEntryFrame } from './contest-header';
import { EntryFinishCard } from './entry-finish-card';
import { entryFinishStatus, entryStatusLine } from './entry-status-line';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { useContestLeagueCode } from './use-contest-league';
import { contestEventStart, contestMatchNoun, contestParticipantNoun, contestScoreUnit, gamePickErrorValues } from './contest-sport';
import { firstContestEvent } from './contest-events';
import { canRenameEntries } from './contest-status';
import { useBracketRoundLabel } from './use-bracket-round-label';
import { useContestEntryQuery } from './use-contest-entries';
import { gameEntryFinish, SUBMIT_CLOSED } from './game-entry-finish';
import { useEntryName } from './use-entry-name';
import { useGamePicks } from './use-game-picks';
import { TiebreakerNumberField } from './tiebreaker-number-field';

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
  const navigate = useNavigate();
  const name = useEntryName({ contestId, entryId, savedName: gamePicksQuery.data?.entryName ?? '' });

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
    ? extractErrorMessage(error, { context: ['bracketEntry', 'gamePicks'], values: gamePickErrorValues(contest.sport), fallback })
    : null);
  const isSubmitted = gamePicks.status === ContestEntryStatus.SUBMITTED;
  const scoreUnit = contestScoreUnit(contest.sport);
  const submits = canPick && !isSubmitted;
  const {
    canSubmit, finish, finishError, isChanged, isFinishing, isTiebreakerSave, tiebreakerInvalid, tiebreakerText, typedTiebreaker,
  } = gameEntryFinish({
    canSubmit: gamePicks.canSubmit,
    errorMessage,
    name,
    // A submitted bracket returns to the contest's page (#1739).
    onSubmitted: () => void navigate(buildLeagueContestPath(leagueCode, contestId)),
    savedTiebreaker: gamePicks.tiebreakerValue,
    submitFallback: 'We could not submit this bracket. Please try again.',
    submits,
    writes: { saveMutation, submitMutation, tiebreakerDraft },
  });
  const pickError = isTiebreakerSave ? null : errorMessage(saveMutation.error, 'We could not save that pick. Please try again.');
  const stillToPick = gamePicks.gameCount - gamePicks.pickedCount;
  // What still blocks Submit, counting a tiebreaker typed but not yet saved: the button saves it first.
  const hint = stillToPick > 0
    ? `Pick every ${match.one} to submit: ${stillToPick} still to pick.`
    : (typedTiebreaker ?? gamePicks.tiebreakerValue) === null ? 'Enter your tiebreaker to submit.'
    : canSubmit ? null : SUBMIT_CLOSED;
  const nameEditable = gamePicks.ownEntry && canRenameEntries(contest);
  const status = picksHidden ? null : gamePicks.status;

  return (
    <ContestEntryFrame
      contest={contest}
      entry={entrySummary}
      leagueCode={leagueCode}
      phaseLabel={isOpen ? `Open until ${closesAt}` : enumLabel('ContestStatus', contest.status)}
      status={status}
      statusLine={entryStatusLine({ closes: closesAt, isOpen: canPick, status })}
      testId="bracket-entry-page"
      title={gamePicks.entryName}
    >

      {picksHidden ? (
        <Notice data-testid="bracket-picks-hidden">
          {`This bracket stays hidden until ${closesAt}. Every bracket is revealed then.`}
        </Notice>
      ) : (
        <>
          <StatStrip
            items={[
              { label: 'Picked', value: `${gamePicks.pickedCount} of ${gamePicks.gameCount}`, testId: 'bracket-picked-count' },
              { label: 'Points', value: formatEntryScore(gamePicks.points), testId: 'bracket-points' },
              { label: 'Max', value: formatEntryScore(gamePicks.maxPossiblePoints), testId: 'bracket-max-possible' },
            ]}
            testId="bracket-progress"
          />

          {pickError ? <Notice data-testid="bracket-pick-error" tone="danger">{pickError}</Notice> : null}

          <SectionCard
            headingLevel={3}
            help={canPick ? `Pick the winner of each ${match.one}. A later ${match.one} offers the ${participant.many} you picked to get there, and changing a pick clears the later picks that depended on it. Picks lock at ${closesAt}.` : undefined}
            helpLink={canPick ? { label: 'How to play', to: buildHowToPlayFormatPath(contest.sport ?? null, contest.selectionType) } : undefined}
            padded
            testId="bracket-picks"
            title={canPick ? 'Fill in your bracket' : 'Bracket'}
            titleTestId="contest-entry-builder-heading"
          >
            <BracketView
              drawing={drawBracket(gamePicks.games, roundLabel)}
              isOwnEntry={gamePicks.ownEntry}
              picking={canPick ? { isBusy: saveMutation.isPending, onPick: pick } : null}
              tiebreaker={canPick ? undefined : describeBracketTiebreaker(gamePicks.tiebreakerValue, scoreUnit)}
            />
          </SectionCard>

          {gamePicks.ownEntry && (canPick || nameEditable) ? (
            <EntryFinishCard
              action={submits ? {
                disabled: hint !== null || !canSubmit || tiebreakerInvalid || !name.isValid || isFinishing,
                isBusy: isFinishing,
                label: 'Submit bracket',
                onClick: () => void finish(),
                testId: 'bracket-submit',
              } : isChanged ? {
                disabled: tiebreakerInvalid || !name.isValid || isFinishing,
                isBusy: isFinishing,
                label: 'Save',
                onClick: () => void finish(),
                testId: 'bracket-save',
              } : null}
              error={finishError}
              errorTestId="bracket-submit-error"
              name={nameEditable ? { disabled: isFinishing, onChange: name.onChange, testId: 'contest-entry-name-input', value: name.value } : null}
              status={canPick ? entryFinishStatus({ closes: closesAt, hint, isSubmitted }) : enumLabel('ContestEntryStatus', gamePicks.status)}
              statusTestId="bracket-finish-status"
              testId="bracket-finish"
              title="Name and submit"
            >
              {canPick ? (
                <TiebreakerNumberField
                  disabled={isFinishing}
                  label={`Tiebreaker · total ${scoreUnit} in the final`}
                  onChange={setTiebreakerDraft}
                  testId="bracket-tiebreaker-input"
                  text={tiebreakerText}
                />
              ) : null}
            </EntryFinishCard>
          ) : null}
        </>
      )}
    </ContestEntryFrame>
  );
}

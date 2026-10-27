import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useParams } from 'react-router';
import { ContestEntryStatus, PredictedResult, type Sport } from '@poolmaster/shared/domain';
import {
  getGamePicks,
  saveGamePicks,
  submitGamePicks,
  type ContestDto,
  type GamePicksResponse,
  type SaveGamePicksRequest,
} from '@/lib/api';
import { buildLeagueContestPath, buildLeaguePath } from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import {
  Alert,
  ErrorState,
  LinkButton,
  LoadingState,
  MetricGrid,
  MetricTile,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { parseRouteState } from '@/routes/route-state';
import { BracketBoard } from './bracket-board';
import { BracketSubmitPanel } from './bracket-entry-submit';
import { buildBracketRounds, describeBracketClose, formatPickProgress, formatPoints, type BracketGame, type BracketTeam } from './bracket-layout';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { contestEventStart, contestMatchNoun, contestParticipantNoun, contestScoreUnit } from './contest-sport';
import { firstContestEvent } from './contest-events';
import {
  CONTEST_ENTRY_STATUS_LABELS,
  CONTEST_ENTRY_STATUS_TONES,
  CONTEST_POLL_INTERVAL_MS,
  CONTEST_STATUS_TONES,
  contestStatusLabel,
  shouldPollContestEntries,
} from './contest-status';
import { useBracketRoundLabel } from './use-bracket-round-label';
import { fetchContestEntries } from './use-contest-entries';

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
  const logger = getLogger().child({ feature: 'bracket-entry-page' });
  const { entryId = '', leagueCode: routeLeagueCode } = useParams<{ entryId: string; leagueCode?: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const contestId = contest.id;
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  // A bracket covers one event (#721).
  const sportEventId = firstContestEvent(contest)?.sportEventId ?? '';
  const gamePicksKey = QueryKeys.gamePicks.detail(contestId, entryId, sportEventId);
  // Null until the member types: the field shows the saved tiebreaker until then, so a refetch
  // never overwrites what is being typed (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  const [tiebreakerDraft, setTiebreakerDraft] = useState<string | null>(null);
  const roundLabel = useBracketRoundLabel(contest.sport, sportEventId);

  const gamePicksQuery = useQuery({
    queryKey: gamePicksKey,
    queryFn: async (): Promise<GamePicksResponse> => {
      const response = await getGamePicks({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, 'Bracket picks response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(entryId && sportEventId),
    retry: false,
    // Once the games are under way each pick's mark moves with the results.
    refetchInterval: shouldPollContestEntries(contest.status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league } = useLeagueContextById(contest.leagueId);

  const logRefusal = (action: string, error: Error) => {
    const payload = { action, data: { contestId, entryId }, err: error };
    if (error instanceof ApiError) {
      logger.warn(payload, 'Bracket write was rejected');
    } else {
      logger.error(payload, 'Bracket write failed unexpectedly');
    }
  };

  // Saving a pick or the tiebreaker answers with the whole bracket, which replaces the cache: the
  // server may have cleared later picks. The entry list carries its status, which a change can
  // send back to draft.
  const saveMutation = useInvalidatingMutation({
    mutationFn: async (body: SaveGamePicksRequest) => {
      const response = await saveGamePicks({ path: { contestId, entryId, sportEventId }, body });
      if (!response.data) {
        throwApiError(response.error, 'Bracket save response is missing data.');
      }
      return response.data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<GamePicksResponse>(gamePicksKey, saved);
      setTiebreakerDraft(null);
    },
    invalidates: [QueryKeys.contestEntries.byContest(contestId)],
    onError: (error) => {
      logRefusal('bracket.save.failed', error);
      // A refused pick means the bracket on screen is not the server's: read it again.
      void queryClient.invalidateQueries({ queryKey: gamePicksKey });
    },
  });

  const submitMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await submitGamePicks({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, 'Bracket submit response is missing data.');
      }
      return response.data;
    },
    onSuccess: (submitted) => {
      logger.info({ action: 'bracket.submit.succeeded', data: { contestId, entryId } }, 'Submitted bracket');
      queryClient.setQueryData<GamePicksResponse>(gamePicksKey, submitted);
    },
    invalidates: [QueryKeys.contestEntries.byContest(contestId), QueryKeys.contests.detail(contestId)],
    onError: (error) => logRefusal('bracket.submit.failed', error),
  });

  if (gamePicksQuery.isLoading || contestEntriesQuery.isLoading) {
    return <LoadingState body="Loading bracket..." />;
  }
  if (gamePicksQuery.isError || !gamePicksQuery.data) {
    return (
      <ErrorState
        body="Try refreshing or return to the contest board."
        testId="bracket-entry-error"
        title="We couldn't load this bracket."
      />
    );
  }

  const gamePicks = gamePicksQuery.data;
  const eventStart = contestEventStart(contest.sport);
  const match = contestMatchNoun(contest.sport);
  const participant = contestParticipantNoun(contest.sport);
  const backLeagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;
  const backToContestPath = backLeagueCode ? buildLeagueContestPath(backLeagueCode, contestId) : `/contests/${contestId}`;
  const entrySummary = contestEntriesQuery.data?.entries.find((entry) => entry.id === entryId) ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const rounds = buildBracketRounds(gamePicks.games, roundLabel);
  // A full bracket closes at the event's start; a second-chance one at its first round's first game.
  const closesAt = describeBracketClose(rounds, eventStart);
  const isOpen = gamePicks.games.some((game) => !game.locked);
  const canPick = gamePicks.ownEntry && isOpen;
  // Another entry's picks come back hidden until its games are revealed.
  const picksHidden = !gamePicks.ownEntry && !gamePicks.games.some((game) => game.revealed);
  const statusLabel = CONTEST_ENTRY_STATUS_LABELS[gamePicks.status];

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
    <section className="space-y-6" data-testid="bracket-entry-page">
      <ContestHeader
        actions={(
          <>
            {backLeagueCode ? null : (
              <LinkButton data-testid="contest-entry-back-to-contest" to={backToContestPath} variant="secondary">
                Back to contest
              </LinkButton>
            )}
            <LinkButton
              data-testid="contest-entry-back-to-league"
              to={backLeagueCode ? buildLeaguePath(backLeagueCode) : '/welcome'}
              variant="secondary"
            >
              Back to league
            </LinkButton>
          </>
        )}
        badges={(
          <>
            <StatusBadge tone={CONTEST_STATUS_TONES[contest.status]}>
              {isOpen ? `Open until ${closesAt}` : contestStatusLabel(contest.status)}
            </StatusBadge>
            {picksHidden ? null : (
              <StatusBadge data-testid="contest-entry-status-badge" tone={CONTEST_ENTRY_STATUS_TONES[gamePicks.status]}>
                {statusLabel}
              </StatusBadge>
            )}
          </>
        )}
        menu={backLeagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current={myEntryIds.includes(entryId) ? 'my-entry' : null}
            leagueCode={backLeagueCode}
            myEntryId={myEntryIds[0] ?? null}
            picksRevealed={contestEntriesQuery.data?.picksRevealed ?? false}
          />
        ) : null}
        summary={(
          <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-entry-summary">
            {contest.name}
            {entrySummary ? ` · ${entrySummary.squadName} · Entry ${entrySummary.entryNumber}` : ''}
          </p>
        )}
        title={gamePicks.entryName}
        titleTestId="contest-entry-heading"
      />

      {picksHidden ? (
        <Alert data-testid="bracket-picks-hidden">
          {`This bracket stays hidden until ${closesAt}. Every bracket is revealed then.`}
        </Alert>
      ) : (
        <>
          <Tile>
            <MetricGrid className="md:grid-cols-4">
              <MetricTile
                helperText={gamePicks.ownEntry && isOpen ? `Picks lock at ${closesAt}.` : 'Every pick is locked.'}
                label="Picked"
                value={<span data-testid="bracket-picked-count">{formatPickProgress(gamePicks.pickedCount, gamePicks.gameCount)}</span>}
              />
              <MetricTile
                helperText={gamePicks.status === ContestEntryStatus.SUBMITTED ? 'This bracket counts.' : 'Only a submitted bracket counts.'}
                label="Status"
                value={<span data-testid="bracket-status">{statusLabel}</span>}
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

          {pickError ? <Alert data-testid="bracket-pick-error" tone="danger">{pickError}</Alert> : null}

          <Tile>
            <h3 className="title-card mb-5 text-xl" data-testid="contest-entry-builder-heading">
              {canPick ? 'Fill in your bracket' : 'Bracket'}
            </h3>
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
    </section>
  );
}

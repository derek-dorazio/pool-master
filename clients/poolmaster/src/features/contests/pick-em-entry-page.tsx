import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ContestEntryStatus, PickEmMode } from '@poolmaster/shared/domain';
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
  Button,
  ErrorState,
  LinkButton,
  LoadingState,
  MetricGrid,
  MetricTile,
  StatusBadge,
  Tile,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { parseRouteState } from '@/routes/route-state';
import { formatPickProgress, formatPoints } from './bracket-layout';
import { ContestEventSwitcher } from './contest-event-switcher';
import { currentContestEvent, entryEventStatus } from './contest-events';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { formatPickEmModeName } from './contest-rules';
import {
  CONTEST_ENTRY_STATUS_LABELS,
  CONTEST_ENTRY_STATUS_TONES,
  CONTEST_POLL_INTERVAL_MS,
  CONTEST_STATUS_TONES,
  contestStatusLabel,
  shouldPollContestEntries,
} from './contest-status';
import { PickEmGames } from './pick-em-games';
import {
  canChangeWeek,
  confidencePicks,
  firstKickoff,
  missedWeek,
  teamPick,
  weekSubmitHint,
  type PickEmGame,
  type PickEmTeam,
} from './pick-em-week';
import { fetchContestEntries } from './use-contest-entries';

/**
 * Copy for the refusals a week's picks, tiebreaker and submit can meet (#718). The codes are the
 * contract; the server's own sentences are a fallback for anything not listed.
 */
const PICK_EM_CODE_MESSAGES: ErrorCodeMessages = {
  PREDICTION_WEEK_INCOMPLETE: 'Every game needs a pick before this week can be submitted.',
  PREDICTION_CONFIDENCE_INVALID: 'Give each pick a different confidence value, from 1 up to the number of games.',
  PREDICTION_TIEBREAKER_MISSING: 'Save your tiebreaker, the total points of the tiebreaker game, before you submit.',
  PREDICTION_GAME_STARTED: 'That game has kicked off, so its pick is locked.',
  PREDICTION_CLEAR_AFTER_FIRST_KICKOFF: 'The week has started, so a pick can be changed to the other team but not removed.',
  CONTEST_ENTRY_LOCKED: 'The games have kicked off, so this can no longer change.',
};

/** What the entry has scored, once anyone can see it; a dash before. */
function formatScore(points: number | null) {
  return points === null ? '—' : formatPoints(points);
}

/**
 * A pick'em contest's entry page (#718): one week at a time, with a switcher for the season's
 * weeks. The entry's own week takes a pick on each game, a confidence value in a confidence pool,
 * the tiebreaker on the week's last game, and a submit before the first kickoff; after that its
 * picks lock game by game. Another entry's week shows each pick from its game's kickoff.
 */
export function PickEmEntryPage({ contest }: { contest: ContestDto }) {
  const logger = getLogger().child({ feature: 'pick-em-entry-page' });
  const { entryId = '', leagueCode: routeLeagueCode } = useParams<{ entryId: string; leagueCode?: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const contestId = contest.id;
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  // The week being picked, else the latest played, until the member switches.
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  const sportEventId = requestedEventId ?? currentContestEvent(contest)?.sportEventId ?? '';
  const gamePicksKey = QueryKeys.gamePicks.detail(contestId, entryId, sportEventId);
  // Null until the member types: the field shows the saved tiebreaker until then, so a refetch
  // never overwrites what is being typed (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  const [tiebreakerDraft, setTiebreakerDraft] = useState<string | null>(null);

  const gamePicksQuery = useQuery({
    queryKey: gamePicksKey,
    queryFn: async (): Promise<GamePicksResponse> => {
      const response = await getGamePicks({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, 'Pick\'em week response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(entryId && sportEventId),
    retry: false,
    // Once the week is under way each pick's mark moves with the results.
    refetchInterval: shouldPollContestEntries(contest.status) ? CONTEST_POLL_INTERVAL_MS : false,
  });
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league } = useLeagueContextById(contest.leagueId);

  const logRefusal = (action: string, error: Error) => {
    const payload = { action, data: { contestId, entryId, sportEventId }, err: error };
    if (error instanceof ApiError) {
      logger.warn(payload, 'Pick\'em write was rejected');
    } else {
      logger.error(payload, 'Pick\'em write failed unexpectedly');
    }
  };

  // A save answers with the whole week, which replaces the cache. The entry list carries each
  // week's status, which a change can move.
  const saveMutation = useInvalidatingMutation({
    mutationFn: async (body: SaveGamePicksRequest) => {
      const response = await saveGamePicks({ path: { contestId, entryId, sportEventId }, body });
      if (!response.data) {
        throwApiError(response.error, 'Pick\'em save response is missing data.');
      }
      return response.data;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<GamePicksResponse>(gamePicksKey, saved);
      setTiebreakerDraft(null);
    },
    invalidates: [QueryKeys.contestEntries.byContest(contestId)],
    onError: (error) => {
      logRefusal('pickEm.save.failed', error);
      // A refused pick means the week on screen is not the server's: read it again.
      void queryClient.invalidateQueries({ queryKey: gamePicksKey });
    },
  });

  const submitMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await submitGamePicks({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, 'Pick\'em submit response is missing data.');
      }
      return response.data;
    },
    onSuccess: (submitted) => {
      logger.info({ action: 'pickEm.submit.succeeded', data: { contestId, entryId, sportEventId } }, 'Submitted pick\'em week');
      queryClient.setQueryData<GamePicksResponse>(gamePicksKey, submitted);
    },
    invalidates: [
      QueryKeys.contestEntries.byContest(contestId),
      QueryKeys.contests.detail(contestId),
      QueryKeys.contests.pickEmLeaderboard(contestId),
    ],
    onError: (error) => logRefusal('pickEm.submit.failed', error),
  });

  const switchWeek = (next: string) => {
    saveMutation.reset();
    submitMutation.reset();
    setTiebreakerDraft(null);
    setRequestedEventId(next);
  };

  if (gamePicksQuery.isLoading || contestEntriesQuery.isLoading) {
    return <LoadingState body="Loading picks..." />;
  }
  if (gamePicksQuery.isError || !gamePicksQuery.data) {
    return (
      <ErrorState
        body="Try refreshing or return to the contest board."
        testId="pick-em-entry-error"
        title="We couldn't load these picks."
      />
    );
  }

  const gamePicks = gamePicksQuery.data;
  const backLeagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;
  const backToContestPath = backLeagueCode ? buildLeagueContestPath(backLeagueCode, contestId) : `/contests/${contestId}`;
  const entrySummary = contestEntriesQuery.data?.entries.find((entry) => entry.id === entryId) ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const canChange = canChangeWeek(gamePicks);
  const isSubmitted = gamePicks.status === ContestEntryStatus.SUBMITTED;
  const kickoff = firstKickoff(gamePicks.games);
  const statusLabel = CONTEST_ENTRY_STATUS_LABELS[gamePicks.status];
  const hint = isSubmitted ? null : weekSubmitHint(gamePicks);

  const save = (body: SaveGamePicksRequest) => {
    saveMutation.reset();
    saveMutation.mutate(body);
  };
  const pick = (game: PickEmGame, team: PickEmTeam) => save({ picks: [teamPick(game, team, gamePicks.mode)] });
  const rank = (game: PickEmGame, value: number | null) => {
    const picks = confidencePicks(gamePicks.games, game, value);
    if (picks.length) {
      save({ picks });
    }
  };
  const errorMessage = (error: Error | null, fallback: string) => (error
    ? extractErrorMessage(error, { codeMessages: PICK_EM_CODE_MESSAGES, fallback })
    : null);
  // A save with no picks is the tiebreaker's: its refusal shows beside the tiebreaker field.
  const isTiebreakerSave = saveMutation.variables?.picks.length === 0;
  const pickError = isTiebreakerSave ? null : errorMessage(saveMutation.error, 'We could not save that pick. Please try again.');

  return (
    <section className="space-y-6" data-testid="pick-em-entry-page">
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
            <StatusBadge tone={CONTEST_STATUS_TONES[contest.status]}>{contestStatusLabel(contest.status)}</StatusBadge>
            <StatusBadge data-testid="contest-entry-status-badge" tone={CONTEST_ENTRY_STATUS_TONES[gamePicks.status]}>
              {statusLabel}
            </StatusBadge>
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
            {gamePicks.mode ? ` · ${formatPickEmModeName(gamePicks.mode)}` : ''}
            {entrySummary ? ` · ${entrySummary.squadName} · Entry ${entrySummary.entryNumber}` : ''}
          </p>
        )}
        title={gamePicks.entryName}
        titleTestId="contest-entry-heading"
      />

      <ContestEventSwitcher
        describe={(sportEvent) => (entrySummary ? CONTEST_ENTRY_STATUS_LABELS[entryEventStatus(entrySummary, sportEvent.sportEventId)] : null)}
        events={contest.sportEvents}
        label="Week"
        onChange={switchWeek}
        testId="pick-em-week-switcher"
        value={sportEventId}
      />

      {canChange && !isSubmitted && kickoff ? (
        <Alert data-testid="pick-em-not-submitted-warning" title="Not submitted yet" tone="warning">
          {`Submit this week before the first kickoff, ${formatDateTimeDisplay(kickoff)}. A week that isn't submitted by then scores nothing.`}
        </Alert>
      ) : null}
      {missedWeek(gamePicks) ? (
        <Alert data-testid="pick-em-missed-week">
          This week wasn&apos;t submitted before its first kickoff, so it scores nothing.
        </Alert>
      ) : null}

      <Tile>
        <MetricGrid className="md:grid-cols-4">
          <MetricTile
            helperText={canChange ? 'Each pick locks at its game\'s kickoff.' : 'No pick can change now.'}
            label="Picked"
            value={<span data-testid="pick-em-picked-count">{formatPickProgress(gamePicks.pickedCount, gamePicks.gameCount)}</span>}
          />
          <MetricTile
            helperText={isSubmitted ? 'This week counts.' : 'Only a submitted week counts.'}
            label="Status"
            value={<span data-testid="pick-em-status">{statusLabel}</span>}
          />
          <MetricTile
            helperText={gamePicks.mode === PickEmMode.CONFIDENCE ? 'The values of the correct picks so far.' : 'One point for each correct pick so far.'}
            label="Points"
            value={<span data-testid="pick-em-points">{formatScore(gamePicks.points)}</span>}
          />
          <MetricTile
            helperText="Points so far plus every pick still to be decided."
            label="Max possible"
            value={<span data-testid="pick-em-max-possible">{formatScore(gamePicks.maxPossiblePoints)}</span>}
          />
        </MetricGrid>
      </Tile>

      {pickError ? <Alert data-testid="pick-em-pick-error" tone="danger">{pickError}</Alert> : null}

      <Tile>
        <h3 className="mb-2 text-xl font-semibold" data-testid="contest-entry-builder-heading">
          {canChange ? 'Pick each game' : 'Picks'}
        </h3>
        {canChange ? (
          <p className="mb-5 text-sm text-muted-foreground">
            {gamePicks.mode === PickEmMode.CONFIDENCE
              ? `Tap the team you think wins each game, then rank your picks from ${gamePicks.gameCount}, the one you're surest of, down to 1. A correct pick scores its value.`
              : 'Tap the team you think wins each game. Each correct pick scores 1 point.'}
          </p>
        ) : null}
        <PickEmGames
          canChange={canChange}
          gamePicks={gamePicks}
          isBusy={saveMutation.isPending}
          onConfidence={rank}
          onPick={pick}
          tiebreaker={{
            isSaving: saveMutation.isPending,
            onChange: setTiebreakerDraft,
            onSave: (tiebreakerValue) => save({ picks: [], tiebreakerValue }),
            saveError: isTiebreakerSave ? errorMessage(saveMutation.error, 'We could not save your tiebreaker. Please try again.') : null,
            text: tiebreakerDraft ?? (gamePicks.tiebreakerValue === null ? '' : String(gamePicks.tiebreakerValue)),
          }}
        />
      </Tile>

      {gamePicks.ownEntry && (canChange || isSubmitted) ? (
        <Tile className="space-y-3" data-testid="pick-em-submit-panel">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-semibold">Submit</h3>
            <span className="text-sm text-muted-foreground" data-testid="pick-em-progress">
              {formatPickProgress(gamePicks.pickedCount, gamePicks.gameCount)}
            </span>
          </div>
          {isSubmitted ? (
            <Alert data-testid="pick-em-submitted" title="Submitted" tone="success">
              This week counts. You can still change a pick until its game kicks off.
            </Alert>
          ) : (
            <>
              {hint ? <p className="text-sm text-muted-foreground" data-testid="pick-em-submit-hint">{hint}</p> : null}
              <Button
                data-testid="pick-em-submit"
                disabled={!gamePicks.canSubmit || submitMutation.isPending || saveMutation.isPending}
                onClick={() => {
                  submitMutation.reset();
                  submitMutation.mutate();
                }}
              >
                {submitMutation.isPending ? 'Submitting...' : 'Submit week'}
              </Button>
            </>
          )}
          {submitMutation.error ? (
            <Alert data-testid="pick-em-submit-error" tone="danger">
              {errorMessage(submitMutation.error, 'We could not submit this week. Please try again.')}
            </Alert>
          ) : null}
        </Tile>
      ) : null}
    </section>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { getContest, getSelectionState, selectContestPick, submitContestEntry, unselectContestPick, updateContestEntry, type SelectionStateResponse, type ContestDto } from '@/lib/api';
import {
  buildLeagueContestPath,
} from '@/features/leagues/league-routing';
import { ContestEntryStatus, ContestStatus, SelectionType, formatDollars, type SportNoun } from '@poolmaster/shared/domain';
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import {
  Alert,
  DefinitionList,
  ErrorState,
  formatDateTimeDisplay,
  FormField,
  Heading,
  Input,
  LoadingState,
  MetricGrid,
  MetricTile,
  StatusBadge,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import {
  EditableSelectionGroup,
  LockedSelectionGroup,
  TiebreakerSelector,
  type SelectionGroup,
} from './contest-entry-selection';
import { BudgetLineupBuilder, LockedBudgetLineup } from './contest-entry-budget';
import { BracketEntryPage } from './bracket-entry-page';
import { PickEmEntryPage } from './pick-em-entry-page';
import { SquaresEntryPage } from './squares-pages';
import { DrawEntryMetrics, DrawLineup } from './contest-entry-draw';
import {
  buildPickedAtById,
  CONTEST_ENTRY_CODE_MESSAGES,
  getNextSelectedParticipantIds,
  lineupRulesFor,
  mergePickChange,
} from './contest-entry-lineup';
import {
  areContestEntriesOpen,
  CONTEST_ENTRY_STATUS_LABELS,
  CONTEST_ENTRY_STATUS_TONES,
  CONTEST_STATUS_TONES,
  contestStatusLabel,
} from './contest-status';
import { ContestEntryBackLinks, ContestPageFrame } from './contest-header';
import { entryPageView } from './contest-page-view';
import { useContestLeague } from './use-contest-league';
import { contestEntryTiebreaker, contestRosterParticipantNoun } from './contest-sport';
import { entryWriteKeys, useContestEntryQuery } from './use-contest-entries';
import { contestSchedule } from './use-contest-schedule';
import { ContestEventSwitcher } from './contest-event-switcher';
import { entryEventStatus, hasContestEventStarted } from './contest-events';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

type SelectionState = SelectionStateResponse;
/** One tap on a field row: `isSelected` is whether the entry held it before the tap. */
type PickChange = { participantId: string; isSelected: boolean };

const HIDDEN_PICKS_HELPER = 'Hidden until the event starts';

function formatStillToPick(count: number, participant: SportNoun): string {
  return `${count} ${count === 1 ? participant.one : participant.many} still to pick`;
}

// The entry page says what an open contest means for this entry; every other status reads as it
// does on every contest page.
function getContestPhaseLabel(contest: ContestDto, entriesOpen: boolean) {
  if (entriesOpen) {
    return contest.selectionType === SelectionType.RANDOM_DRAW
      ? 'Open until the draw'
      : 'Editable until the event starts';
  }
  // Still OPEN past its start means the event has teed off and the In Progress update is late.
  return contest.status === ContestStatus.OPEN ? 'Entries closed' : contestStatusLabel(contest.status);
}

function getCompletionStats(selectionGroups: SelectionGroup[]) {
  const completedTiers = selectionGroups.filter(
    (group) => group.selectedParticipantIds.length >= group.picksFromGroup,
  ).length;
  const totalSelections = selectionGroups.reduce(
    (sum, group) => sum + group.selectedParticipantIds.length,
    0,
  );
  const requiredSelections = selectionGroups.reduce(
    (sum, group) => sum + group.picksFromGroup,
    0,
  );

  return {
    completedTiers,
    totalSelections,
    requiredSelections,
  };
}

function getNextIncompleteGroupId(selectionGroups: SelectionGroup[]) {
  return selectionGroups.find((group) => group.selectedParticipantIds.length < group.picksFromGroup)?.groupId ?? null;
}

/**
 * The contest entry page: a bracket contest's entries fill in a bracket (#721), a pick'em
 * contest's pick each week's games (#718), a squares contest's claim boxes on the grid (#711); every roster contest's build a lineup in the selection
 * room. The contest read says which, and is shared
 * with the page it opens through the contest's own key.
 */
export function ContestEntryPage() {
  const { contestId = '' } = useParams<{ contestId: string }>();
  const contestQuery = useQuery(contestDetailQueryOptions(contestId));
  if (contestQuery.isLoading) {
    return <LoadingState body="Loading contest entry..." />;
  }
  if (contestQuery.data?.selectionType === SelectionType.BRACKET) {
    return <BracketEntryPage contest={contestQuery.data} />;
  }
  // A survivor week is picked on the pick'em week screen (#719).
  if (contestQuery.data?.selectionType === SelectionType.PICK_EM || contestQuery.data?.selectionType === SelectionType.SURVIVOR) {
    return <PickEmEntryPage contest={contestQuery.data} />;
  }
  // A squares entry claims boxes on the grid (#711).
  if (contestQuery.data?.selectionType === SelectionType.SQUARES) {
    return <SquaresEntryPage contest={contestQuery.data} />;
  }
  return <RosterContestEntryPage />;
}

function contestDetailQueryOptions(contestId: string) {
  return {
    queryKey: QueryKeys.contests.detail(contestId),
    queryFn: async (): Promise<ContestDto> => {
      const response = await getContest({ path: { contestId } });
      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest detail response is missing data.');
      }
      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
  };
}

/** A roster contest's entry: its lineup, picked in the selection room for each of its events. */
function RosterContestEntryPage() {
  const displayPreferences = useDisplayPreferences();
  const logger = getLogger().child({
    feature: 'contest-entry-page',
  });
  const { contestId = '', entryId = '', leagueCode: routeLeagueCode } = useParams<{
    contestId: string;
    entryId: string;
    leagueCode?: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;
  // Null opens the room on the contest's current event; the server says which one that is.
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  const selectionStateQueryKey = QueryKeys.selectionStates.detail(contestId, entryId, requestedEventId ?? undefined);
  const groupToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [entryNameDraft, setEntryNameDraft] = useState('');
  const [tiebreakerDraft, setTiebreakerDraft] = useState('');
  const [draftDetailsSeedKey, setDraftDetailsSeedKey] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const contestQuery = useQuery(contestDetailQueryOptions(contestId));

  const entryQuery = useContestEntryQuery(contestId, entryId);

  const selectionStateQuery = useQuery({
    queryKey: selectionStateQueryKey,
    queryFn: async (): Promise<SelectionState> => {
      const response = await getSelectionState({
        path: { contestId },
        query: requestedEventId ? { entryId, sportEventId: requestedEventId } : { entryId },
      });
      if (!response.data) {
        throwApiError(response.error, 'Selection state response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId && entryId),
    retry: false,
  });

  /*
   * #202 — the league-context read, by id.
   *
   * This was a bespoke query under a key called `contestLeagueCodes`, existing to turn the
   * contest's `leagueId` into a `leagueCode` for the back link. `getLeague` returns the same
   * `LeagueContextResponse` as the by-code read now, so this is the shared hook: the league (for
   * its code) and the viewer's edges, cached under the league rather than under a
   * contest-shaped key that nothing else could reuse.
   */
  const { leagueCode: backLeagueCode } = useContestLeague(contestQuery.data?.leagueId, hintedLeagueCode);
  // The event's start is the entry cutoff (#431); the contest's status follows the event's own
  // move to in progress, which can lag the start, and the server refuses picks from the start on.
  const schedule = contestSchedule(contestQuery.data);
  const detailsSeedSource = useMemo(() => {
    if (!selectionStateQuery.data) {
      return null;
    }

    return {
      name: selectionStateQuery.data.selectedEntryName ?? '',
      tiebreakerValue: selectionStateQuery.data.tiebreakerValue,
    };
    // Keyed on selectedEntryName and tiebreakerValue on purpose: a refetch must not rebuild the draft
    // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionStateQuery.data?.selectedEntryName, selectionStateQuery.data?.tiebreakerValue]);
  const selectableGroups = useMemo(
    () => selectionStateQuery.data?.selectionGroups ?? [],
    [selectionStateQuery.data?.selectionGroups],
  );

  useEffect(() => {
    if (!detailsSeedSource) {
      return;
    }

    const nextSeedKey = `${contestId}:${entryId}`;
    if (draftDetailsSeedKey === nextSeedKey) {
      return;
    }

    setEntryNameDraft(detailsSeedSource.name);
    setTiebreakerDraft(
      detailsSeedSource.tiebreakerValue === null || detailsSeedSource.tiebreakerValue === undefined
        ? ''
        : String(detailsSeedSource.tiebreakerValue),
    );
    setDraftDetailsSeedKey(nextSeedKey);
  }, [contestId, detailsSeedSource, draftDetailsSeedKey, entryId]);

  useEffect(() => {
    if (!selectableGroups.length) {
      setExpandedGroupId(null);
      return;
    }

    const nextIncomplete = getNextIncompleteGroupId(selectableGroups);
    setExpandedGroupId((current) => {
      if (current && selectableGroups.some((group) => group.groupId === current)) {
        return current;
      }

      return nextIncomplete;
    });
  }, [selectableGroups]);

  useEffect(() => {
    if (!expandedGroupId) {
      return;
    }

    const groupToggle = groupToggleRefs.current[expandedGroupId];
    if (!groupToggle) {
      return;
    }

    const focusGroup = () => {
      groupToggle.scrollIntoView({ behavior: 'smooth', block: 'start' });
      groupToggle.focus();
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusGroup);
      return;
    }

    focusGroup();
  }, [expandedGroupId]);

  useEffect(() => {
    if (
      !contestQuery.isError
      && !selectionStateQuery.isError
      && !entryQuery.isError
    ) {
      return;
    }

    logger.warn(
      {
        action: 'contestEntry.load.failed',
        data: {
          contestId,
          entryId,
        },
        err: contestQuery.error ?? selectionStateQuery.error ?? entryQuery.error,
      },
      'Contest entry page failed to load required data',
    );
  }, [
    entryQuery.error,
    entryQuery.isError,
    contestId,
    contestQuery.error,
    contestQuery.isError,
    selectionStateQuery.error,
    selectionStateQuery.isError,
    entryId,
    logger,
  ]);

  useEffect(() => {
    if (!contestQuery.data || !selectionStateQuery.data || !entryQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestEntry.page.loaded',
        data: {
          contestId,
          entryId,
          status: contestQuery.data.status,
          selectionGroupCount: selectionStateQuery.data.selectionGroups?.length ?? 0,
        },
      },
      'Contest entry page loaded',
    );
  }, [entryQuery.data, contestId, contestQuery.data, selectionStateQuery.data, entryId, logger]);

  const saveEntryDetailsMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const trimmedName = entryNameDraft.trim();
      const normalizedTiebreaker = tiebreakerDraft.trim();
      const body: { name?: string; tiebreakerValue?: number } = {};

      if (
        trimmedName
        && trimmedName !== (selectionStateQuery.data?.selectedEntryName ?? '')
      ) {
        body.name = trimmedName;
      }

      const currentTiebreakerValue = selectionStateQuery.data?.tiebreakerValue ?? null;
      const nextTiebreakerValue =
        normalizedTiebreaker.length === 0 ? null : Number.parseInt(normalizedTiebreaker, 10);

      if (
        normalizedTiebreaker.length > 0
        && Number.isFinite(nextTiebreakerValue)
      ) {
        if (nextTiebreakerValue !== currentTiebreakerValue) {
          body.tiebreakerValue = nextTiebreakerValue as number;
        }
      }

      if (!Object.keys(body).length) {
        return null;
      }

      const response = await updateContestEntry({
        path: { contestId, entryId },
        body,
      });

      if (!response.data?.entry) {
        throwApiError(response.error, 'Contest entry update response is missing data.');
      }

      return response.data.entry;
    },
    onMutate: () => {
      logger.debug(
        {
          action: 'contestEntry.saveDetails.started',
          data: {
            contestId,
            entryId,
          },
        },
        'Starting contest entry detail save',
      );
    },
    onSuccess: () => {
      logger.info(
        {
          action: 'contestEntry.saveDetails.succeeded',
          data: {
            contestId,
            entryId,
          },
        },
        'Saved contest entry details',
      );
    },
    invalidates: [
      ...entryWriteKeys(contestId),
      selectionStateQueryKey,
    ],
    onError: (error) => {
      const payload = {
        action: 'contestEntry.saveDetails.failed',
        data: {
          contestId,
          entryId,
        },
        err: error,
      };

      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest entry detail save was rejected');
      } else {
        logger.error(payload, 'Contest entry detail save failed unexpectedly');
      }
    },
  });

  // One pick at a time, by the field row's id (#1259): a held golfer is unselected, anyone else
  // selected. The page shows the change at once, takes the server's answer about that one entry
  // into what it shows, and reads nothing again; a refusal puts the page back as it was.
  const pickChangeMutation = useInvalidatingMutation({
    mutationFn: async ({ participantId, isSelected }: PickChange) => {
      const path = { contestId, entryId, sportEventParticipantId: participantId };
      const response = isSelected
        ? await unselectContestPick({ path })
        : await selectContestPick({ path });

      if (!response.data) {
        throwApiError(response.error, 'Contest pick response is missing data.');
      }

      return response.data;
    },
    onMutate: async ({ participantId, isSelected }) => {
      logger.debug(
        {
          action: 'contestEntry.pickChange.started',
          data: {
            contestId,
            entryId,
            participantId,
            isSelected,
          },
        },
        'Starting contest pick change',
      );
      await queryClient.cancelQueries({ queryKey: selectionStateQueryKey });
      const previousSelectionState = queryClient.getQueryData<SelectionState>(selectionStateQueryKey);

      const lineupRules = previousSelectionState ? lineupRulesFor(previousSelectionState.selectionType) : null;
      if (previousSelectionState && lineupRules) {
        queryClient.setQueryData<SelectionState>(
          selectionStateQueryKey,
          lineupRules.applySelection(previousSelectionState, participantId, entryId),
        );
      }

      return { previousSelectionState };
    },
    onSuccess: (change) => {
      logger.info(
        {
          action: 'contestEntry.pickChange.succeeded',
          data: {
            contestId,
            entryId,
            entryStatus: change.entryStatus,
          },
        },
        'Changed contest pick',
      );
      queryClient.setQueryData<SelectionState>(
        selectionStateQueryKey,
        (current) => (current ? mergePickChange(current, change) : current),
      );
      // A pick can send a submitted entry back to draft, which the contest's entry lists and
      // counts show. Those reads are marked stale for the next page that shows them, and none is
      // read again here: this page already shows what changed.
      for (const queryKey of [...entryWriteKeys(contestId), QueryKeys.contestEntries.detail(contestId, entryId)]) {
        void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
      }
    },
    invalidates: [],
    onError: (error, { participantId }, context) => {
      if (context?.previousSelectionState) {
        queryClient.setQueryData<SelectionState>(selectionStateQueryKey, context.previousSelectionState);
      }
      const payload = {
        action: 'contestEntry.pickChange.failed',
        data: {
          contestId,
          entryId,
          participantId,
        },
        err: error,
      };

      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest pick change was rejected');
      } else {
        logger.error(payload, 'Contest pick change failed unexpectedly');
      }
    },
  });

  // Submitting is what makes the entry count (#481), one event's picks at a time (#713); the
  // server refuses an incomplete lineup.
  const submitEntryMutation = useInvalidatingMutation({
    mutationFn: async (sportEventId: string) => {
      const response = await submitContestEntry({ path: { contestId, entryId, sportEventId } });
      if (!response.data) {
        throwApiError(response.error, 'Contest entry submit response is missing data.');
      }
      return response.data;
    },
    onSuccess: (selectionState) => {
      logger.info(
        {
          action: 'contestEntry.submit.succeeded',
          data: { contestId, entryId },
        },
        'Submitted contest entry',
      );
      queryClient.setQueryData<SelectionState>(selectionStateQueryKey, selectionState);
    },
    invalidates: [
      ...entryWriteKeys(contestId),
    ],
    onError: (error) => {
      const payload = {
        action: 'contestEntry.submit.failed',
        data: { contestId, entryId },
        err: error,
      };

      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest entry submit was rejected');
      } else {
        logger.error(payload, 'Contest entry submit failed unexpectedly');
      }
    },
  });

  if (contestQuery.isLoading || selectionStateQuery.isLoading || entryQuery.isLoading) {
    return <LoadingState body="Loading contest entry..." />;
  }

  if (
    contestQuery.isError
    || !contestQuery.data
    || selectionStateQuery.isError
    || !selectionStateQuery.data
    || entryQuery.isError
  ) {
    return (
      <ErrorState
        body="Try refreshing or return to the contest board."
        title="We couldn't load this contest entry."
      />
    );
  }

  const contest = contestQuery.data;
  const selectionState = selectionStateQuery.data;
  const participantNoun = contestRosterParticipantNoun(contest);
  // The prediction the contest's scoring family asks for: a golf entry's winning score, none
  // for a race, whose entries submit without one.
  const tiebreaker = contestEntryTiebreaker(contest);
  const backToContestPath = backLeagueCode
    ? buildLeagueContestPath(backLeagueCode, contestId)
    : `/contests/${contestId}`;
  const entrySummary = entryQuery.data?.entry ?? null;
  const myEntryIds = contest.myEntryIds ?? [];
  const isMyEntry = myEntryIds.includes(entryId);
  const isRandomDraw = contest.selectionType === SelectionType.RANDOM_DRAW;
  const shownEventId = selectionState.sportEventId;
  const shownEvent = contest.sportEvents.find((sportEvent) => sportEvent.sportEventId === shownEventId) ?? null;
  // The entry's name and tiebreaker are the contest's: they lock when its first event starts. A
  // random draw closes entries when it deals, even though the contest stays open until tee-off.
  const detailsEditable = areContestEntriesOpen({ status: contest.status, drawnAt: contest.drawnAt ?? selectionState.drawnAt }, schedule?.startsAt);
  // The shown event's picks are its own (#713): open until that event starts, as the server
  // read it, and closed here too once the start passes with the page still open.
  const isEditable = selectionState.acceptsPicks
    && !(contest.drawnAt ?? selectionState.drawnAt)
    && !(shownEvent && hasContestEventStarted(shownEvent));
  // Before the contest locks, the server answers the viewer's own entry when another team's is
  // asked for, so a different selected entry means this one's picks are not ours to see yet.
  const picksHidden = selectionState.selectedEntryId !== entryId;
  const selectedEntry = selectionState.entries.find((entry) => entry.id === entryId) ?? null;
  // The room's copy is the fresher one: a pick change answers with it, and a change that leaves
  // a submitted lineup short sends the entry back to DRAFT there.
  const entryStatus = selectedEntry?.status ?? (entrySummary ? entryEventStatus(entrySummary, shownEventId) : ContestEntryStatus.DRAFT);
  const isSubmitted = entryStatus === ContestEntryStatus.SUBMITTED;
  const selectionGroups = picksHidden ? [] : selectionState.selectionGroups ?? [];
  const completionStats = getCompletionStats(selectionGroups);
  const nextIncompleteGroupId = getNextIncompleteGroupId(selectionGroups);
  const lineupComplete =
    completionStats.requiredSelections > 0
    && completionStats.totalSelections >= completionStats.requiredSelections;
  const savedTiebreaker = picksHidden ? null : selectionState.tiebreakerValue ?? null;
  const hasSavedTiebreaker = savedTiebreaker !== null;
  const selectedTiebreakerValue =
    tiebreakerDraft.trim().length > 0
      ? Number.parseInt(tiebreakerDraft.trim(), 10)
      : null;
  const hasSelectedTiebreaker =
    tiebreaker !== null
    && selectedTiebreakerValue !== null
    && Number.isFinite(selectedTiebreakerValue)
    && tiebreaker.options.includes(selectedTiebreakerValue);
  const isBudget = contest.selectionType === SelectionType.BUDGET_PICK;
  const lineupSummary = picksHidden ? null : selectionState.lineupSummary ?? null;
  const submitBlockedReason = picksHidden
    ? null
    : lineupRulesFor(contest.selectionType)?.submitBlockedReason(selectionState) ?? null;
  const finalSubmitDisabled =
    !isMyEntry
    || !isEditable
    || !lineupComplete
    || submitBlockedReason !== null
    || (tiebreaker !== null && detailsEditable && !hasSelectedTiebreaker)
    || saveEntryDetailsMutation.isPending
    || submitEntryMutation.isPending
    || pickChangeMutation.isPending;

  // Saves the tiebreaker, then submits. A failure at either step stays on the page: each
  // mutation's own error state shows the reason.
  async function submitEntry() {
    try {
      await saveEntryDetailsMutation.mutateAsync();
      await submitEntryMutation.mutateAsync(shownEventId);
    } catch {
      return;
    }
    void navigate(backToContestPath, {
      state: { leagueCode: backLeagueCode },
    });
  }

  return (
    <ContestPageFrame
      contest={contest}
      current={entryPageView(contest, entryId)}
      leagueCode={backLeagueCode}
      picksRevealed={entryQuery.data?.picksRevealed ?? false}
      actions={<ContestEntryBackLinks contestId={contestId} leagueCode={backLeagueCode} />}
      badges={(
        <>
          <StatusBadge tone={CONTEST_STATUS_TONES[contest.status]}>
            {getContestPhaseLabel(contest, isEditable)}
          </StatusBadge>
          {picksHidden ? null : (
            <StatusBadge data-testid="contest-entry-status-badge" tone={CONTEST_ENTRY_STATUS_TONES[entryStatus]}>
              {CONTEST_ENTRY_STATUS_LABELS[entryStatus]}
            </StatusBadge>
          )}
        </>
      )}
      summary={(
        <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-entry-summary">
          {contest.name}
          {entrySummary ? ` · ${entrySummary.squadName} · Entry ${entrySummary.entryNumber}` : ''}
        </p>
      )}
      title={selectedEntry?.name ?? entrySummary?.name ?? 'Contest entry'}
      titleTestId="contest-entry-heading"
    >

      <ContestEventSwitcher
        describe={(sportEvent) => (
          picksHidden
            ? null
            : CONTEST_ENTRY_STATUS_LABELS[
              sportEvent.sportEventId === shownEventId || !entrySummary
                ? entryStatus
                : entryEventStatus(entrySummary, sportEvent.sportEventId)
            ]
        )}
        events={contest.sportEvents}
        onChange={setRequestedEventId}
        testId="contest-entry-event-switcher"
        value={shownEventId}
      />

      {isRandomDraw ? <DrawEntryMetrics isEditable={isEditable} noun={participantNoun} selectionState={selectionState} /> : (
      <Tile>
        <MetricGrid className="md:grid-cols-4">
          {isBudget ? (
            <MetricTile
              helperText={picksHidden ? HIDDEN_PICKS_HELPER : lineupSummary ? `Of the ${formatDollars(lineupSummary.salaryCap)} salary cap` : 'Salary cap'}
              label="Spent"
              value={picksHidden ? 'Hidden' : lineupSummary ? formatDollars(lineupSummary.spent) : '—'}
            />
          ) : (
            <MetricTile
              helperText={picksHidden ? HIDDEN_PICKS_HELPER : 'Tiers complete'}
              label="Tier progress"
              value={picksHidden ? 'Hidden' : `${completionStats.completedTiers}/${selectionGroups.length || 0}`}
            />
          )}
          <MetricTile
            helperText={picksHidden ? HIDDEN_PICKS_HELPER : 'Lineup slots filled'}
            label="Picks saved"
            value={picksHidden ? 'Hidden' : `${completionStats.totalSelections}/${completionStats.requiredSelections}`}
          />
          {tiebreaker ? (
            <MetricTile
              helperText={(
                <span data-testid="contest-entry-tiebreaker-summary">
                  {picksHidden
                    ? HIDDEN_PICKS_HELPER
                    : savedTiebreaker !== null
                    ? tiebreaker.describe(savedTiebreaker)
                    : isEditable
                      ? 'Needed after lineup is complete'
                      : 'No tiebreaker was saved'}
                </span>
              )}
              label="Tiebreaker"
              value={(
                <span data-testid="contest-entry-tiebreaker-status">
                  {picksHidden ? 'Hidden' : hasSavedTiebreaker ? 'Saved' : isEditable ? 'Needed' : 'Closed'}
                </span>
              )}
            />
          ) : null}
          <MetricTile
            helperText={
              picksHidden
                ? HIDDEN_PICKS_HELPER
                : isEditable
                ? nextIncompleteGroupId
                  ? isBudget
                    ? formatStillToPick(completionStats.requiredSelections - completionStats.totalSelections, participantNoun)
                    : `Next focus: ${selectionGroups.find((group) => group.groupId === nextIncompleteGroupId)?.groupName ?? 'Open tier'}`
                  : 'Lineup is fully selected'
                : 'Entry editing is closed'
            }
            label="Entries close"
            value={isEditable ? 'When the event starts' : 'Closed'}
          />
        </MetricGrid>
      </Tile>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Tile>
            <Heading level={3} variant="card" size="xl" tone="inherit">
              {isEditable ? 'Entry details' : 'Entry summary'}
            </Heading>

            <DefinitionList
              className="mt-5"
              items={[
                { id: 'entry-status', label: 'Entry status', value: CONTEST_ENTRY_STATUS_LABELS[entryStatus] },
                { id: 'contest-phase', label: 'Contest phase', value: getContestPhaseLabel(contest, isEditable) },
                { id: 'created', label: 'Created', value: formatDateTimeDisplay(entrySummary?.createdAt, displayPreferences) },
                { id: 'last-updated', label: 'Last updated', value: formatDateTimeDisplay(entrySummary?.updatedAt, displayPreferences) },
              ]}
            />

            {isMyEntry ? (
              // A random-draw entry has no lineup to submit, so nothing here saves: the draw
              // sets its golfers and there is no tiebreaker to show.
              isRandomDraw ? null : detailsEditable ? (
                <Tile className="mt-5 space-y-4" padding="sm" radius="lg" variant="subtle">
                  <FormField label="Entry name">
                    <Input
                      data-testid="contest-entry-name-input"
                      disabled={saveEntryDetailsMutation.isPending}
                      maxLength={100}
                      onChange={(event) => setEntryNameDraft(event.target.value)}
                      value={entryNameDraft}
                    />
                  </FormField>
                  {saveEntryDetailsMutation.isError ? (
                    <Alert tone="danger">
                      {extractErrorMessage(saveEntryDetailsMutation.error, {
                        codeMessages: CONTEST_ENTRY_CODE_MESSAGES,
                        fallback: 'We could not save this entry right now.',
                      })}
                    </Alert>
                  ) : null}
                </Tile>
              ) : tiebreaker ? (
                <Alert className="mt-5" title="Saved tiebreaker">
                  <div
                    data-testid="contest-entry-readonly-tiebreaker"
                  >
                    {selectionState.tiebreakerValue === null || selectionState.tiebreakerValue === undefined
                      ? 'No tiebreaker prediction was saved.'
                      : tiebreaker.describe(selectionState.tiebreakerValue)}
                  </div>
                </Alert>
              ) : null
            ) : (
              <Alert className="mt-5">
                {entrySummary ? `This entry belongs to ${entrySummary.squadName}.` : 'This entry belongs to someone else.'}
              </Alert>
            )}
          </Tile>

        </div>

        <Tile>
          <Heading level={3} variant="card" size="xl" tone="inherit" data-testid="contest-entry-builder-heading">
            {isRandomDraw
              ? `${selectionState.drawnAt ? 'Dealt ' : ''}${selectionState.drawnAt ? participantNoun.many : participantNoun.many.charAt(0).toUpperCase() + participantNoun.many.slice(1)}`
              : isEditable ? 'Build your lineup' : 'Saved lineup detail'}
          </Heading>
          {isRandomDraw ? (
            <div className="mt-5">
              <DrawLineup noun={participantNoun} selectionState={selectionState} />
            </div>
          ) : (
          <div className="mt-5 space-y-5">
            {picksHidden ? (
              <Alert data-testid="contest-entry-picks-hidden">
                This entry&apos;s picks stay hidden until the event starts.
              </Alert>
            ) : null}
            {isBudget ? selectionGroups.map((group) => (isEditable ? (
              <BudgetLineupBuilder
                canSelect={isMyEntry}
                sport={contest.sport ?? null}
                group={group}
                isBusy={pickChangeMutation.isPending}
                key={group.groupId}
                noun={participantNoun}
                onParticipantSelect={(participant) => {
                  // A refused pick is shown by the mutation's error state and rolled back there.
                  void pickChangeMutation.mutateAsync({
                    participantId: participant.sportEventParticipantId,
                    isSelected: group.selectedParticipantIds.includes(participant.sportEventParticipantId),
                  }).catch(() => undefined);
                }}
                summary={lineupSummary}
              />
            ) : (
              <LockedBudgetLineup group={group} key={group.groupId} noun={participantNoun} summary={lineupSummary} />
            ))) : selectionGroups.map((group) => {
              if (!isEditable) {
                return <LockedSelectionGroup group={group} key={group.groupId} noun={participantNoun} sport={contest.sport ?? null} />;
              }

              const isExpanded = expandedGroupId === group.groupId;

              return (
                <EditableSelectionGroup
                  canSelect={isMyEntry}
                  sport={contest.sport ?? null}
                  group={group}
                  isBusy={pickChangeMutation.isPending}
                  isExpanded={isExpanded}
                  key={group.groupId}
                  noun={participantNoun}
                  onParticipantSelect={(nextParticipant) => {
                    const participantId = nextParticipant.sportEventParticipantId;
                    // The tier closes, and the next short one opens, as soon as the tap fills it:
                    // the lineup after the tap decides, not the server's answer.
                    const nextSelectedIds = getNextSelectedParticipantIds(
                      group,
                      participantId,
                      buildPickedAtById(selectionState, entryId),
                    );
                    if (nextSelectedIds.length >= group.picksFromGroup) {
                      const currentIndex = selectionGroups.findIndex((candidate) => candidate.groupId === group.groupId);
                      const nextGroup = selectionGroups
                        .slice(currentIndex + 1)
                        .find((candidate) => candidate.selectedParticipantIds.length < candidate.picksFromGroup);
                      setExpandedGroupId(nextGroup?.groupId ?? null);
                    }
                    void pickChangeMutation
                      .mutateAsync({ participantId, isSelected: group.selectedParticipantIds.includes(participantId) })
                      // A refused pick is shown by the mutation's error state and rolled back in
                      // onError; the refused tier is opened again so the fix is in view.
                      .catch(() => setExpandedGroupId(group.groupId));
                  }}
                  onToggle={() => setExpandedGroupId(isExpanded ? null : group.groupId)}
                  setToggleRef={(element) => {
                    groupToggleRefs.current[group.groupId] = element;
                  }}
                />
              );
            })}

            {isMyEntry && isEditable && !isSubmitted ? (
              <Alert data-testid="contest-entry-not-submitted" title="Not submitted" tone="warning">
                {lineupComplete
                  ? tiebreaker
                    ? 'Your lineup is complete. Choose a tiebreaker and submit it: an entry only counts once it is submitted.'
                    : 'Your lineup is complete. Submit it: an entry only counts once it is submitted.'
                  : 'This entry only counts once its lineup is complete and submitted. A change that leaves a submitted lineup short needs submitting again.'}
              </Alert>
            ) : null}

            {pickChangeMutation.isError ? (
              <Alert tone="danger">
                {extractErrorMessage(pickChangeMutation.error, {
                  codeMessages: CONTEST_ENTRY_CODE_MESSAGES,
                  fallback: 'We could not save this entry right now.',
                })}
              </Alert>
            ) : null}

            {submitEntryMutation.isError ? (
              <Alert data-testid="contest-entry-submit-error" tone="danger">
                {extractErrorMessage(submitEntryMutation.error, {
                  codeMessages: CONTEST_ENTRY_CODE_MESSAGES,
                  fallback: 'We could not submit this entry right now.',
                })}
              </Alert>
            ) : null}

            {isEditable && isMyEntry && lineupComplete && submitBlockedReason ? (
              <Alert data-testid="contest-entry-submit-blocked" tone="danger">
                {submitBlockedReason}
              </Alert>
            ) : null}

            {isEditable && isMyEntry && lineupComplete ? (
              <TiebreakerSelector
                disabled={!detailsEditable || saveEntryDetailsMutation.isPending || submitEntryMutation.isPending}
                isSubmitted={isSubmitted}
                isSubmitting={saveEntryDetailsMutation.isPending || submitEntryMutation.isPending}
                onChange={setTiebreakerDraft}
                onSubmit={() => void submitEntry()}
                submitDisabled={finalSubmitDisabled}
                tiebreaker={tiebreaker}
                value={hasSelectedTiebreaker ? String(selectedTiebreakerValue) : ''}
              />
            ) : null}
          </div>
          )}
        </Tile>
      </div>
    </ContestPageFrame>
  );
}

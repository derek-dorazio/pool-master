import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getSelectionState, selectContestPick, submitContestEntry, unselectContestPick, updateContestEntry, type SelectionStateResponse } from '@/lib/api';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { ContestEntryStatus, SelectionType } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { getLogger } from '@/lib/logger';
import { ErrorState, formatDateTimeDisplay, LoadingState, Notice, refetchFailed, StatStrip, Text, useDisplayPreferences } from '@/features/shared/ui';
import { buildHowToPlayFormatPath } from '@/features/event-pages/event-page-paths';
import {
  buildPickedAtById,
  lineupRulesFor,
  mergePickChange,
} from './contest-entry-lineup';
import {
  getCompletionStats,
  drawProgressItems,
  getContestPhaseLabel,
  getNextIncompleteGroupId,
  rosterProgressItems,
} from './contest-entry-helpers';
import { TiebreakerField } from './contest-entry-selection';
import { areContestEntriesOpen } from './contest-status';
import { ContestEntryFrame } from './contest-header';
import { useContestLeagueCode } from './use-contest-league';
import { contestEntryTiebreaker, contestEventStart, contestRosterParticipantNoun } from './contest-sport';
import { entryWriteKeys, useContestEntryQuery } from './use-contest-entries';
import { contestSchedule } from './use-contest-schedule';
import { ContestEventSwitcher } from './contest-event-switcher';
import { entryEventStatus, hasContestEventStarted } from './contest-events';
import { RosterContestEntryLineupSection, type PickChange } from './roster-contest-entry-lineup-section';
import { EntryFinishCard } from './entry-finish-card';
import { entryFinishStatus, entryStatusLine } from './entry-status-line';
import { useContestQuery } from './use-contest-query';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { refreshAfterWrite, useInvalidatingMutation } from '@/lib/mutation-hooks';

type SelectionState = SelectionStateResponse;

/** A roster contest's entry: its lineup, picked in the selection room for each of its events. */
export function RosterContestEntryPage() {
  const logger = getLogger().child({
    feature: 'contest-entry-page',
  });
  const { contestId = '', entryId = '' } = useParams<{ contestId: string; entryId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const displayPreferences = useDisplayPreferences();
  // Null opens the room on the contest's current event; the server says which one that is.
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  const selectionStateQueryKey = QueryKeys.selectionStates.detail(contestId, entryId, requestedEventId ?? undefined);
  const groupToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Null until the viewer types: the fields show the entry's saved name and tiebreaker until then.
  const [editedEntryName, setEntryNameDraft] = useState<string | null>(null);
  const [editedTiebreaker, setTiebreakerDraft] = useState<string | null>(null);
  // Undefined until the viewer opens or closes a group, and again once a filled group hands on:
  // the next group still short of picks opens then. Null keeps every group closed.
  const [chosenGroupId, setExpandedGroupId] = useState<string | null | undefined>(undefined);

  const contestQuery = useContestQuery(contestId);

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

  // The league is the URL's: every contest page lives under its league (#1393).
  const leagueCode = useContestLeagueCode();
  // The event's start is the entry cutoff (#431); the contest's status follows the event's own
  // move to in progress, which can lag the start, and the server refuses picks from the start on.
  const schedule = contestSchedule(contestQuery.data);
  const savedDetails = selectionStateQuery.data;
  const selectableGroups = useMemo(
    () => selectionStateQuery.data?.selectionGroups ?? [],
    [selectionStateQuery.data?.selectionGroups],
  );

  const entryNameDraft = editedEntryName ?? savedDetails?.selectedEntryName ?? '';
  const tiebreakerDraft = editedTiebreaker
    ?? (savedDetails?.tiebreakerValue === null || savedDetails?.tiebreakerValue === undefined
      ? ''
      : String(savedDetails.tiebreakerValue));
  // A group the viewer chose stays open while it is on the page; otherwise the next short one is.
  const expandedGroupId = chosenGroupId !== undefined
    && (chosenGroupId === null || selectableGroups.some((group) => group.groupId === chosenGroupId))
    ? chosenGroupId
    : getNextIncompleteGroupId(selectableGroups);

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
      void refreshAfterWrite(
        queryClient,
        [...entryWriteKeys(contestId), QueryKeys.contestEntries.detail(contestId, entryId)],
        { refetchType: 'none' },
      );
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
        body="We couldn't load this contest entry."
        onRetry={refetchFailed(contestQuery, selectionStateQuery, entryQuery)}
      />
    );
  }

  const contest = contestQuery.data;
  const selectionState = selectionStateQuery.data;
  const participantNoun = contestRosterParticipantNoun(contest);
  // The prediction the contest's scoring family asks for: a golf entry's winning score, none
  // for a race, whose entries submit without one.
  const tiebreaker = contestEntryTiebreaker(contest);
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
  const lineupComplete =
    completionStats.requiredSelections > 0
    && completionStats.totalSelections >= completionStats.requiredSelections;
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
    void navigate(buildLeagueContestPath(leagueCode, contestId));
  }

  const isDraftChanged = editedEntryName !== null || editedTiebreaker !== null;
  // Saves the name and tiebreaker alone, once the entry is submitted and they change.
  async function saveEntryDetails() {
    try {
      await saveEntryDetailsMutation.mutateAsync();
    } catch {
      // The mutation's own error shows on the card.
    }
  }

  // When picks close, in the words the status line and the card use.
  const closes = schedule?.startsAt ? formatDateTimeDisplay(schedule.startsAt, displayPreferences) : `the ${contestEventStart(contest.sport)}`;
  const drawnAt = contest.drawnAt ?? selectionState.drawnAt ?? null;
  const drawnAtText = drawnAt ? formatDateTimeDisplay(drawnAt, displayPreferences) : null;
  const statusLine = isRandomDraw
    ? drawnAtText ? `Drawn ${drawnAtText}` : 'Waiting for the draw'
    : entryStatusLine({ closes, isOpen: isMyEntry && isEditable, status: picksHidden ? null : entryStatus });
  // What still blocks Submit, in the order the entry would fix it.
  const submitHint = !lineupComplete
    ? 'Pick a full lineup to submit.'
    : submitBlockedReason ?? (tiebreaker !== null && detailsEditable && !hasSelectedTiebreaker ? 'Choose your tiebreaker to submit.' : null);
  // Picks come first, then the entry's name, its tiebreaker and the one Submit for all of it.
  const showFinish = isMyEntry && (isRandomDraw ? detailsEditable : detailsEditable || isEditable || tiebreaker !== null);

  const errorText = (error: Error | null, fallback: string) => (error
    ? extractErrorMessage(error, { fallback })
    : null);
  const finishError = (submitEntryMutation.isError ? errorText(submitEntryMutation.error, 'We could not submit this entry right now.') : null)
    ?? (saveEntryDetailsMutation.isError ? errorText(saveEntryDetailsMutation.error, 'We could not save this entry right now.') : null);
  const isFinishing = saveEntryDetailsMutation.isPending || submitEntryMutation.isPending;
  const finishAction = isRandomDraw
    ? editedEntryName !== null && entryNameDraft.trim() !== (selectionState.selectedEntryName ?? '') ? {
      disabled: !entryNameDraft.trim() || isFinishing,
      isBusy: isFinishing,
      label: 'Save',
      onClick: () => void saveEntryDetails(),
      testId: 'contest-entry-save',
    } : null
    : isEditable && !isSubmitted ? {
      disabled: finalSubmitDisabled,
      isBusy: isFinishing,
      label: 'Submit',
      onClick: () => void submitEntry(),
      testId: 'contest-entry-submit',
    } : detailsEditable && isDraftChanged ? {
      disabled: !entryNameDraft.trim() || isFinishing,
      isBusy: isFinishing,
      label: 'Save',
      onClick: () => void saveEntryDetails(),
      testId: 'contest-entry-save',
    } : null;

  return (
    <ContestEntryFrame
      contest={contest}
      entry={entrySummary}
      leagueCode={leagueCode}
      phaseLabel={getContestPhaseLabel(contest, isEditable)}
      status={picksHidden ? null : entryStatus}
      statusFacts={[{ id: 'entries-close', label: 'Entries', value: isEditable ? 'Close when the event starts' : 'Closed' }]}
      statusLine={statusLine}
      title={selectedEntry?.name ?? entrySummary?.name ?? 'Contest entry'}
    >

      <ContestEventSwitcher
        describe={(sportEvent) => (
          picksHidden
            ? null
            : enumLabel('ContestEntryStatus', 
              sportEvent.sportEventId === shownEventId || !entrySummary
                ? entryStatus
                : entryEventStatus(entrySummary, sportEvent.sportEventId)
            )
        )}
        events={contest.sportEvents}
        onChange={setRequestedEventId}
        testId="contest-entry-event-switcher"
        value={shownEventId}
      />

      {picksHidden ? null : (
        <StatStrip
          items={isRandomDraw
            ? drawProgressItems({ drawnAt: drawnAtText, noun: participantNoun, rosterSize: selectionState.rosterSize })
            : rosterProgressItems({ isBudget, isEditable, lineupSummary, selectionGroups })}
          testId="contest-entry-progress"
        />
      )}

      <RosterContestEntryLineupSection
        drawState={isRandomDraw ? selectionState : null}
        expandedGroupId={expandedGroupId}
        groupToggleRefs={groupToggleRefs}
        howToPlay={isEditable && isMyEntry && !isRandomDraw ? {
          help: isBudget
            ? `Tap ${participantNoun.many} to add them to your lineup, keeping the total under the salary cap. Picks save as you tap and lock when the event starts.`
            : `Open each tier and tap the ${participantNoun.many} you want, up to the tier's picks. Picks save as you tap and lock when the event starts.`,
          link: { label: 'How to play', to: buildHowToPlayFormatPath(contest.sport ?? null, contest.selectionType) },
        } : null}
        isBudget={isBudget}
        isBusy={pickChangeMutation.isPending}
        isEditable={isEditable}
        isMyEntry={isMyEntry}
        lineupSummary={lineupSummary}
        noun={participantNoun}
        onExpandGroup={setExpandedGroupId}
        onPick={(change) => pickChangeMutation.mutateAsync(change)}
        pickError={pickChangeMutation.isError ? errorText(pickChangeMutation.error, 'We could not save this entry right now.') : null}
        pickedAtById={buildPickedAtById(selectionState, entryId)}
        picksHidden={picksHidden}
        selectionGroups={selectionGroups}
        sport={contest.sport ?? null}
      />

      {isMyEntry ? null : (
        <Notice>
          {entrySummary ? `This entry belongs to ${entrySummary.squadName}.` : 'This entry belongs to someone else.'}
        </Notice>
      )}

      {showFinish ? (
        <EntryFinishCard
          action={finishAction}
          error={finishError}
          errorTestId="contest-entry-submit-error"
          name={detailsEditable ? { disabled: isFinishing, onChange: setEntryNameDraft, testId: 'contest-entry-name-input', value: entryNameDraft } : null}
          status={isRandomDraw
            ? 'Nothing to submit: the draw picks for you'
            : isEditable ? entryFinishStatus({ closes, hint: submitHint, isSubmitted }) : enumLabel('ContestEntryStatus', entryStatus)}
          statusTestId="contest-entry-finish-status"
          testId="contest-entry-finish"
          title={isRandomDraw ? 'Entry name' : 'Name and submit'}
        >
          {tiebreaker && !isRandomDraw && detailsEditable ? (
            <TiebreakerField
              disabled={isFinishing}
              onChange={setTiebreakerDraft}
              tiebreaker={tiebreaker}
              value={hasSelectedTiebreaker ? String(selectedTiebreakerValue) : ''}
            />
          ) : null}
          {tiebreaker && !isRandomDraw && !detailsEditable ? (
            <Text as="p" data-testid="contest-entry-readonly-tiebreaker" variant="meta">
              {selectionState.tiebreakerValue === null || selectionState.tiebreakerValue === undefined
                ? 'No tiebreaker was saved.'
                : `Tiebreaker: ${tiebreaker.describe(selectionState.tiebreakerValue)}`}
            </Text>
          ) : null}
        </EntryFinishCard>
      ) : null}
    </ContestEntryFrame>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { getContest, getDraftState, listContestEntries, submitContestEntry, submitContestSelection, updateContestEntry, type GetDraftStateResponses, type ContestDto, type ContestEntryListResponse } from '@/lib/api';
import {
  buildLeagueContestPath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { ContestEntryStatus, ContestStatus, PARTICIPANT_SCORING_DEFINITIONS, SelectionType } from '@poolmaster/shared/domain';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import {
  Alert,
  DefinitionList,
  ErrorState,
  formatDateTimeDisplay,
  FormField,
  Input,
  LinkButton,
  LoadingState,
  MetricGrid,
  MetricTile,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import {
  EditableSelectionGroup,
  LockedSelectionGroup,
  TiebreakerSelector,
  type SelectionGroup,
} from './contest-entry-selection';
import {
  areContestEntriesOpen,
  CONTEST_ENTRY_STATUS_LABELS,
  CONTEST_ENTRY_STATUS_TONES,
  CONTEST_STATUS_TONES,
  contestStatusLabel,
} from './contest-status';
import { useContestSchedule } from './use-contest-schedule';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

type DraftState = GetDraftStateResponses[200];

const TIEBREAKER_OPTIONS = Array.from({ length: 41 }, (_, index) => 10 - index);

// The tiebreaker is a predicted winning score relative to par.
const formatTiebreaker = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format;
const HIDDEN_PICKS_HELPER = 'Hidden until the contest locks';

// The entry page says what an open contest means for this entry; every other status reads as it
// does on every contest page.
function getContestPhaseLabel(contest: ContestDto, entriesOpen: boolean) {
  if (entriesOpen) {
    return 'Editable until the event starts';
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
 * When each of the entry's golfers was picked, by sport-event participant id. A full tier's swap
 * displaces the tier's most recently picked golfer on the server, and the tier's list is in tier
 * order, not pick order, so the optimistic swap needs this to drop the same one.
 */
function buildPickedAtById(draftState: DraftState, entryId: string): Map<string, string> {
  return new Map(
    (draftState.draftPickHistories ?? [])
      .flatMap((pick) => (pick.entryId === entryId && pick.participantId
        ? [[pick.participantId, pick.pickedAt] as const]
        : [])),
  );
}

function getNextSelectedParticipantIds(
  group: SelectionGroup,
  participantId: string,
  pickedAtById: ReadonlyMap<string, string>,
) {
  if (group.selectedParticipantIds.includes(participantId)) {
    return group.selectedParticipantIds.filter((selectedParticipantId) => selectedParticipantId !== participantId);
  }

  if (group.selectedParticipantIds.length >= group.picksFromGroup) {
    // A golfer with no pick time is treated as the oldest, so it is never the one displaced.
    const newest = group.selectedParticipantIds.reduce((latest, candidate) =>
      (pickedAtById.get(candidate) ?? '') >= (pickedAtById.get(latest) ?? '') ? candidate : latest);
    return [...group.selectedParticipantIds.filter((selectedParticipantId) => selectedParticipantId !== newest), participantId];
  }

  return Array.from(new Set([...group.selectedParticipantIds, participantId]));
}

function applyOptimisticSelection(draftState: DraftState, participantId: string, entryId: string): DraftState {
  const selectionGroups = draftState.selectionGroups ?? [];
  const pickedAtById = buildPickedAtById(draftState, entryId);
  const nextSelectionGroups = selectionGroups.map((group) => {
    if (!group.participants.some((participant) => participant.sportEventParticipantId === participantId)) {
      return group;
    }

    const selectedParticipantIds = getNextSelectedParticipantIds(group, participantId, pickedAtById);
    const selectedIdSet = new Set(selectedParticipantIds);

    return {
      ...group,
      selectedParticipantIds,
      participants: group.participants.map((participant) => ({
        ...participant,
        isSelected: selectedIdSet.has(participant.sportEventParticipantId),
      })),
    };
  });
  const totalSelections = nextSelectionGroups.reduce(
    (sum, group) => sum + group.selectedParticipantIds.length,
    0,
  );
  const requiredSelections = nextSelectionGroups.reduce(
    (sum, group) => sum + group.picksFromGroup,
    0,
  );

  return {
    ...draftState,
    selectionGroups: nextSelectionGroups,
    isComplete: requiredSelections > 0 && totalSelections >= requiredSelections,
  };
}

export function ContestEntryPage() {
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
  const draftStateQueryKey = QueryKeys.draftStates.detail(contestId, entryId);
  const groupToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [entryNameDraft, setEntryNameDraft] = useState('');
  const [tiebreakerDraft, setTiebreakerDraft] = useState('');
  const [draftDetailsSeedKey, setDraftDetailsSeedKey] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const contestQuery = useQuery({
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
  });

  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: async (): Promise<ContestEntryListResponse> => {
      const response = await listContestEntries({ path: { contestId } });
      if (!response.data) {
        throwApiError(response.error, 'Contest entries response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const draftStateQuery = useQuery({
    queryKey: draftStateQueryKey,
    queryFn: async (): Promise<DraftState> => {
      const response = await getDraftState({
        path: { contestId },
        query: { entryId },
      });
      if (!response.data) {
        throwApiError(response.error, 'Draft state response is missing data.');
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
  const { league: contestLeague } = useLeagueContextById(contestQuery.data?.leagueId);
  // The event's start is the entry cutoff (#431); the contest's status follows the event's own
  // move to in progress, which can lag the start, and the server refuses picks from the start on.
  const schedule = useContestSchedule(contestQuery.data);
  const detailsSeedSource = useMemo(() => {
    if (!draftStateQuery.data) {
      return null;
    }

    return {
      name: draftStateQuery.data.selectedEntryName ?? '',
      tiebreakerValue: draftStateQuery.data.tiebreakerValue,
    };
    // Keyed on selectedEntryName and tiebreakerValue on purpose: a refetch must not rebuild the draft
    // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftStateQuery.data?.selectedEntryName, draftStateQuery.data?.tiebreakerValue]);
  const selectableGroups = useMemo(
    () => draftStateQuery.data?.selectionGroups ?? [],
    [draftStateQuery.data?.selectionGroups],
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
      groupToggle.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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
      && !draftStateQuery.isError
      && !contestEntriesQuery.isError
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
        err: contestQuery.error ?? draftStateQuery.error ?? contestEntriesQuery.error,
      },
      'Contest entry page failed to load required data',
    );
  }, [
    contestEntriesQuery.error,
    contestEntriesQuery.isError,
    contestId,
    contestQuery.error,
    contestQuery.isError,
    draftStateQuery.error,
    draftStateQuery.isError,
    entryId,
    logger,
  ]);

  useEffect(() => {
    if (!contestQuery.data || !draftStateQuery.data || !contestEntriesQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestEntry.page.loaded',
        data: {
          contestId,
          entryId,
          status: contestQuery.data.status,
          selectionGroupCount: draftStateQuery.data.selectionGroups?.length ?? 0,
        },
      },
      'Contest entry page loaded',
    );
  }, [contestEntriesQuery.data, contestId, contestQuery.data, draftStateQuery.data, entryId, logger]);

  const saveEntryDetailsMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const trimmedName = entryNameDraft.trim();
      const normalizedTiebreaker = tiebreakerDraft.trim();
      const body: { name?: string; tiebreakerValue?: number } = {};

      if (
        trimmedName
        && trimmedName !== (draftStateQuery.data?.selectedEntryName ?? '')
      ) {
        body.name = trimmedName;
      }

      const currentTiebreakerValue = draftStateQuery.data?.tiebreakerValue ?? null;
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
      QueryKeys.contests.detail(contestId),
      QueryKeys.contestEntries.byContest(contestId),
      draftStateQueryKey,
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

  const submitSelectionMutation = useInvalidatingMutation({
    mutationFn: async (participantId: string) => {
      const response = await submitContestSelection({
        path: { contestId },
        body: {
          entryId,
          participantId,
        },
      });

      if (!response.data) {
        throwApiError(response.error, 'Contest selection response is missing data.');
      }

      return response.data;
    },
    onMutate: async (participantId) => {
      logger.debug(
        {
          action: 'contestEntry.selection.started',
          data: {
            contestId,
            entryId,
            participantId,
          },
        },
        'Starting contest selection submission',
      );
      await queryClient.cancelQueries({ queryKey: draftStateQueryKey });
      const previousDraftState = queryClient.getQueryData<DraftState>(draftStateQueryKey);

      if (previousDraftState) {
        queryClient.setQueryData<DraftState>(
          draftStateQueryKey,
          applyOptimisticSelection(previousDraftState, participantId, entryId),
        );
      }

      return { previousDraftState };
    },
    onSuccess: (draftState) => {
      logger.info(
        {
          action: 'contestEntry.selection.succeeded',
          data: {
            contestId,
            entryId,
          },
        },
        'Submitted contest selection successfully',
      );
      queryClient.setQueryData<DraftState>(draftStateQueryKey, draftState);
    },
    invalidates: [
      QueryKeys.contests.detail(contestId),
      QueryKeys.contestEntries.byContest(contestId),
    ],
    onError: (error, participantId, context) => {
      if (context?.previousDraftState) {
        queryClient.setQueryData<DraftState>(draftStateQueryKey, context.previousDraftState);
      }
      const payload = {
        action: 'contestEntry.selection.failed',
        data: {
          contestId,
          entryId,
          participantId,
        },
        err: error,
      };

      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest selection was rejected');
      } else {
        logger.error(payload, 'Contest selection failed unexpectedly');
      }
    },
  });

  // Submitting is what makes the entry count (#481); the server refuses an incomplete lineup.
  const submitEntryMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await submitContestEntry({ path: { contestId, entryId } });
      if (!response.data) {
        throwApiError(response.error, 'Contest entry submit response is missing data.');
      }
      return response.data;
    },
    onSuccess: (draftState) => {
      logger.info(
        {
          action: 'contestEntry.submit.succeeded',
          data: { contestId, entryId },
        },
        'Submitted contest entry',
      );
      queryClient.setQueryData<DraftState>(draftStateQueryKey, draftState);
    },
    invalidates: [
      QueryKeys.contests.detail(contestId),
      QueryKeys.contestEntries.byContest(contestId),
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

  if (contestQuery.isLoading || draftStateQuery.isLoading || contestEntriesQuery.isLoading) {
    return <LoadingState body="Loading contest entry..." />;
  }

  if (
    contestQuery.isError
    || !contestQuery.data
    || draftStateQuery.isError
    || !draftStateQuery.data
    || contestEntriesQuery.isError
  ) {
    return (
      <ErrorState
        body="Try refreshing or return to the contest board."
        title="We couldn't load this contest entry."
      />
    );
  }

  const contest = contestQuery.data;
  const draftState = draftStateQuery.data;
  const backLeagueCode = hintedLeagueCode ?? contestLeague?.leagueCode ?? null;
  const backToContestPath = backLeagueCode
    ? buildLeagueContestPath(backLeagueCode, contestId)
    : `/contests/${contestId}`;
  const backToLeaguePath = backLeagueCode ? buildLeaguePath(backLeagueCode) : '/welcome';
  const entrySummary = contestEntriesQuery.data?.entries.find((entry) => entry.id === entryId) ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const isMyEntry = myEntryIds.includes(entryId);
  const isEditable = areContestEntriesOpen(contest.status, schedule?.startsAt);
  // Before the contest locks, the server answers the viewer's own entry when another team's is
  // asked for, so a different selected entry means this one's picks are not ours to see yet.
  const picksHidden = draftState.selectedEntryId !== entryId;
  const selectedEntry = draftState.entries.find((entry) => entry.id === entryId) ?? null;
  // The room's copy is the fresher one: a pick change answers with it, and a change that leaves
  // a submitted lineup short sends the entry back to DRAFT there.
  const entryStatus = selectedEntry?.status ?? entrySummary?.status ?? ContestEntryStatus.DRAFT;
  const isSubmitted = entryStatus === ContestEntryStatus.SUBMITTED;
  const selectionGroups = picksHidden ? [] : draftState.selectionGroups ?? [];
  const completionStats = getCompletionStats(selectionGroups);
  const nextIncompleteGroupId = getNextIncompleteGroupId(selectionGroups);
  const lineupComplete =
    completionStats.requiredSelections > 0
    && completionStats.totalSelections >= completionStats.requiredSelections;
  const savedTiebreaker = picksHidden ? null : draftState.tiebreakerValue ?? null;
  const hasSavedTiebreaker = savedTiebreaker !== null;
  const selectedTiebreakerValue =
    tiebreakerDraft.trim().length > 0
      ? Number.parseInt(tiebreakerDraft.trim(), 10)
      : null;
  const hasSelectedTiebreaker =
    selectedTiebreakerValue !== null
    && Number.isFinite(selectedTiebreakerValue)
    && TIEBREAKER_OPTIONS.includes(selectedTiebreakerValue);
  const finalSubmitDisabled =
    !isMyEntry
    || !isEditable
    || !lineupComplete
    || !hasSelectedTiebreaker
    || saveEntryDetailsMutation.isPending
    || submitEntryMutation.isPending
    || submitSelectionMutation.isPending;

  // Saves the tiebreaker, then submits. A failure at either step stays on the page: each
  // mutation's own error state shows the reason.
  async function submitEntry() {
    try {
      await saveEntryDetailsMutation.mutateAsync();
      await submitEntryMutation.mutateAsync();
    } catch {
      return;
    }
    navigate(backToContestPath, {
      state: { leagueCode: backLeagueCode },
    });
  }

  if (contest.selectionType !== SelectionType.TIERED) {
    return (
      <ErrorState
        action={(
          <LinkButton to={backToContestPath} variant="secondary">
            Back to contest
          </LinkButton>
        )}
        body="The first-pass entry builder currently supports tiered contest selections only."
        title="This entry flow is not ready yet."
      />
    );
  }

  return (
    <section className="space-y-6">
      <Tile padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={CONTEST_STATUS_TONES[contest.status]}>
                {getContestPhaseLabel(contest, isEditable)}
              </StatusBadge>
              {picksHidden ? null : (
                <StatusBadge data-testid="contest-entry-status-badge" tone={CONTEST_ENTRY_STATUS_TONES[entryStatus]}>
                  {CONTEST_ENTRY_STATUS_LABELS[entryStatus]}
                </StatusBadge>
              )}
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight" data-testid="contest-entry-heading">
                {selectedEntry?.name ?? entrySummary?.name ?? 'Contest entry'}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground" data-testid="contest-entry-summary">
                {contest.name}
                {entrySummary ? ` · ${entrySummary.squadName} · Entry ${entrySummary.entryNumber}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <LinkButton
              data-testid="contest-entry-back-to-contest"
              state={{ leagueCode: backLeagueCode }}
              to={backToContestPath}
              variant="secondary"
            >
              Back to contest
            </LinkButton>
            <LinkButton
              data-testid="contest-entry-back-to-league"
              to={backToLeaguePath}
              variant="secondary"
            >
              Back to league
            </LinkButton>
          </div>
        </div>

        <MetricGrid className="mt-6 md:grid-cols-4">
          <MetricTile
            helperText={picksHidden ? HIDDEN_PICKS_HELPER : 'Tiers complete'}
            label="Tier progress"
            value={picksHidden ? 'Hidden' : `${completionStats.completedTiers}/${selectionGroups.length || 0}`}
          />
          <MetricTile
            helperText={picksHidden ? HIDDEN_PICKS_HELPER : 'Lineup slots filled'}
            label="Picks saved"
            value={picksHidden ? 'Hidden' : `${completionStats.totalSelections}/${completionStats.requiredSelections}`}
          />
          <MetricTile
            helperText={(
              <span data-testid="contest-entry-tiebreaker-summary">
                {picksHidden
                  ? HIDDEN_PICKS_HELPER
                  : savedTiebreaker !== null
                  ? `Relative to par ${formatTiebreaker(savedTiebreaker)}`
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
          <MetricTile
            helperText={
              picksHidden
                ? HIDDEN_PICKS_HELPER
                : isEditable
                ? nextIncompleteGroupId
                  ? `Next focus: ${selectionGroups.find((group) => group.groupId === nextIncompleteGroupId)?.groupName ?? 'Open tier'}`
                  : 'Lineup is fully selected'
                : 'Entry editing is closed'
            }
            label="Entries close"
            value={isEditable ? 'When the event starts' : 'Closed'}
          />
        </MetricGrid>
      </Tile>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Tile>
            <h3 className="text-xl font-semibold">
              {isEditable ? 'Entry details' : 'Entry summary'}
            </h3>

            <DefinitionList
              className="mt-5"
              items={[
                { id: 'entry-status', label: 'Entry status', value: CONTEST_ENTRY_STATUS_LABELS[entryStatus] },
                { id: 'contest-phase', label: 'Contest phase', value: getContestPhaseLabel(contest, isEditable) },
                { id: 'created', label: 'Created', value: formatDateTimeDisplay(entrySummary?.createdAt) },
                { id: 'last-updated', label: 'Last updated', value: formatDateTimeDisplay(entrySummary?.updatedAt) },
              ]}
            />

            {isMyEntry ? (
              isEditable ? (
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
                      {extractErrorMessage(saveEntryDetailsMutation.error, { fallback: 'We could not save this entry right now.' })}
                    </Alert>
                  ) : null}
                </Tile>
              ) : (
                <Alert className="mt-5" title="Saved tiebreaker">
                  <div
                    data-testid="contest-entry-readonly-tiebreaker"
                  >
                    {draftState.tiebreakerValue === null || draftState.tiebreakerValue === undefined
                      ? 'No tiebreaker prediction was saved.'
                      : `Winning score relative to par: ${formatTiebreaker(draftState.tiebreakerValue)}`}
                  </div>
                </Alert>
              )
            ) : (
              <Alert className="mt-5">
                This entry is not part of your current team context.
              </Alert>
            )}
          </Tile>

        </div>

        <Tile>
          <h3 className="text-xl font-semibold" data-testid="contest-entry-builder-heading">
            {isEditable ? 'Build your lineup' : 'Saved lineup detail'}
          </h3>
          <div className="mt-5 space-y-5">
            {picksHidden ? (
              <Alert data-testid="contest-entry-picks-hidden">
                This team&apos;s picks stay hidden until the contest locks.
              </Alert>
            ) : null}
            {selectionGroups.map((group) => {
              if (!isEditable) {
                return <LockedSelectionGroup group={group} key={group.groupId} />;
              }

              const isExpanded = expandedGroupId === group.groupId;

              return (
                <EditableSelectionGroup
                  canSelect={isEditable && isMyEntry}
                  group={group}
                  isBusy={submitSelectionMutation.isPending}
                  isExpanded={isExpanded}
                  key={group.groupId}
                  onParticipantSelect={(nextParticipant) => {
                    void submitSelectionMutation
                      .mutateAsync(nextParticipant.sportEventParticipantId)
                      .then(() => {
                        setExpandedGroupId((current) => {
                          if (current !== group.groupId) {
                            return current;
                          }

                          const currentIndex = selectionGroups.findIndex(
                            (candidate) => candidate.groupId === group.groupId,
                          );
                          const nextSelectedIds = getNextSelectedParticipantIds(
                            group,
                            nextParticipant.sportEventParticipantId,
                            buildPickedAtById(draftState, entryId),
                          );
                          if (nextSelectedIds.length < group.picksFromGroup) {
                            return group.groupId;
                          }
                          const nextGroup = selectionGroups
                            .slice(currentIndex + 1)
                            .find((candidate) => candidate.selectedParticipantIds.length < candidate.picksFromGroup);

                          return nextGroup?.groupId ?? null;
                        });
                      })
                      // A refused pick is already shown by the mutation's error state and its
                      // optimistic change rolled back in onError; nothing is left to handle here.
                      .catch(() => undefined);
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
                  ? 'Your lineup is complete. Choose a tiebreaker and submit it: an entry only counts once it is submitted.'
                  : 'This entry only counts once its lineup is complete and submitted. A change that leaves a submitted lineup short needs submitting again.'}
              </Alert>
            ) : null}

            {submitSelectionMutation.isError ? (
              <Alert tone="danger">
                {extractErrorMessage(submitSelectionMutation.error, { fallback: 'We could not save this entry right now.' })}
              </Alert>
            ) : null}

            {submitEntryMutation.isError ? (
              <Alert data-testid="contest-entry-submit-error" tone="danger">
                {extractErrorMessage(submitEntryMutation.error, { fallback: 'We could not submit this entry right now.' })}
              </Alert>
            ) : null}

            {isEditable && isMyEntry && lineupComplete ? (
              <TiebreakerSelector
                disabled={saveEntryDetailsMutation.isPending || submitEntryMutation.isPending}
                isSubmitted={isSubmitted}
                isSubmitting={saveEntryDetailsMutation.isPending || submitEntryMutation.isPending}
                onChange={setTiebreakerDraft}
                onSubmit={() => void submitEntry()}
                options={TIEBREAKER_OPTIONS}
                submitDisabled={finalSubmitDisabled}
                value={hasSelectedTiebreaker ? String(selectedTiebreakerValue) : ''}
              />
            ) : null}
          </div>
        </Tile>
      </div>
    </section>
  );
}

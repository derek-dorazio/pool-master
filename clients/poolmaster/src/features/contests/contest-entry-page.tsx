import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  getContest,
  getDraftState,
  getLeague,
  listContestEntries,
  submitContestSelection,
  updateContestEntry,
  type GetContestResponses,
  type GetDraftStateResponses,
  type ListContestEntriesResponses,
} from '@/lib/api';
import {
  buildLeagueContestPath,
  buildLeaguePath,
} from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import {
  Alert,
  DefinitionList,
  ErrorState,
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

type ContestDetail = GetContestResponses[200]['contest'];
type DraftState = GetDraftStateResponses[200];

const TIEBREAKER_OPTIONS = Array.from({ length: 41 }, (_, index) => 10 - index);

function extractErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'We could not save this entry right now.';
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return 'We could not save this entry right now.';
}

function formatDateTimeDisplay(isoString: string | null | undefined) {
  if (!isoString) {
    return 'Unavailable';
  }

  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    return 'Unavailable';
  }

  return new Date(parsed).toLocaleString();
}

function formatRelativeToPar(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  if (value === 0) {
    return 'E';
  }

  return value > 0 ? `+${value}` : `${value}`;
}

function getContestPhaseLabel(contest: ContestDetail) {
  switch (contest.status) {
    case 'OPEN':
      return 'Editable until contest lock';
    case 'LOCKED':
      return 'Locked';
    case 'ACTIVE':
      return 'Scoring live';
    case 'COMPLETED':
      return 'Final';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return contest.status;
  }
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

function getNextSelectedParticipantIds(group: SelectionGroup, participantId: string) {
  if (group.selectedParticipantIds.includes(participantId)) {
    return group.selectedParticipantIds.filter((selectedParticipantId) => selectedParticipantId !== participantId);
  }

  if (group.selectedParticipantIds.length >= group.picksFromGroup) {
    return [...group.selectedParticipantIds.slice(0, group.picksFromGroup - 1), participantId];
  }

  return Array.from(new Set([...group.selectedParticipantIds, participantId]));
}

function applyOptimisticSelection(draftState: DraftState, participantId: string): DraftState {
  const selectionGroups = draftState.selectionGroups ?? [];
  const nextSelectionGroups = selectionGroups.map((group) => {
    if (!group.participants.some((participant) => participant.sportEventParticipantId === participantId)) {
      return group;
    }

    const selectedParticipantIds = getNextSelectedParticipantIds(group, participantId);
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
  const draftStateQueryKey = ['poolmaster', 'draft-state', contestId, entryId] as const;
  const groupToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [entryNameDraft, setEntryNameDraft] = useState('');
  const [tiebreakerDraft, setTiebreakerDraft] = useState('');
  const [draftDetailsSeedKey, setDraftDetailsSeedKey] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const contestQuery = useQuery({
    queryKey: ['poolmaster', 'contest', contestId],
    queryFn: async (): Promise<ContestDetail> => {
      const response = await getContest({ path: { contestId } });
      if (!response.data?.contest) {
        throw response.error ?? new Error('Contest detail response is missing data.');
      }
      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const contestEntriesQuery = useQuery({
    queryKey: ['poolmaster', 'contest-entries', contestId],
    queryFn: async (): Promise<ListContestEntriesResponses[200]> => {
      const response = await listContestEntries({ path: { contestId } });
      if (!response.data) {
        throw response.error ?? new Error('Contest entries response is missing data.');
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
        throw response.error ?? new Error('Draft state response is missing data.');
      }
      return response.data;
    },
    enabled: Boolean(contestId && entryId),
    retry: false,
  });

  const leagueCodeQuery = useQuery({
    queryKey: ['poolmaster', 'contest-league-code', contestQuery.data?.leagueId],
    queryFn: async () => {
      const response = await getLeague({ path: { id: contestQuery.data!.leagueId } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League response is missing league data.');
      }

      return response.data.league;
    },
    enabled: Boolean(contestQuery.data?.leagueId),
    retry: false,
  });

  useEffect(() => {
    if (!draftStateQuery.data) {
      return;
    }

    const nextSeedKey = `${contestId}:${entryId}`;
    if (draftDetailsSeedKey === nextSeedKey) {
      return;
    }

    setEntryNameDraft(draftStateQuery.data.selectedEntryName ?? '');
    setTiebreakerDraft(
      draftStateQuery.data.tiebreakerValue === null || draftStateQuery.data.tiebreakerValue === undefined
        ? ''
        : String(draftStateQuery.data.tiebreakerValue),
    );
    setDraftDetailsSeedKey(nextSeedKey);
  }, [contestId, draftDetailsSeedKey, draftStateQuery.data, entryId]);

  useEffect(() => {
    const selectionGroups = draftStateQuery.data?.selectionGroups ?? [];
    if (!selectionGroups.length) {
      setExpandedGroupId(null);
      return;
    }

    const nextIncomplete = getNextIncompleteGroupId(selectionGroups);
    setExpandedGroupId((current) => {
      if (current && selectionGroups.some((group) => group.groupId === current)) {
        return current;
      }

      return nextIncomplete;
    });
  }, [draftStateQuery.data?.selectionGroups]);

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

  const saveEntryDetailsMutation = useMutation({
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
        throw response.error ?? new Error('Contest entry update response is missing data.');
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
    onSuccess: async () => {
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: draftStateQueryKey }),
      ]);
    },
    onError: (error) => {
      const payload = {
        action: 'contestEntry.saveDetails.failed',
        data: {
          contestId,
          entryId,
        },
        err: error,
      };

      if (error instanceof Error) {
        logger.error(payload, 'Contest entry detail save failed unexpectedly');
      } else {
        logger.warn(payload, 'Contest entry detail save was rejected');
      }
    },
  });

  const submitSelectionMutation = useMutation({
    mutationFn: async (participantId: string) => {
      const response = await submitContestSelection({
        path: { contestId },
        body: {
          entryId,
          participantId,
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Contest selection response is missing data.');
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
          applyOptimisticSelection(previousDraftState, participantId),
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
      void queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] });
      void queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] });
    },
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

      if (error instanceof Error) {
        logger.error(payload, 'Contest selection failed unexpectedly');
      } else {
        logger.warn(payload, 'Contest selection was rejected');
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
  const backLeagueCode = hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null;
  const backToContestPath = backLeagueCode
    ? buildLeagueContestPath(backLeagueCode, contestId)
    : `/contests/${contestId}`;
  const backToLeaguePath = backLeagueCode ? buildLeaguePath(backLeagueCode) : '/welcome';
  const entrySummary = contestEntriesQuery.data?.entries.find((entry) => entry.id === entryId) ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const isMyEntry = myEntryIds.includes(entryId);
  const isEditable = contest.status === 'OPEN';
  const selectedEntry = draftState.entries.find((entry) => entry.id === entryId) ?? null;
  const selectionGroups = draftState.selectionGroups ?? [];
  const completionStats = getCompletionStats(selectionGroups);
  const nextIncompleteGroupId = getNextIncompleteGroupId(selectionGroups);
  const lineupComplete =
    completionStats.requiredSelections > 0
    && completionStats.totalSelections >= completionStats.requiredSelections;
  const hasSavedTiebreaker =
    draftState.tiebreakerValue !== null && draftState.tiebreakerValue !== undefined;
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
    || submitSelectionMutation.isPending;

  async function submitEntry() {
    await saveEntryDetailsMutation.mutateAsync();
    navigate(backToContestPath, {
      state: { leagueCode: backLeagueCode },
    });
  }

  if (contest.selectionType !== 'TIERED') {
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
            <StatusBadge tone={isEditable ? 'active' : 'locked'}>
              {getContestPhaseLabel(contest)}
            </StatusBadge>
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
            helperText="Tiers complete"
            label="Tier progress"
            value={`${completionStats.completedTiers}/${selectionGroups.length || 0}`}
          />
          <MetricTile
            helperText="Lineup slots filled"
            label="Picks saved"
            value={`${completionStats.totalSelections}/${completionStats.requiredSelections}`}
          />
          <MetricTile
            helperText={(
              <span data-testid="contest-entry-tiebreaker-summary">
                {hasSavedTiebreaker
                  ? `Relative to par ${formatRelativeToPar(draftState.tiebreakerValue) ?? draftState.tiebreakerValue}`
                  : isEditable
                    ? 'Needed after lineup is complete'
                    : 'No tiebreaker was saved'}
              </span>
            )}
            label="Tiebreaker"
            value={(
              <span data-testid="contest-entry-tiebreaker-status">
                {hasSavedTiebreaker ? 'Saved' : isEditable ? 'Needed' : 'Closed'}
              </span>
            )}
          />
          <MetricTile
            helperText={
              isEditable
                ? nextIncompleteGroupId
                  ? `Next focus: ${selectionGroups.find((group) => group.groupId === nextIncompleteGroupId)?.groupName ?? 'Open tier'}`
                  : 'Lineup is fully selected'
                : 'Entry editing is closed'
            }
            label="Lock time"
            value={formatDateTimeDisplay(contest.lockAt)}
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
                { label: 'Entry status', value: entrySummary?.status ?? 'ACTIVE' },
                { label: 'Contest phase', value: getContestPhaseLabel(contest) },
                { label: 'Score', value: `${entrySummary?.totalScore ?? 0} pts` },
                {
                  label: 'Standing',
                  value: entrySummary?.standingsPosition
                    ? `#${entrySummary.standingsPosition}`
                    : 'Rank pending',
                },
                { label: 'Created', value: formatDateTimeDisplay(entrySummary?.createdAt) },
                { label: 'Last updated', value: formatDateTimeDisplay(entrySummary?.updatedAt) },
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
                      {extractErrorMessage(saveEntryDetailsMutation.error)}
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
                      : `Winning score relative to par: ${formatRelativeToPar(draftState.tiebreakerValue) ?? draftState.tiebreakerValue}`}
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
                  onParticipantSelect={async (nextParticipant) => {
                    await submitSelectionMutation.mutateAsync(nextParticipant.sportEventParticipantId);
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
                      );
                      if (nextSelectedIds.length < group.picksFromGroup) {
                        return group.groupId;
                      }
                      const nextGroup = selectionGroups
                        .slice(currentIndex + 1)
                        .find((candidate) => candidate.selectedParticipantIds.length < candidate.picksFromGroup);

                      return nextGroup?.groupId ?? null;
                    });
                  }}
                  onToggle={() => setExpandedGroupId(isExpanded ? null : group.groupId)}
                  setToggleRef={(element) => {
                    groupToggleRefs.current[group.groupId] = element;
                  }}
                />
              );
            })}

            {submitSelectionMutation.isError ? (
              <Alert tone="danger">
                {extractErrorMessage(submitSelectionMutation.error)}
              </Alert>
            ) : null}

            {isEditable && isMyEntry && lineupComplete ? (
              <TiebreakerSelector
                disabled={saveEntryDetailsMutation.isPending}
                isSubmitting={saveEntryDetailsMutation.isPending}
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

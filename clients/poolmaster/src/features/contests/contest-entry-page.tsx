import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
  buildLeagueTeamPath,
} from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';

type ContestDetail = GetContestResponses[200]['contest'];
type DraftState = GetDraftStateResponses[200];
type SelectionGroup = NonNullable<DraftState['selectionGroups']>[number];
type SelectionParticipant = SelectionGroup['participants'][number];

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

function getSelectedParticipants(group: SelectionGroup) {
  const selectedIds = new Set(group.selectedParticipantIds);
  return group.participants.filter((participant) => selectedIds.has(participant.sportEventParticipantId));
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

function getGroupStatusLabel(group: SelectionGroup) {
  if (group.selectedParticipantIds.length >= group.picksFromGroup) {
    return 'Complete';
  }

  if (group.selectedParticipantIds.length > 0) {
    return 'In progress';
  }

  return 'Next up';
}

function getParticipantMetaSummary(participant: SelectionParticipant) {
  const parts: string[] = [];

  if (participant.orderIndex) {
    parts.push(`Contest rank #${participant.orderIndex}`);
  }
  if (participant.ranking !== undefined && participant.ranking !== null) {
    parts.push(`World rank #${participant.ranking}`);
  }
  if (participant.price !== undefined && participant.price !== null) {
    parts.push(`${participant.price} salary`);
  }
  if (participant.status) {
    parts.push(`Status: ${participant.status}`);
  }

  return parts;
}

function SelectionParticipantCard({
  canSelect,
  group,
  isBusy,
  onSelect,
  participant,
}: {
  canSelect: boolean;
  group: SelectionGroup;
  isBusy: boolean;
  onSelect: (participant: SelectionParticipant) => void;
  participant: SelectionParticipant;
}) {
  const selectedCount = group.selectedParticipantIds.length;
  const groupIsFull = selectedCount >= group.picksFromGroup;
  const isSelected = group.selectedParticipantIds.includes(participant.sportEventParticipantId);
  const canReplace = group.picksFromGroup === 1 && selectedCount === 1 && !isSelected;
  const isDisabled =
    isBusy
    || !canSelect
    || isSelected
    || !participant.isAvailable
    || (groupIsFull && !canReplace);

  let actionLabel = 'Select golfer';
  if (isSelected) {
    actionLabel = 'Selected';
  } else if (!participant.isAvailable) {
    actionLabel = participant.unavailableReason ?? 'Unavailable';
  } else if (canReplace) {
    actionLabel = 'Replace selection';
  } else if (groupIsFull) {
    actionLabel = 'Tier filled';
  }

  return (
    <button
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-foreground/30'
      } disabled:cursor-not-allowed disabled:opacity-70`}
      data-testid={`contest-entry-participant-${participant.sportEventParticipantId}`}
      disabled={isDisabled}
      onClick={() => onSelect(participant)}
      type="button"
    >
      <input
        aria-label={actionLabel}
        checked={isSelected}
        className="mt-1 h-4 w-4 accent-primary"
        readOnly
        tabIndex={-1}
        type="checkbox"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-foreground">{participant.participantName}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {participant.team ?? participant.position ?? 'Golf field participant'}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {actionLabel}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {getParticipantMetaSummary(participant).map((part) => (
            <span key={`${participant.sportEventParticipantId}-${part}`}>{part}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

function LockedSelectionGroup({
  group,
}: {
  group: SelectionGroup;
}) {
  const selectedParticipants = getSelectedParticipants(group);

  return (
    <section
      className="rounded-[1.75rem] border border-border bg-background p-4"
      data-testid={`contest-entry-group-${group.groupId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold text-foreground">{group.groupName}</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Frozen lineup from Tier {group.groupNumber}.
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Locked
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_90px] gap-2 border-b border-border px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <span>Golfer</span>
          <span className="text-right">Contest rank</span>
          <span className="text-right">World rank</span>
          <span className="text-right">Status</span>
        </div>
        <div className="divide-y divide-border">
          {selectedParticipants.length ? (
            selectedParticipants.map((participant) => (
              <div
                className="grid grid-cols-[minmax(0,1.6fr)_100px_110px_90px] gap-2 px-4 py-3 text-sm"
                data-testid={`contest-entry-locked-participant-${group.groupId}-${participant.sportEventParticipantId}`}
                key={participant.sportEventParticipantId}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{participant.participantName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {participant.team ?? participant.position ?? 'Golf field participant'}
                  </div>
                </div>
                <span className="text-right text-foreground">
                  {participant.orderIndex ? `#${participant.orderIndex}` : '—'}
                </span>
                <span className="text-right text-muted-foreground">
                  {participant.ranking !== undefined && participant.ranking !== null ? `#${participant.ranking}` : '—'}
                </span>
                <span className="text-right text-muted-foreground">
                  {participant.status ?? 'ACTIVE'}
                </span>
              </div>
            ))
          ) : (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              No golfer was saved from this tier.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function ContestEntryPage() {
  const logger = useLogger().child({
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
  const groupToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [entryNameDraft, setEntryNameDraft] = useState('');
  const [tiebreakerDraft, setTiebreakerDraft] = useState('');
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
    queryKey: ['poolmaster', 'draft-state', contestId, entryId],
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

    setEntryNameDraft(draftStateQuery.data.selectedEntryName ?? '');
    setTiebreakerDraft(
      draftStateQuery.data.tiebreakerValue === null || draftStateQuery.data.tiebreakerValue === undefined
        ? ''
        : String(draftStateQuery.data.tiebreakerValue),
    );
  }, [draftStateQuery.data]);

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
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'draft-state', contestId, entryId] }),
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
    onMutate: (participantId) => {
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
    },
    onSuccess: async () => {
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'draft-state', contestId, entryId] }),
      ]);
    },
    onError: (error, participantId) => {
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
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading contest entry...</p>
      </section>
    );
  }

  if (
    contestQuery.isError
    || !contestQuery.data
    || draftStateQuery.isError
    || !draftStateQuery.data
    || contestEntriesQuery.isError
  ) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">We couldn&apos;t load this contest entry.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Try refreshing or return to the contest board.
        </p>
      </section>
    );
  }

  const contest = contestQuery.data;
  const draftState = draftStateQuery.data;
  const backLeagueCode = hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null;
  const backToContestPath = backLeagueCode
    ? buildLeagueContestPath(backLeagueCode, contestId)
    : `/contests/${contestId}`;
  const backToLeaguePath = backLeagueCode ? buildLeaguePath(backLeagueCode) : '/welcome';
  const teamPath = backLeagueCode ? buildLeagueTeamPath(backLeagueCode) : null;
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
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">This entry flow is not ready yet.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The first-pass entry builder currently supports tiered contest selections only.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="rounded-2xl border border-border px-4 py-3 text-sm font-medium" to={backToContestPath}>
            Back to contest
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {getContestPhaseLabel(contest)}
            </span>
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
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
              data-testid="contest-entry-back-to-contest"
              state={{ leagueCode: backLeagueCode }}
              to={backToContestPath}
            >
              Back to contest
            </Link>
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
              data-testid="contest-entry-back-to-league"
              to={backToLeaguePath}
            >
              Back to league
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-[1.5rem] bg-background px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Tier progress</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {completionStats.completedTiers}/{selectionGroups.length || 0}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Tiers complete</div>
          </div>
          <div className="rounded-[1.5rem] bg-background px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Picks saved</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {completionStats.totalSelections}/{completionStats.requiredSelections}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">Lineup slots filled</div>
          </div>
          <div className="rounded-[1.5rem] bg-background px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Tiebreaker</div>
            <div className="mt-2 text-2xl font-semibold text-foreground" data-testid="contest-entry-tiebreaker-status">
              {hasSavedTiebreaker ? 'Saved' : isEditable ? 'Needed' : 'Closed'}
            </div>
            <div className="mt-1 text-sm text-muted-foreground" data-testid="contest-entry-tiebreaker-summary">
              {hasSavedTiebreaker
                ? `Relative to par ${formatRelativeToPar(draftState.tiebreakerValue) ?? draftState.tiebreakerValue}`
                : isEditable
                  ? 'Needed after lineup is complete'
                  : 'No tiebreaker was saved'}
            </div>
          </div>
          <div className="rounded-[1.5rem] bg-background px-4 py-4">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Lock time</div>
            <div className="mt-2 text-lg font-semibold text-foreground">
              {formatDateTimeDisplay(contest.lockAt)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {isEditable
                ? nextIncompleteGroupId
                  ? `Next focus: ${selectionGroups.find((group) => group.groupId === nextIncompleteGroupId)?.groupName ?? 'Open tier'}`
                  : 'Lineup is fully selected'
                : 'Entry editing is closed'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">
              {isEditable ? 'Entry details' : 'Entry summary'}
            </h3>

            <dl className="mt-5 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="rounded-2xl bg-background px-4 py-4">
                <dt>Entry status</dt>
                <dd className="mt-1 font-semibold text-foreground">
                  {entrySummary?.status ?? 'ACTIVE'}
                </dd>
              </div>
              <div className="rounded-2xl bg-background px-4 py-4">
                <dt>Contest phase</dt>
                <dd className="mt-1 font-semibold text-foreground">{getContestPhaseLabel(contest)}</dd>
              </div>
              <div className="rounded-2xl bg-background px-4 py-4">
                <dt>Score</dt>
                <dd className="mt-1 font-semibold text-foreground">{entrySummary?.totalScore ?? 0} pts</dd>
              </div>
              <div className="rounded-2xl bg-background px-4 py-4">
                <dt>Standing</dt>
                <dd className="mt-1 font-semibold text-foreground">
                  {entrySummary?.standingsPosition ? `#${entrySummary.standingsPosition}` : 'Rank pending'}
                </dd>
              </div>
              <div className="rounded-2xl bg-background px-4 py-4">
                <dt>Created</dt>
                <dd className="mt-1 font-semibold text-foreground">
                  {formatDateTimeDisplay(entrySummary?.createdAt)}
                </dd>
              </div>
              <div className="rounded-2xl bg-background px-4 py-4">
                <dt>Last updated</dt>
                <dd className="mt-1 font-semibold text-foreground">
                  {formatDateTimeDisplay(entrySummary?.updatedAt)}
                </dd>
              </div>
            </dl>

            {isMyEntry ? (
              isEditable ? (
                <div className="mt-5 space-y-4 rounded-[1.5rem] border border-border bg-background p-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">Entry name</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                      data-testid="contest-entry-name-input"
                      disabled={saveEntryDetailsMutation.isPending}
                      maxLength={100}
                      onChange={(event) => setEntryNameDraft(event.target.value)}
                      value={entryNameDraft}
                    />
                  </label>
                  {saveEntryDetailsMutation.isError ? (
                    <p className="text-sm text-destructive">
                      {extractErrorMessage(saveEntryDetailsMutation.error)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 rounded-[1.5rem] border border-border bg-background p-4">
                  <div className="text-sm font-medium text-foreground">Saved tiebreaker</div>
                  <div
                    className="mt-2 text-sm text-muted-foreground"
                    data-testid="contest-entry-readonly-tiebreaker"
                  >
                    {draftState.tiebreakerValue === null || draftState.tiebreakerValue === undefined
                      ? 'No tiebreaker prediction was saved.'
                      : `Winning score relative to par: ${formatRelativeToPar(draftState.tiebreakerValue) ?? draftState.tiebreakerValue}`}
                  </div>
                </div>
              )
            ) : (
              <div className="mt-5 rounded-[1.5rem] border border-border bg-background p-4 text-sm text-muted-foreground">
                This entry is not part of your current team context.
              </div>
            )}

            {teamPath ? (
              <Link
                className="mt-4 inline-flex rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                data-testid="contest-entry-view-team-link"
                to={teamPath}
              >
                View team home
              </Link>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Selection progress</h3>
            <div className="mt-5 space-y-3">
              {selectionGroups.map((group) => {
                const selectedParticipants = getSelectedParticipants(group);
                return (
                  <div
                    className="rounded-[1.5rem] border border-border bg-background p-4"
                    data-testid={`contest-entry-summary-group-${group.groupId}`}
                    key={group.groupId}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-foreground">{group.groupName}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {selectedParticipants.length} of {group.picksFromGroup} saved
                        </div>
                      </div>
                      <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Tier {group.groupNumber}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {selectedParticipants.length ? (
                        selectedParticipants.map((participant) => (
                          <div
                            className="rounded-2xl border border-border bg-card px-4 py-3"
                            data-testid={`contest-entry-selected-${group.groupId}-${participant.sportEventParticipantId}`}
                            key={participant.sportEventParticipantId}
                          >
                            <div className="font-medium text-foreground">{participant.participantName}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {getParticipantMetaSummary(participant).length
                                ? getParticipantMetaSummary(participant).map((part) => (
                                  <span key={`${participant.sportEventParticipantId}-${part}`}>{part}</span>
                                ))
                                : <span>Currently on this entry</span>}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No golfer is saved from this tier yet.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold" data-testid="contest-entry-builder-heading">
            {isEditable ? 'Build your lineup' : 'Saved lineup detail'}
          </h3>
          <div className="mt-5 space-y-5">
            {selectionGroups.map((group) => {
              if (!isEditable) {
                return <LockedSelectionGroup group={group} key={group.groupId} />;
              }

              const isExpanded = expandedGroupId === group.groupId;
              const selectedParticipants = getSelectedParticipants(group);
              const isComplete = group.selectedParticipantIds.length >= group.picksFromGroup;
              const statusLabel = getGroupStatusLabel(group);

              return (
                <section
                  className="rounded-[1.75rem] border border-border bg-background p-4"
                  data-testid={`contest-entry-group-${group.groupId}`}
                  key={group.groupId}
                >
                  <button
                    className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
                    data-testid={`contest-entry-group-toggle-${group.groupId}`}
                    onClick={() => setExpandedGroupId(isExpanded ? null : group.groupId)}
                    ref={(element) => {
                      groupToggleRefs.current[group.groupId] = element;
                    }}
                    type="button"
                  >
                    <div>
                      <h4 className="text-lg font-semibold text-foreground">{group.groupName}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Choose {group.picksFromGroup} golfer{group.picksFromGroup === 1 ? '' : 's'} from this tier.
                      </p>
                      {selectedParticipants.length ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {selectedParticipants.map((participant) => (
                            <span
                              className="rounded-full border border-border px-3 py-1"
                              key={participant.sportEventParticipantId}
                            >
                              {participant.participantName}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {statusLabel}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {group.selectedParticipantIds.length}/{group.picksFromGroup} saved
                      </span>
                      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {isExpanded ? 'Hide tier' : isComplete ? 'Review tier' : 'Open tier'}
                      </span>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="mt-4 grid gap-3">
                      {group.participants.map((participant) => (
                        <SelectionParticipantCard
                          canSelect={isEditable && isMyEntry}
                          group={group}
                          isBusy={submitSelectionMutation.isPending}
                          key={participant.sportEventParticipantId}
                          onSelect={async (nextParticipant) => {
                            await submitSelectionMutation.mutateAsync(nextParticipant.sportEventParticipantId);
                            setExpandedGroupId((current) => {
                              if (current !== group.groupId) {
                                return current;
                              }

                              const currentIndex = selectionGroups.findIndex(
                                (candidate) => candidate.groupId === group.groupId,
                              );
                              const nextSelectedIds = group.picksFromGroup === 1
                                ? [nextParticipant.sportEventParticipantId]
                                : Array.from(new Set([
                                  ...group.selectedParticipantIds,
                                  nextParticipant.sportEventParticipantId,
                                ]));
                              if (nextSelectedIds.length < group.picksFromGroup) {
                                return group.groupId;
                              }
                              const nextGroup = selectionGroups
                                .slice(currentIndex + 1)
                                .find((candidate) => candidate.selectedParticipantIds.length < candidate.picksFromGroup);

                              return nextGroup?.groupId ?? null;
                            });
                          }}
                          participant={participant}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}

            {submitSelectionMutation.isError ? (
              <p className="text-sm text-destructive">
                {extractErrorMessage(submitSelectionMutation.error)}
              </p>
            ) : null}

            {isEditable && isMyEntry && lineupComplete ? (
              <div className="rounded-[1.75rem] border border-border bg-background p-4">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">Winning Score Relative to Par</span>
                  <select
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid="contest-entry-tiebreaker-select"
                    disabled={saveEntryDetailsMutation.isPending}
                    onChange={(event) => setTiebreakerDraft(event.target.value)}
                    value={hasSelectedTiebreaker ? String(selectedTiebreakerValue) : ''}
                  >
                    <option value="">Select score</option>
                    {TIEBREAKER_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {formatRelativeToPar(option)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="mt-4 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="contest-entry-submit"
                  disabled={finalSubmitDisabled}
                  onClick={() => void submitEntry()}
                  type="button"
                >
                  {saveEntryDetailsMutation.isPending ? 'Submitting...' : 'Submit entry'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
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
  buildLeaguePath,
  buildLeagueTeamPath,
} from '@/features/leagues/league-routing';
import { parseRouteState } from '@/routes/route-state';

type ContestDetail = GetContestResponses[200]['contest'];
type DraftState = GetDraftStateResponses[200];
type SelectionGroup = NonNullable<DraftState['selectionGroups']>[number];
type SelectionParticipant = SelectionGroup['participants'][number];

function buildContestEntryPath(contestId: string, entryId: string) {
  return `/contests/${contestId}/entries/${entryId}`;
}

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
      className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-foreground/30'
      } disabled:cursor-not-allowed disabled:opacity-70`}
      data-testid={`contest-entry-participant-${participant.sportEventParticipantId}`}
      disabled={isDisabled}
      onClick={() => onSelect(participant)}
      type="button"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium text-foreground">{participant.participantName}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {participant.team ?? participant.position ?? 'Golf field participant'}
          </div>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {actionLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {participant.orderIndex ? <span>Contest rank #{participant.orderIndex}</span> : null}
        {participant.ranking !== undefined && participant.ranking !== null ? (
          <span>World rank #{participant.ranking}</span>
        ) : null}
        {participant.price !== undefined && participant.price !== null ? <span>{participant.price} salary</span> : null}
        {participant.status ? <span>Status: {participant.status}</span> : null}
      </div>
    </button>
  );
}

export function ContestEntryPage() {
  const { contestId = '', entryId = '' } = useParams<{ contestId: string; entryId: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const hintedLeagueCode = parseRouteState(location.state).leagueCode ?? null;

  const [entryNameDraft, setEntryNameDraft] = useState('');
  const [tiebreakerDraft, setTiebreakerDraft] = useState('');

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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'draft-state', contestId, entryId] }),
      ]);
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'contest-entries', contestId] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'draft-state', contestId, entryId] }),
      ]);
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
          The entry route depends on the live draft-state and contest entry contracts.
        </p>
      </section>
    );
  }

  const contest = contestQuery.data;
  const draftState = draftStateQuery.data;
  const backLeagueCode = hintedLeagueCode ?? leagueCodeQuery.data?.leagueCode ?? null;
  const backToContestPath = backLeagueCode
    ? `/contests/${contestId}`
    : `/contests/${contestId}`;
  const backToLeaguePath = backLeagueCode ? buildLeaguePath(backLeagueCode) : '/welcome';
  const teamPath = backLeagueCode ? buildLeagueTeamPath(backLeagueCode) : null;
  const entrySummary = contestEntriesQuery.data?.entries.find((entry) => entry.id === entryId) ?? null;
  const myEntryIds = contestEntriesQuery.data?.myEntryIds ?? [];
  const isMyEntry = myEntryIds.includes(entryId);
  const isEditable = contest.status === 'OPEN';
  const selectedEntry = draftState.entries.find((entry) => entry.id === entryId) ?? null;
  const selectionGroups = draftState.selectionGroups ?? [];

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
              <h2 className="text-3xl font-semibold tracking-tight">
                {selectedEntry?.name ?? entrySummary?.name ?? 'Contest entry'}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
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
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">
              {isEditable ? 'Entry details' : 'Entry summary'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {isEditable
                ? 'Keep the default seeded name if you want, or personalize it and set a tiebreaker before the contest locks.'
                : 'This contest entry is now read-only. The saved lineup and tiebreaker stay visible here for team-history context.'}
            </p>

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
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">Winning score tiebreaker</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                      data-testid="contest-entry-tiebreaker-input"
                      disabled={saveEntryDetailsMutation.isPending}
                      inputMode="numeric"
                      onChange={(event) => setTiebreakerDraft(event.target.value)}
                      placeholder="Optional"
                      value={tiebreakerDraft}
                    />
                  </label>
                  <button
                    className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="contest-entry-save-details"
                    disabled={saveEntryDetailsMutation.isPending}
                    onClick={() => void saveEntryDetailsMutation.mutateAsync()}
                    type="button"
                  >
                    {saveEntryDetailsMutation.isPending ? 'Saving...' : 'Save entry details'}
                  </button>
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
                      : `Winning score prediction: ${draftState.tiebreakerValue}`}
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
                            <div className="mt-1 text-sm text-muted-foreground">
                              {participant.status ? `Status: ${participant.status}` : 'Currently on this entry'}
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
          <h3 className="text-xl font-semibold">
            {isEditable ? 'Build your lineup' : 'Saved lineup detail'}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {isEditable
              ? 'Each tier below uses the contest-ready field already frozen for this contest. Tap a golfer to fill or replace that tier.'
              : 'These tiers show the frozen contest field and the golfers this entry carried once the contest moved past editing.'}
          </p>
          <div className="mt-5 space-y-5">
            {selectionGroups.map((group) => (
              <section
                className="rounded-[1.75rem] border border-border bg-background p-4"
                data-testid={`contest-entry-group-${group.groupId}`}
                key={group.groupId}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold text-foreground">{group.groupName}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose {group.picksFromGroup} golfer{group.picksFromGroup === 1 ? '' : 's'} from this tier.
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {group.selectedParticipantIds.length}/{group.picksFromGroup} saved
                  </span>
                </div>

                <div className="mt-4 grid gap-3">
                  {group.participants.map((participant) => (
                    <SelectionParticipantCard
                      canSelect={isEditable && isMyEntry}
                      group={group}
                      isBusy={submitSelectionMutation.isPending}
                      key={participant.sportEventParticipantId}
                      onSelect={(nextParticipant) =>
                        void submitSelectionMutation.mutateAsync(nextParticipant.sportEventParticipantId)}
                      participant={participant}
                    />
                  ))}
                </div>
              </section>
            ))}

            {submitSelectionMutation.isError ? (
              <p className="text-sm text-destructive">
                {extractErrorMessage(submitSelectionMutation.error)}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export { buildContestEntryPath };

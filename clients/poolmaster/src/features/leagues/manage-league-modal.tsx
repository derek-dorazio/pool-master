import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { LeagueIconKey } from '@poolmaster/shared/domain';
import {
  deleteLeague,
  getLeague,
  inactivateLeague,
  updateLeagueDetails,
  updateLeagueIcon,
  type ListLeaguesResponses,
} from '@/lib/api';
import { buildLeaguePath } from './league-routing';
import { LeagueIcon } from './league-icon';
import { LEAGUE_ICON_OPTIONS } from './league-icon-catalog';
import { removeLeagueSummary, syncLeagueCaches } from './league-cache';
import { extractErrorMessage } from '@/lib/errors';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

const MANAGE_TAB_DETAILS = 'details';
const MANAGE_TAB_ICON = 'icon';
const MANAGE_TAB_SETTINGS = 'settings';
const MANAGE_TAB_LIFECYCLE = 'lifecycle';

type ManageTab =
  | typeof MANAGE_TAB_DETAILS
  | typeof MANAGE_TAB_ICON
  | typeof MANAGE_TAB_SETTINGS
  | typeof MANAGE_TAB_LIFECYCLE;

const MANAGE_TABS: Array<{ key: ManageTab; label: string; hint: string }> = [
  { key: MANAGE_TAB_DETAILS, label: 'Details', hint: 'League info and description' },
  { key: MANAGE_TAB_ICON, label: 'Icon', hint: 'League branding and identity' },
  { key: MANAGE_TAB_SETTINGS, label: 'Settings', hint: 'Rules and commissioner options' },
  {
    key: MANAGE_TAB_LIFECYCLE,
    label: 'Lifecycle',
    hint: 'Inactivate and permanent delete',
  },
];

type ManageLeagueModalProps = {
  isOpen: boolean;
  league: LeagueSummary | null;
  onClose: () => void;
  onDeleted: () => void;
};

function roleLabel(role: string | null | undefined) {
  if (!role) {
    return 'Not a member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function ManageLeagueModal({
  isOpen,
  league,
  onClose,
  onDeleted,
}: ManageLeagueModalProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ManageTab>(MANAGE_TAB_LIFECYCLE);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [detailsName, setDetailsName] = useState('');
  const [detailsDescription, setDetailsDescription] = useState('');
  const [selectedIconKey, setSelectedIconKey] = useState(league?.iconKey ?? 'TROPHY');
  const normalizedConfirmation = useMemo(
    () => deleteConfirmation.trim().toUpperCase(),
    [deleteConfirmation],
  );

  useEffect(() => {
    if (!league) {
      return;
    }

    setDetailsName(league.name);
    setDetailsDescription(league.description ?? '');
    setSelectedIconKey(league.iconKey);
  }, [league]);

  const leagueDetailQuery = useQuery({
    queryKey: ['poolmaster', 'league', league?.id, 'manage'],
    enabled: isOpen && Boolean(league?.id),
    queryFn: async () => {
      const response = await getLeague({
        path: { id: league?.id ?? '' },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
      }

      return response.data.league;
    },
  });

  const inactivateMutation = useMutation({
    mutationFn: async (leagueId: string) => {
      const response = await inactivateLeague({
        path: { id: leagueId },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League inactivation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (updatedLeague) => {
      syncLeagueCaches(queryClient, updatedLeague, { manageLeagueId: league?.id ?? null });
    },
  });

  const detailsMutation = useMutation({
    mutationFn: async ({
      leagueId,
      name,
      description,
    }: {
      leagueId: string;
      name: string;
      description?: string;
    }) => {
      const response = await updateLeagueDetails({
        path: { id: leagueId },
        body: {
          name,
          ...(description?.trim() ? { description: description.trim() } : {}),
        },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League details update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (updatedLeague) => {
      setDetailsName(updatedLeague.name);
      setDetailsDescription(updatedLeague.description ?? '');
      syncLeagueCaches(queryClient, updatedLeague, { manageLeagueId: league?.id ?? null });
    },
  });

  const iconMutation = useMutation({
    mutationFn: async ({ leagueId, iconKey }: { leagueId: string; iconKey: LeagueIconKey }) => {
      const response = await updateLeagueIcon({
        path: { id: leagueId },
        body: { iconKey },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League icon update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (updatedLeague) => {
      setSelectedIconKey(updatedLeague.iconKey);
      syncLeagueCaches(queryClient, updatedLeague, { manageLeagueId: league?.id ?? null });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ leagueId, leagueCode }: { leagueId: string; leagueCode: string }) => {
      const response = await deleteLeague({
        path: { id: leagueId },
        body: { leagueCode },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('League delete response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      queryClient.setQueryData(['poolmaster', 'leagues'], (current: LeagueSummary[] | undefined) =>
        removeLeagueSummary(current, league?.id ?? ''),
      );
      queryClient.removeQueries({ queryKey: ['poolmaster', 'league', league?.leagueCode], exact: true });
      queryClient.removeQueries({ queryKey: ['poolmaster', 'league', league?.id, 'manage'], exact: true });
      setDeleteSuccess(true);
    },
  });

  function handleClose() {
    if (
      inactivateMutation.isPending ||
      detailsMutation.isPending ||
      iconMutation.isPending ||
      deleteMutation.isPending
    ) {
      return;
    }

    setActiveTab(MANAGE_TAB_LIFECYCLE);
    setDeleteConfirmation('');
    setDeleteSuccess(false);
    setDetailsName(league?.name ?? '');
    setDetailsDescription(league?.description ?? '');
    setSelectedIconKey(league?.iconKey ?? 'TROPHY');
    inactivateMutation.reset();
    detailsMutation.reset();
    iconMutation.reset();
    deleteMutation.reset();
    onClose();
  }

  if (!isOpen || !league) {
    return null;
  }

  const isInactive = inactivateMutation.data?.isActive === false || league.isActive === false;
  const canDelete = isInactive && normalizedConfirmation === league.leagueCode;
  const canEditDetails = !isInactive && !detailsMutation.isPending && !deleteMutation.isPending;
  const currentJoinPolicy = leagueDetailQuery.data?.joinPolicy;
  const canEditIcon = !isInactive && !iconMutation.isPending && !deleteMutation.isPending;

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        }
      }}
      open={isOpen}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby="manage-league-modal-description"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
          data-testid="manage-league-modal"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                League management
              </span>
              <div className="space-y-2">
                <Dialog.Title className="text-2xl font-semibold tracking-tight">
                  Manage {league.name}
                </Dialog.Title>
                <Dialog.Description
                  className="text-sm text-muted-foreground"
                  id="manage-league-modal-description"
                >
                  Commissioner management lives here. This shell will grow into details, icon,
                  settings, and lifecycle editing without moving the commissioner to a new route.
                </Dialog.Description>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                aria-label="Close manage league modal"
                className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={inactivateMutation.isPending || detailsMutation.isPending || deleteMutation.isPending}
                onClick={handleClose}
                type="button"
              >
                Close
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-border bg-background p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                  Overview
                </div>
                <div className="mt-3 space-y-2">
                  <div className="text-lg font-semibold">{league.name}</div>
                  <div className="text-sm text-muted-foreground">League code: {league.leagueCode}</div>
                  <div className="text-sm text-muted-foreground">
                    Role: {league.isRootAdmin ? 'Root Admin' : roleLabel(league.memberType)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Status: {isInactive ? 'Inactive' : 'Active'}
                  </div>
                </div>
                <div className="mt-4 flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary">
                  <LeagueIcon iconKey={leagueDetailQuery.data?.iconKey ?? league.iconKey} size="lg" />
                </div>
              </div>

              <nav aria-label="Manage league sections" className="space-y-2">
                {MANAGE_TABS.map((tab) => {
                  const isActiveTab = activeTab === tab.key;
                  return (
                    <button
                      className={`block w-full rounded-[1.25rem] border px-4 py-3 text-left transition ${
                        isActiveTab
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      type="button"
                    >
                      <div className="text-sm font-medium">{tab.label}</div>
                      <div className="mt-1 text-xs">{tab.hint}</div>
                    </button>
                  );
                })}
              </nav>
            </div>

            <section className="min-h-[28rem] rounded-[1.75rem] border border-border bg-background p-5">
              {activeTab === MANAGE_TAB_DETAILS ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold">League details</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Edit the commissioner-owned league details that are real today: league name
                      and description. League code stays stable after creation.
                    </p>
                  </div>
                  <div className="grid gap-4 rounded-[1.5rem] border border-border bg-card p-5 sm:grid-cols-2">
                    <label className="block space-y-2 sm:col-span-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        League name
                      </span>
                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-70"
                        data-testid="manage-league-name"
                        disabled={!canEditDetails}
                        onChange={(event) => setDetailsName(event.target.value)}
                        type="text"
                        value={detailsName}
                      />
                    </label>

                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        League code
                      </div>
                      <div className="mt-1 font-mono text-base font-medium">{league.leagueCode}</div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Homepage
                      </div>
                      <a
                        className="mt-1 inline-flex text-sm font-medium text-primary hover:underline"
                        href={buildLeaguePath(league.leagueCode)}
                      >
                        {buildLeaguePath(league.leagueCode)}
                      </a>
                    </div>

                    <label className="block space-y-2 sm:col-span-2">
                      <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Description
                      </span>
                      <textarea
                        className="min-h-28 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-70"
                        data-testid="manage-league-description"
                        disabled={!canEditDetails}
                        onChange={(event) => setDetailsDescription(event.target.value)}
                        value={detailsDescription}
                      />
                    </label>

                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Member count
                      </div>
                      <div className="mt-1 text-base font-medium">{league.memberCount}</div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Active contests
                      </div>
                      <div className="mt-1 text-base font-medium">{league.activeContestCount}</div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Status
                      </div>
                      <div className="mt-1 text-base font-medium">{isInactive ? 'Inactive' : 'Active'}</div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Created
                      </div>
                      <div className="mt-1 text-base font-medium">
                        {league.createdAt ? new Date(league.createdAt).toLocaleDateString() : 'Unknown'}
                      </div>
                    </div>
                  </div>

                  {isInactive ? (
                    <p className="rounded-2xl border border-[color:var(--status-warning-border)] bg-[var(--status-warning-surface)] px-4 py-3 text-sm [color:var(--status-warning-text)]">
                      Inactive leagues are read-only here. Lifecycle remains the only place to
                      make further league changes.
                    </p>
                  ) : null}

                  {detailsMutation.isError ? (
                    <p className="text-sm text-destructive">{extractErrorMessage(detailsMutation.error, { fallback: 'We could not complete that league action. Please try again.' })}</p>
                  ) : null}

                  {detailsMutation.isSuccess ? (
                    <p className="text-sm [color:var(--status-active-text)]">League details were saved.</p>
                  ) : null}

                  <div className="flex justify-end">
                    <button
                      className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="manage-league-save-details"
                      disabled={!canEditDetails || detailsName.trim().length === 0}
                      onClick={() =>
                        void detailsMutation.mutateAsync({
                          leagueId: league.id,
                          name: detailsName.trim(),
                          description: detailsDescription,
                        })
                      }
                      type="button"
                    >
                      {detailsMutation.isPending ? 'Saving...' : 'Save details'}
                    </button>
                  </div>
                </div>
              ) : null}

              {activeTab === MANAGE_TAB_ICON ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold">League icon</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Choose from the built-in Prime Time Commissioner icon catalog.
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-border bg-card p-5">
                    <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary">
                        <LeagueIcon iconKey={selectedIconKey as never} size="lg" />
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Selected icon
                        </div>
                        <div className="mt-1 text-base font-medium">
                          {LEAGUE_ICON_OPTIONS.find((icon) => icon.key === selectedIconKey)?.label ?? 'Trophy'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-4">
                      {LEAGUE_ICON_OPTIONS.map((icon) => {
                        const isSelected = selectedIconKey === icon.key;

                        return (
                          <button
                            className={`rounded-[1.25rem] border px-3 py-4 text-center transition ${
                              isSelected
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                            }`}
                            data-testid={`manage-league-icon-${icon.key}`}
                            disabled={!canEditIcon}
                            key={icon.key}
                            onClick={() => setSelectedIconKey(icon.key)}
                            type="button"
                          >
                            <div className="flex justify-center text-primary">
                              <LeagueIcon iconKey={icon.key} size="md" />
                            </div>
                            <div className="mt-3 text-xs font-medium">{icon.label}</div>
                          </button>
                        );
                      })}
                    </div>

                    {isInactive ? (
                      <p className="mt-4 rounded-2xl border border-[color:var(--status-warning-border)] bg-[var(--status-warning-surface)] px-4 py-3 text-sm [color:var(--status-warning-text)]">
                        Inactive leagues are read-only here. Lifecycle remains the only place to
                        make further league changes.
                      </p>
                    ) : null}

                    {iconMutation.isError ? (
                      <p className="mt-4 text-sm text-destructive">{extractErrorMessage(iconMutation.error, { fallback: 'We could not complete that league action. Please try again.' })}</p>
                    ) : null}

                    {iconMutation.isSuccess ? (
                      <p className="mt-4 text-sm [color:var(--status-active-text)]">League icon was saved.</p>
                    ) : null}

                    <div className="mt-5 flex justify-end">
                      <button
                        className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="manage-league-save-icon"
                        disabled={!canEditIcon}
                        onClick={() =>
                          void iconMutation.mutateAsync({
                            leagueId: league.id,
                            iconKey: selectedIconKey,
                          })
                        }
                        type="button"
                      >
                        {iconMutation.isPending ? 'Saving...' : 'Save icon'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === MANAGE_TAB_SETTINGS ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold">League settings</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Review the current league settings.
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-border bg-card p-5">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Join policy
                    </div>
                    <div className="mt-2 text-base font-medium">
                      {currentJoinPolicy ?? 'Loading...'}
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Join policy editing is not available from this page.
                    </p>
                  </div>
                </div>
              ) : null}

              {activeTab === MANAGE_TAB_LIFECYCLE ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold">League lifecycle</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Inactivate first, then permanently delete only after the league is inactive.
                    </p>
                  </div>

                  <section className="rounded-[1.5rem] border border-border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <h4 className="text-lg font-semibold">Inactivate league</h4>
                        <p className="max-w-2xl text-sm text-muted-foreground">
                          Inactivation is the normal commissioner action. The league remains
                          visible, but it becomes read-only and is eligible for permanent delete
                          afterward.
                        </p>
                      </div>
                      <button
                        className="rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="manage-league-inactivate"
                        disabled={isInactive || inactivateMutation.isPending || deleteMutation.isPending}
                        onClick={() => void inactivateMutation.mutateAsync(league.id)}
                        title={
                          isInactive
                            ? 'This league is already inactive.'
                            : 'Inactivate keeps the league visible but ends active day-to-day use.'
                        }
                        type="button"
                      >
                        {isInactive
                          ? 'League inactive'
                          : inactivateMutation.isPending
                            ? 'Inactivating...'
                            : 'Inactivate league'}
                      </button>
                    </div>

                    {inactivateMutation.isError ? (
                      <p className="mt-4 text-sm text-destructive">
                        {extractErrorMessage(inactivateMutation.error, { fallback: 'We could not complete that league action. Please try again.' })}
                      </p>
                    ) : null}

                    {isInactive ? (
                      <p
                        className="mt-4 rounded-2xl border border-[color:var(--status-warning-border)] bg-[var(--status-warning-surface)] px-4 py-3 text-sm [color:var(--status-warning-text)]"
                        data-testid="manage-league-inactive-state"
                      >
                        This league is inactive. Delete is now available as a separate, irreversible
                        action.
                      </p>
                    ) : null}
                  </section>

                  <section className="rounded-[1.5rem] border border-[color:var(--status-danger-border)] bg-[var(--status-danger-surface)] p-5">
                    {deleteSuccess ? (
                      <div className="space-y-4" data-testid="manage-league-delete-success">
                        <h4 className="text-lg font-semibold [color:var(--status-danger-text)]">Your league was deleted.</h4>
                        <p className="text-sm [color:var(--status-danger-text)]">
                          The league and its related data were removed. You can now return to your
                          home context.
                        </p>
                        <button
                          className="rounded-2xl bg-destructive px-4 py-3 text-sm font-medium text-destructive-foreground"
                          onClick={onDeleted}
                          type="button"
                        >
                          Exit
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <h4 className="text-lg font-semibold [color:var(--status-danger-text)]">Delete league</h4>
                          <p className="text-sm [color:var(--status-danger-text)]">
                            This action will delete this league and all related data. This action
                            is irreversible. Are you sure you want to proceed?
                          </p>
                        </div>

                        <div className="rounded-[1.25rem] border border-[color:var(--status-danger-border)] bg-card p-4">
                          <p className="text-sm [color:var(--status-danger-text)]">
                            Are you sure you want to proceed? This action is irreversible. Please
                            enter <span className="font-mono font-semibold">{league.leagueCode}</span>{' '}
                            to continue.
                          </p>
                          <label className="mt-4 block space-y-2">
                            <span className="text-sm font-medium [color:var(--status-danger-text)]">Confirmation code</span>
                            <input
                              className="w-full rounded-2xl border border-[color:var(--status-danger-border)] bg-card px-4 py-3 font-mono text-sm uppercase outline-none transition focus:border-[color:var(--status-danger-text)]"
                              data-testid="manage-league-delete-confirmation"
                              disabled={!isInactive || deleteMutation.isPending}
                              onChange={(event) => setDeleteConfirmation(event.target.value)}
                              placeholder={league.leagueCode}
                              type="text"
                              value={deleteConfirmation}
                            />
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            className="rounded-2xl bg-destructive px-4 py-3 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid="manage-league-delete-submit"
                            disabled={!canDelete || deleteMutation.isPending}
                            onClick={() =>
                              void deleteMutation.mutateAsync({
                                leagueId: league.id,
                                leagueCode: league.leagueCode,
                              })
                            }
                            title={
                              isInactive
                                ? 'Delete permanently removes the league and its related history.'
                                : 'Inactivate the league first before permanent delete is allowed.'
                            }
                            type="button"
                          >
                            {deleteMutation.isPending ? 'Deleting...' : 'DELETE'}
                          </button>
                          {!isInactive ? (
                            <span className="text-sm [color:var(--status-danger-text)]">
                              Delete is unavailable until the league is inactive.
                            </span>
                          ) : null}
                        </div>

                        {deleteMutation.isError ? (
                          <p className="text-sm text-destructive">
                            {extractErrorMessage(deleteMutation.error, { fallback: 'We could not complete that league action. Please try again.' })}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </section>
                </div>
              ) : null}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

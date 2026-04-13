import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { deleteLeague, inactivateLeague, type ListLeaguesResponses } from '@/lib/api';

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

function roleLabel(role: string | undefined) {
  if (!role) {
    return 'Member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not complete that league action. Please try again.';
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

  return 'We could not complete that league action. Please try again.';
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
  const normalizedConfirmation = useMemo(
    () => deleteConfirmation.trim().toUpperCase(),
    [deleteConfirmation],
  );

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
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
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
      setDeleteSuccess(true);
    },
  });

  function handleClose() {
    if (inactivateMutation.isPending || deleteMutation.isPending) {
      return;
    }

    setActiveTab(MANAGE_TAB_LIFECYCLE);
    setDeleteConfirmation('');
    setDeleteSuccess(false);
    inactivateMutation.reset();
    deleteMutation.reset();
    onClose();
  }

  if (!isOpen || !league) {
    return null;
  }

  const isInactive = league.isActive === false;
  const canDelete = isInactive && normalizedConfirmation === league.leagueCode;

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
                disabled={inactivateMutation.isPending || deleteMutation.isPending}
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
                  <div className="text-sm text-muted-foreground">Role: {roleLabel(league.role)}</div>
                  <div className="text-sm text-muted-foreground">
                    Status: {isInactive ? 'Inactive' : 'Active'}
                  </div>
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
                      This tab is scaffolded for the next slice. It will host league name,
                      description, and other commissioner-editable identity fields.
                    </p>
                  </div>
                  <dl className="grid gap-4 rounded-[1.5rem] border border-border bg-card p-5 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Name
                      </dt>
                      <dd className="mt-1 text-base font-medium">{league.name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        League code
                      </dt>
                      <dd className="mt-1 font-mono text-base font-medium">{league.leagueCode}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        Description
                      </dt>
                      <dd className="mt-1 text-sm text-muted-foreground">
                        {league.description?.trim() || 'No description yet.'}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}

              {activeTab === MANAGE_TAB_ICON ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold">League icon</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Icon upload and visual league identity are planned next. This tab is being
                      scaffolded now so the commissioner management surface stays consistent.
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
                    Future icon tools will live here.
                  </div>
                </div>
              ) : null}

              {activeTab === MANAGE_TAB_SETTINGS ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-semibold">League settings</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Broader settings management is a follow-on slice. This tab reserves the
                      commissioner-owned home for future settings without mixing them into lifecycle
                      actions.
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
                    Future settings controls will live here.
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
                        {extractErrorMessage(inactivateMutation.error)}
                      </p>
                    ) : null}

                    {isInactive ? (
                      <p
                        className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                        data-testid="manage-league-inactive-state"
                      >
                        This league is inactive. Delete is now available as a separate, irreversible
                        action.
                      </p>
                    ) : null}
                  </section>

                  <section className="rounded-[1.5rem] border border-red-300 bg-red-50/80 p-5">
                    {deleteSuccess ? (
                      <div className="space-y-4" data-testid="manage-league-delete-success">
                        <h4 className="text-lg font-semibold text-red-950">Your league was deleted.</h4>
                        <p className="text-sm text-red-900">
                          The league and its related data were removed. You can now return to your
                          home context.
                        </p>
                        <button
                          className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-medium text-white"
                          onClick={onDeleted}
                          type="button"
                        >
                          Exit
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <h4 className="text-lg font-semibold text-red-950">Delete league</h4>
                          <p className="text-sm text-red-900">
                            This action will delete this league and all related data. This action
                            is irreversible. Are you sure you want to proceed?
                          </p>
                        </div>

                        <div className="rounded-[1.25rem] border border-red-200 bg-white/80 p-4">
                          <p className="text-sm text-red-900">
                            Are you sure you want to proceed? This action is irreversible. Please
                            enter <span className="font-mono font-semibold">{league.leagueCode}</span>{' '}
                            to continue.
                          </p>
                          <label className="mt-4 block space-y-2">
                            <span className="text-sm font-medium text-red-950">Confirmation code</span>
                            <input
                              className="w-full rounded-2xl border border-red-200 bg-white px-4 py-3 font-mono text-sm uppercase outline-none transition focus:border-red-500"
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
                            className="rounded-2xl bg-red-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300"
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
                            <span className="text-sm text-red-900">
                              Delete is unavailable until the league is inactive.
                            </span>
                          ) : null}
                        </div>

                        {deleteMutation.isError ? (
                          <p className="text-sm text-destructive">
                            {extractErrorMessage(deleteMutation.error)}
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

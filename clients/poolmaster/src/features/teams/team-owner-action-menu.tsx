import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { changeMemberRole, removeSquadOwner } from '@/lib/api';
import { buildLeagueTeamHomePath } from '@/features/leagues/league-routing';
import { QueryKeys } from '@/lib/query-keys';

type OwnerRole = 'COMMISSIONER' | 'MEMBER' | undefined;
type ActiveAction = 'promote' | 'demote' | 'remove' | null;

function extractOwnerActionError(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') {
    return fallback;
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

  return fallback;
}

function OwnerActionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={`${testId}-description`}
          className="fixed left-1/2 top-1/2 z-50 w-[min(96vw,36rem)] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
          data-testid={testId}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </Dialog.Title>
              <Dialog.Description
                className="mt-2 text-sm text-muted-foreground"
                id={`${testId}-description`}
              >
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label={`Close ${title}`}
                className="rounded-full border border-border p-2 text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                type="button"
              >
                ×
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function TeamOwnerActionMenu({
  activeOwnerCount,
  canManageLeagueRole,
  canRemoveOwner,
  leagueCode,
  leagueId,
  ownerName,
  ownerRole,
  ownerUserId,
  surface,
  teamId,
}: {
  activeOwnerCount: number;
  canManageLeagueRole: boolean;
  canRemoveOwner: boolean;
  leagueCode: string;
  leagueId: string;
  ownerName: string;
  ownerRole: OwnerRole;
  ownerUserId: string;
  surface: 'teams' | 'team-home';
  teamId: string;
}) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);

  const canPromote = canManageLeagueRole && ownerRole === 'MEMBER';
  const canDemote = canManageLeagueRole && ownerRole === 'COMMISSIONER';
  const canOpenMenu = canPromote || canDemote || canRemoveOwner;
  const removeRequiresInactivation = activeOwnerCount <= 1;
  const testPrefix = `${surface}-owner-actions`;

  const invalidateOwnerViews = async () => {
    await queryClient.invalidateQueries({ queryKey: QueryKeys.leagues.members(leagueId) });
    await queryClient.invalidateQueries({ queryKey: QueryKeys.leagueTeams.byLeague(leagueId) });
    await queryClient.invalidateQueries({
      queryKey: QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
    });
  };

  const changeRoleMutation = useMutation({
    mutationFn: async (nextRole: 'COMMISSIONER' | 'MEMBER') => {
      const response = await changeMemberRole({
        path: { id: leagueId, uid: ownerUserId },
        body: { role: nextRole },
      });

      if (!response.data?.membership) {
        throw response.error ?? new Error('League member role response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: async () => {
      setActiveAction(null);
      setMenuOpen(false);
      await invalidateOwnerViews();
    },
  });

  const removeOwnerMutation = useMutation({
    mutationFn: async () => {
      const response = await removeSquadOwner({
        path: { id: leagueId, squadId: teamId, userId: ownerUserId },
      });

      if (!response.data?.membership) {
        throw response.error ?? new Error('Remove owner response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: async () => {
      setActiveAction(null);
      setMenuOpen(false);
      await invalidateOwnerViews();
    },
  });

  if (!canOpenMenu) {
    return null;
  }

  const roleError = changeRoleMutation.error
    ? extractOwnerActionError(changeRoleMutation.error, 'We could not update that league role.')
    : null;
  const removeError = removeOwnerMutation.error
    ? extractOwnerActionError(removeOwnerMutation.error, 'We could not remove that owner right now.')
    : null;
  const teamHomePath = buildLeagueTeamHomePath(leagueCode, teamId);
  const actionIsPending = changeRoleMutation.isPending || removeOwnerMutation.isPending;

  return (
    <>
      <div className="relative">
        <button
          className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted/40"
          data-testid={`${testPrefix}-trigger-${teamId}-${ownerUserId}`}
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          Owner actions
        </button>
        {menuOpen ? (
          <div
            className="absolute right-0 top-full z-20 mt-2 min-w-[14rem] rounded-[1.25rem] border border-border bg-card p-2 shadow-xl"
            data-testid={`${testPrefix}-menu-${teamId}-${ownerUserId}`}
          >
            {canPromote ? (
              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-muted/40"
                data-testid={`${testPrefix}-promote-${teamId}-${ownerUserId}`}
                onClick={() => {
                  setActiveAction('promote');
                  setMenuOpen(false);
                }}
                type="button"
              >
                Promote to commissioner
              </button>
            ) : null}
            {canDemote ? (
              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-muted/40"
                data-testid={`${testPrefix}-demote-${teamId}-${ownerUserId}`}
                onClick={() => {
                  setActiveAction('demote');
                  setMenuOpen(false);
                }}
                type="button"
              >
                Demote to member
              </button>
            ) : null}
            {canRemoveOwner ? (
              <button
                className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-muted/40"
                data-testid={`${testPrefix}-remove-${teamId}-${ownerUserId}`}
                onClick={() => {
                  setActiveAction('remove');
                  setMenuOpen(false);
                }}
                type="button"
              >
                Remove owner
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <OwnerActionDialog
        description={
          activeAction === 'promote'
            ? `${ownerName} will gain commissioner authority for this league.`
            : activeAction === 'demote'
              ? `${ownerName} will lose commissioner authority and return to member status in this league.`
              : `${ownerName} will lose owner access on this team.`
        }
        onOpenChange={(open) => {
          if (!open) {
            setActiveAction(null);
            changeRoleMutation.reset();
            removeOwnerMutation.reset();
          }
        }}
        open={activeAction !== null}
        testId={`${testPrefix}-dialog-${teamId}-${ownerUserId}`}
        title={
          activeAction === 'promote'
            ? 'Promote to commissioner'
            : activeAction === 'demote'
              ? 'Demote to member'
              : 'Remove owner'
        }
      >
        {activeAction === 'promote' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This change is league-scoped and does not alter the user&apos;s account-level permissions.
            </p>
            {roleError ? <p className="text-sm text-destructive">{roleError}</p> : null}
            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid={`${testPrefix}-confirm-promote-${teamId}-${ownerUserId}`}
              disabled={actionIsPending}
              onClick={() => void changeRoleMutation.mutateAsync('COMMISSIONER')}
              type="button"
            >
              {changeRoleMutation.isPending ? 'Promoting...' : 'Promote'}
            </button>
          </div>
        ) : null}

        {activeAction === 'demote' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The backend still enforces the last-commissioner rule if this is the only active commissioner.
            </p>
            {roleError ? <p className="text-sm text-destructive">{roleError}</p> : null}
            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid={`${testPrefix}-confirm-demote-${teamId}-${ownerUserId}`}
              disabled={actionIsPending}
              onClick={() => void changeRoleMutation.mutateAsync('MEMBER')}
              type="button"
            >
              {changeRoleMutation.isPending ? 'Demoting...' : 'Demote'}
            </button>
          </div>
        ) : null}

        {activeAction === 'remove' ? (
          <div className="space-y-4">
            {removeRequiresInactivation ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This team only has one active owner left. Use Team Home to inactivate the team instead of removing the final owner directly.
                </p>
                <Link
                  className="inline-flex rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted/40"
                  to={teamHomePath}
                >
                  Open Team Home
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This removes the owner relationship only. Team history stays intact.
                </p>
                {removeError ? <p className="text-sm text-destructive">{removeError}</p> : null}
                <button
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid={`${testPrefix}-confirm-remove-${teamId}-${ownerUserId}`}
                  disabled={actionIsPending}
                  onClick={() => void removeOwnerMutation.mutateAsync()}
                  type="button"
                >
                  {removeOwnerMutation.isPending ? 'Removing...' : 'Remove owner'}
                </button>
              </>
            )}
          </div>
        ) : null}
      </OwnerActionDialog>
    </>
  );
}

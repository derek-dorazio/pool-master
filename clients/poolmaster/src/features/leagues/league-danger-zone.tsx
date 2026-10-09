import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activateLeague, deleteLeague, inactivateLeague, type LeagueDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import {
  Alert,
  Button,
  ConfirmDialog,
  DangerZone,
  DangerZoneAction,
  FormField,
  Input,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { type LeagueListCache, removeLeague, syncLeagueCaches } from './league-cache';

type ActiveDialog = 'delete' | 'inactivate' | null;

/**
 * The league's lifecycle: inactivate (or activate again) and delete. Delete is open only to an
 * inactive league and asks for the league code typed back.
 */
export function LeagueDangerZone({ league }: { league: LeagueDto }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const isInactive = !league.isActive;

  const inactivateMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await inactivateLeague({ path: { id: league.id } });
      if (!response.data?.league) {
        throwApiError(response.error, 'League inactivation response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      setActiveDialog(null);
    },
    invalidates: [],
  });

  const activateMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await activateLeague({ path: { id: league.id } });
      if (!response.data?.league) {
        throwApiError(response.error, 'League activation response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
    },
    invalidates: [],
  });

  const deleteMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await deleteLeague({
        path: { id: league.id },
        body: { leagueCode: league.leagueCode },
      });
      if (!response.data?.success) {
        throwApiError(response.error, 'League delete response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      setActiveDialog(null);
      queryClient.setQueryData<LeagueListCache>(QueryKeys.leagues.list, (current) =>
        removeLeague(current, league.id),
      );
      navigate(auth.isRootAdmin ? '/manage/leagues' : '/welcome');
    },
    invalidates: [QueryKeys.rootAdmin.manageLeagues],
  });

  const isDeleteConfirmed = deleteConfirmation.trim().toUpperCase() === league.leagueCode;

  function closeDeleteDialog() {
    if (deleteMutation.isPending) {
      return;
    }
    setActiveDialog(null);
    setDeleteConfirmation('');
    deleteMutation.reset();
  }

  return (
    <>
      <DangerZone
        description="Actions that stop or remove the league. Each asks you to confirm."
        testId="league-danger-zone"
      >
        {isInactive ? (
          <DangerZoneAction
            action={(
              <Button
                data-testid="league-activate"
                isLoading={activateMutation.isPending}
                onClick={() => activateMutation.mutate()}
                size="sm"
              >
                {activateMutation.isPending ? 'Activating...' : 'Activate league'}
              </Button>
            )}
            description={(
              <>
                The league is inactive. Activate it to reopen entries and changes.
                {activateMutation.isError ? (
                  <Alert className="mt-2" tone="danger">
                    {extractErrorMessage(activateMutation.error, { fallback: 'We could not activate this league.' })}
                  </Alert>
                ) : null}
              </>
            )}
            title="Activate league"
          />
        ) : (
          <DangerZoneAction
            action={(
              <Button
                data-testid="league-inactivate-open"
                onClick={() => {
                  inactivateMutation.reset();
                  setActiveDialog('inactivate');
                }}
                size="sm"
                variant="danger"
              >
                Inactivate league
              </Button>
            )}
            description="Stops new entries and changes. Members can still see standings and history. You can activate it again later."
            title="Inactivate league"
          />
        )}
        <DangerZoneAction
          action={(
            <Button
              data-testid="league-delete-open"
              disabled={!isInactive}
              onClick={() => setActiveDialog('delete')}
              size="sm"
              variant="danger"
            >
              Delete league
            </Button>
          )}
          description={isInactive
            ? 'Permanently removes the league and all its history.'
            : 'Permanently removes the league and all its history. Inactivate the league first.'}
          title="Delete league"
        />
      </DangerZone>

      <ConfirmDialog
        confirmLabel="Inactivate"
        confirmTestId="league-inactivate"
        description="Inactivating the league stops new entries and changes but keeps its history. The league can be deleted once it is inactive."
        isPending={inactivateMutation.isPending}
        onCancel={() => setActiveDialog(null)}
        onConfirm={() => inactivateMutation.mutate()}
        onOpenChange={(open) => {
          if (!open && !inactivateMutation.isPending) {
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'inactivate'}
        pendingLabel="Inactivating..."
        testId="league-inactivate-modal"
        title="Inactivate league"
        tone="danger"
      >
        {inactivateMutation.isError ? (
          <Alert tone="danger">
            {extractErrorMessage(inactivateMutation.error, { fallback: 'We could not inactivate this league.' })}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        confirmLabel="Delete league"
        confirmTestId="league-delete-submit"
        description="Enter the league code to permanently delete this inactive league."
        isConfirmDisabled={!isDeleteConfirmed}
        isPending={deleteMutation.isPending}
        onCancel={closeDeleteDialog}
        onConfirm={() => deleteMutation.mutate()}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog();
          }
        }}
        open={activeDialog === 'delete'}
        pendingLabel="Deleting..."
        testId="league-delete-modal"
        title="Delete league"
        tone="danger"
      >
        <FormField id="league-delete-confirmation" label="League code">
          <Input
            className="font-mono uppercase"
            data-testid="league-delete-confirmation"
            disabled={deleteMutation.isPending}
            id="league-delete-confirmation"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder={league.leagueCode}
            type="text"
            value={deleteConfirmation}
          />
        </FormField>

        {deleteMutation.isError ? (
          <Alert className="mt-4" tone="danger">
            {extractErrorMessage(deleteMutation.error, { fallback: 'We could not delete this league.' })}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

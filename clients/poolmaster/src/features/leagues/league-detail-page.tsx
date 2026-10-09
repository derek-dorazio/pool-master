import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { activateLeague, deleteLeague, inactivateLeague, leaveLeague, updateLeagueDetails, updateLeagueIcon, type LeagueDto, type SuccessResponse } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import {
  ActionList,
  ActionTile,
  Alert,
  Button,
  ConfirmDialog,
  DefinitionList,
  DetailWithActionsPage,
  formatDateDisplay,
  FormField,
  IconAvatar,
  IconPickerModal,
  Input,
  LinkButton,
  LifecycleActionSet,
  Modal,
  Textarea,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import {
  type LeagueListCache,
  removeLeague,
  syncLeagueCaches,
} from './league-cache';
import { getLeagueIconOption, LEAGUE_ICON_OPTIONS } from './league-icon-catalog';
import { LeagueIcon } from './league-icon';
import { getLeagueLoadErrorCopy } from './league-load-error';
import { LeagueSummaryCard } from './league-summary-card';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { parseRouteState } from '@/routes/route-state';
import { buildLeagueTeamPath } from './league-routing';

type LeaveLeagueResult = SuccessResponse;
type ActiveLeagueDialog = 'details' | 'inactivate' | 'leave' | null;

function formatRole(role: string | null | undefined) {
  if (!role) {
    return 'Not a member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

const LEAGUE_DETAIL_ERROR_CODE_MESSAGES: Record<string, string> = {
  LEAGUE_LAST_COMMISSIONER_REQUIRED:
    'Appoint another commissioner before the last commissioner leaves or steps down.',
};

export function LeagueDetailPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Read once and remembered for this league only, because the effect below drops it from history
  // so Back or a reload does not show the notice again.
  const [teamSetupFailedLeagueCode] = useState(() =>
    parseRouteState(location.state).teamSetupFailed ? leagueCode : null,
  );
  const teamSetupFailed = teamSetupFailedLeagueCode === leagueCode;
  useEffect(() => {
    if (parseRouteState(location.state).teamSetupFailed) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate]);
  const queryClient = useQueryClient();
  const logger = getLogger().child({
    feature: 'league-detail-page',
  });
  const [leaveActionError, setLeaveActionError] = useState<string | null>(null);
  const [detailsName, setDetailsName] = useState('');
  const [detailsDescription, setDetailsDescription] = useState('');
  const [detailsDraftLeagueId, setDetailsDraftLeagueId] = useState<string | null>(null);
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconDraftKey, setIconDraftKey] = useState<LeagueDto['iconKey']>('TROPHY');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [activeDialog, setActiveDialog] = useState<ActiveLeagueDialog>(null);
  const [leaveCompleted, setLeaveCompleted] = useState(false);

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);


  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'leagueDetail.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'League detail page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = league?.id ?? '';
  const detailsDraftSource = useMemo(() => {
    if (!league) {
      return null;
    }

    return {
      description: league.description ?? '',
      id: league.id,
      name: league.name,
    };
    // Keyed on description, id and name on purpose: a refetch must not rebuild the draft
    // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.description, league?.id, league?.name]);

  useEffect(() => {
    if (activeDialog !== 'details' || !detailsDraftSource) {
      return;
    }

    if (detailsDraftLeagueId && detailsDraftLeagueId !== detailsDraftSource.id) {
      setDetailsName(detailsDraftSource.name);
      setDetailsDescription(detailsDraftSource.description);
      setDetailsDraftLeagueId(detailsDraftSource.id);
    }
  }, [activeDialog, detailsDraftLeagueId, detailsDraftSource]);

  // #202 (A8) — from the viewer's own membership in the league context, not from the league.
  const canManageLeague = viewer.isCommissioner || viewer.isRootAdmin;
  const isInactiveLeague = league?.isActive === false;
  const currentLeagueIconKey = league?.iconKey ?? iconDraftKey;
  const selectedLeagueIcon = getLeagueIconOption(currentLeagueIconKey);

  const updateDetailsMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!detailsDraftLeagueId || detailsDraftLeagueId !== leagueId) {
        throw new Error('League selection changed before details could be saved.');
      }

      const response = await updateLeagueDetails({
        path: { id: detailsDraftLeagueId },
        body: {
          name: detailsName.trim(),
          ...(detailsDescription.trim() ? { description: detailsDescription.trim() } : {}),
        },
      });

      if (!response.data?.league) {
        throwApiError(response.error, 'League details update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: (league) => {
      setDetailsName(league.name);
      setDetailsDescription(league.description ?? '');
      syncLeagueCaches(queryClient, league);
    },
    invalidates: [],
  });

  const updateIconMutation = useInvalidatingMutation({
    mutationFn: async (iconKey: LeagueDto['iconKey']) => {
      const response = await updateLeagueIcon({
        path: { id: leagueId },
        body: { iconKey },
      });

      if (!response.data?.league) {
        throwApiError(response.error, 'League icon update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: (league) => {
      setIconDraftKey(league.iconKey);
      setIconModalOpen(false);
      syncLeagueCaches(queryClient, league);
    },
    invalidates: [],
  });

  const inactivateLeagueMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await inactivateLeague({
        path: { id: leagueId },
      });

      if (!response.data?.league) {
        throwApiError(response.error, 'League inactivation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: () => {
      if (league) {
        syncLeagueCaches(
          queryClient,
          {
            ...league,
            isActive: false,
          },
        );
      }
      setActiveDialog((current) => current === 'inactivate' ? null : current);
    },
    invalidates: [],
  });

  const activateLeagueMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await activateLeague({
        path: { id: leagueId },
      });

      if (!response.data?.league) {
        throwApiError(response.error, 'League activation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: (league) => {
      syncLeagueCaches(queryClient, league);
    },
    invalidates: [],
  });

  const deleteLeagueMutation = useInvalidatingMutation({
    mutationFn: async () => {
      if (!league) {
        throw new Error('League detail response is missing data.');
      }

      const response = await deleteLeague({
        path: { id: leagueId },
        body: { leagueCode: league.leagueCode },
      });

      if (!response.data?.success) {
        throwApiError(response.error, 'League delete response is missing data.');
      }

      return response.data;
    },
    onSuccess: () => {
      setDeleteModalOpen(false);
      queryClient.setQueryData<LeagueListCache>(QueryKeys.leagues.list, (current) =>
        removeLeague(current, league?.id ?? ''),
      );
      navigate(auth.isRootAdmin ? '/manage/leagues' : '/welcome');
    },
    invalidates: [QueryKeys.rootAdmin.manageLeagues],
  });

  const leaveLeagueMutation = useInvalidatingMutation({
    mutationFn: async (): Promise<LeaveLeagueResult> => {
      const response = await leaveLeague({
        path: { id: leagueId },
      });

      if (!response.data) {
        throwApiError(response.error, 'Leave league response is missing data.');
      }

      return response.data;
    },
    onSuccess: () => {
      setLeaveActionError(null);
      setLeaveCompleted(true);
      queryClient.setQueryData<LeagueListCache>(QueryKeys.leagues.list, (current) =>
        removeLeague(current, league?.id ?? ''),
      );
    },
    invalidates: [],
    onError: (error) => {
      setLeaveActionError(
        extractErrorMessage(error, { fallback: 'We could not complete that leave request right now.', codeMessages: LEAGUE_DETAIL_ERROR_CODE_MESSAGES }),
      );
    },
  });

  async function handleLeaveLeague() {
    setLeaveActionError(null);
    try {
      await leaveLeagueMutation.mutateAsync();
    } catch {
      // Error state is handled by the mutation onError callback.
    }
  }

  function handleLeaveCompletionAcknowledge() {
    const remainingLeagues = queryClient.getQueryData<LeagueListCache>(QueryKeys.leagues.list)?.leagues ?? [];
    const nextLeague = remainingLeagues.find((league) => league.isActive);

    setActiveDialog(null);
    setLeaveCompleted(false);

    // With no active league left the viewer is still signed in: welcome either lands them on a
    // league they can select or shows the zero-league page
    // (requirements/product-requirements/navigation-and-entry-points.md).
    navigate(nextLeague ? `/league/${nextLeague.leagueCode}` : '/welcome', { replace: true });
  }

  if (leagueQuery.isLoading) {
    return (
      <Tile padding="lg">Loading league detail...</Tile>
    );
  }

  if (leagueQuery.isError || !league) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <Tile padding="lg">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        <LinkButton className="mt-4" to="/welcome" variant="subtle">
          Back to welcome
        </LinkButton>
      </Tile>
    );
  }

  const canEditLeague = canManageLeague && !isInactiveLeague;
  const canDeleteLeague =
    canManageLeague
    && isInactiveLeague
    && deleteConfirmation.trim().toUpperCase() === league.leagueCode;
  const lifecycleStatusLabel = league.isActive ? 'Active' : 'Inactive';

  function handleOpenIconModal() {
    setIconDraftKey(currentLeagueIconKey);
    setIconModalOpen(true);
  }

  function handleOpenDetailsModal() {
    if (!league) {
      return;
    }

    setDetailsName(league.name);
    setDetailsDescription(league.description ?? '');
    setDetailsDraftLeagueId(league.id);
    updateDetailsMutation.reset();
    setActiveDialog('details');
  }

  function handleCloseDetailsModal() {
    if (updateDetailsMutation.isPending) {
      return;
    }

    setActiveDialog(null);
    setDetailsDraftLeagueId(null);
  }

  function handleCloseIconModal() {
    if (updateIconMutation.isPending) {
      return;
    }

    setIconDraftKey(currentLeagueIconKey);
    setIconModalOpen(false);
    updateIconMutation.reset();
  }

  function handleCloseDeleteModal() {
    if (deleteLeagueMutation.isPending) {
      return;
    }

    setDeleteModalOpen(false);
    setDeleteConfirmation('');
    deleteLeagueMutation.reset();
  }

  return (
    <section className="space-y-6" data-testid="league-home">
      {teamSetupFailed ? (
        <Alert data-testid="league-team-setup-failed" tone="warning">
          <p>You&apos;re in the league. We couldn&apos;t save your team name and icon. You can set them from Team Home.</p>
          <LinkButton className="mt-3" to={buildLeagueTeamPath(leagueCode)} variant="subtle">
            Team Home
          </LinkButton>
        </Alert>
      ) : null}
      {isInactiveLeague ? (
        <Alert
          data-testid="league-inactive-banner"
          tone="warning"
          title="This league is not currently active."
        >
          <p>
            League Home stays available in read-only mode while the league is inactive.
            Commissioner edits and invites are disabled while the league is inactive.
          </p>
        </Alert>
      ) : null}

      <LeagueSummaryCard
        activeContestCount={league.activeContestCount}
        description={league.description}
        icon={<LeagueIcon iconKey={league.iconKey} size="lg" />}
        memberCount={league.memberCount}
        name={league.name}
        roleLabel={viewer.isRootAdmin ? 'Root Admin' : formatRole(viewer.membership?.role)}
      />

      <DetailWithActionsPage
        actions={(
          <ActionList>
            {canManageLeague ? (
              <>
                <ActionTile
                  data-testid="league-open-details"
                  label="Change league details"
                  disabled={!canEditLeague}
                  onClick={handleOpenDetailsModal}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="league-change-icon"
                  label="Change league icon"
                  disabled={!canEditLeague}
                  onClick={handleOpenIconModal}
                  trailing="Open"
                />

                <LifecycleActionSet
                  actions={[
                    {
                      key: 'inactivate',
                      label: 'Inactivate league',
                      pending: inactivateLeagueMutation.isPending,
                      pendingLabel: 'Inactivating...',
                      disabled: inactivateLeagueMutation.isPending,
                      onSelect: () => {
                        inactivateLeagueMutation.reset();
                        setActiveDialog('inactivate');
                      },
                      testId: 'league-inactivate-open',
                      trailing: 'Open',
                      visibleForStatuses: ['Active'],
                    },
                    {
                      key: 'activate',
                      label: 'Activate',
                      pending: activateLeagueMutation.isPending,
                      pendingLabel: 'Activating...',
                      disabled: activateLeagueMutation.isPending,
                      onSelect: () => activateLeagueMutation.mutate(),
                      testId: 'league-activate',
                      tone: 'primary',
                      visibleForStatuses: ['Inactive'],
                    },
                    {
                      key: 'delete',
                      label: 'Delete',
                      pending: deleteLeagueMutation.isPending,
                      pendingLabel: 'Deleting...',
                      disabled: deleteLeagueMutation.isPending,
                      onSelect: () => setDeleteModalOpen(true),
                      testId: 'league-delete-open',
                      tone: 'danger',
                      visibleForStatuses: ['Inactive'],
                    },
                  ]}
                  currentStatus={lifecycleStatusLabel}
                  errorMessage={
                    activateLeagueMutation.isError
                      ? extractErrorMessage(activateLeagueMutation.error, { fallback: 'We could not activate this league.', codeMessages: LEAGUE_DETAIL_ERROR_CODE_MESSAGES })
                      : null
                  }
                  helperText={
                    isInactiveLeague ? (
                      <span data-testid="league-lifecycle-helper">
                        The league is currently <span className="font-medium text-destructive">Inactive</span>,
                        click Activate to reactivate your league.
                      </span>
                    ) : null
                  }
                  statusTone={isInactiveLeague ? 'inactive' : 'active'}
                  testId="league-lifecycle-section"
                  title="League lifecycle"
                />
              </>
            ) : null}

            {!viewer.isRootAdmin ? (
              <ActionTile
                data-testid="league-leave-open"
                disabled={isInactiveLeague}
                label="Leave league"
                onClick={() => {
                  setLeaveActionError(null);
                  setLeaveCompleted(false);
                  setActiveDialog('leave');
                }}
                tone="danger"
                trailing="Open"
              />
            ) : null}
          </ActionList>
        )}
        actionsTestId="league-actions-tile"
        details={(
          <Tile data-testid="league-details-tile">
            <h3 className="text-xl font-semibold">League details</h3>
            <DefinitionList
              className="mt-5"
              items={[
                { id: 'league-name', label: 'League name', value: league.name },
                {
                  id: 'status',
                  label: 'Status',
                  value: (
                    <span
                      className={isInactiveLeague ? 'text-destructive' : undefined}
                      data-testid="league-lifecycle-status"
                    >
                      {lifecycleStatusLabel}
                    </span>
                  ),
                },
                {
                  id: 'league-code',
                  label: 'League code',
                  value: <span className="font-mono">{league.leagueCode}</span>,
                },
                {
                  id: 'created',
                  label: 'Created',
                  value: formatDateDisplay(league.createdAt, 'Unknown'),
                },
                {
                  id: 'league-icon',
                  label: 'League icon',
                  value: (
                    <span className="flex items-center gap-3">
                      <span data-testid="league-current-icon">
                        <IconAvatar size="md">
                          <LeagueIcon iconKey={currentLeagueIconKey} size="lg" />
                        </IconAvatar>
                      </span>
                      <span data-testid="league-current-icon-label">{selectedLeagueIcon.label}</span>
                    </span>
                  ),
                },
                {
                  id: 'description',
                  label: 'Description',
                  value: league.description?.trim() || 'No description',
                },
              ]}
            />
          </Tile>
        )}
      />

      <Modal
        description="Update the public name and description shown for this league."
        descriptionId="league-details-modal-description"
        onOpenChange={(open) => {
          if (open) {
            handleOpenDetailsModal();
            return;
          }

          if (!updateDetailsMutation.isPending) {
            handleCloseDetailsModal();
          }
        }}
        open={activeDialog === 'details'}
        testId="league-details-modal"
        title="Change league details"
      >
        <div className="space-y-4">
          <FormField label="League name">
            <Input
              data-testid="league-details-name"
              disabled={!canEditLeague}
              onChange={(event) => setDetailsName(event.target.value)}
              type="text"
              value={detailsName}
            />
          </FormField>
          <FormField label="Description">
            <Textarea
              data-testid="league-details-description"
              disabled={!canEditLeague}
              onChange={(event) => setDetailsDescription(event.target.value)}
              value={detailsDescription}
            />
          </FormField>
        </div>

        {updateDetailsMutation.isError ? (
          <Alert className="mt-4" tone="danger">
            {extractErrorMessage(updateDetailsMutation.error, { fallback: 'We could not save league details.', codeMessages: LEAGUE_DETAIL_ERROR_CODE_MESSAGES })}
          </Alert>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button
            disabled={updateDetailsMutation.isPending}
            onClick={handleCloseDetailsModal}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            data-testid="league-save-details"
            disabled={
              !canEditLeague
              || !detailsName.trim()
              || updateDetailsMutation.isPending
              || detailsDraftLeagueId !== leagueId
            }
            isLoading={updateDetailsMutation.isPending}
            onClick={() => updateDetailsMutation.mutate(undefined, { onSuccess: handleCloseDetailsModal })}
          >
            {updateDetailsMutation.isPending ? 'Saving...' : 'Save details'}
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        confirmLabel="Inactivate"
        confirmTestId="league-inactivate"
        description={(
          <>
            The league is currently <span className="font-medium text-foreground">Active</span>,
            inactivating the league will prevent further usage but will maintain history.
            The league can be deleted after being made inactive.
          </>
        )}
        isPending={inactivateLeagueMutation.isPending}
        onCancel={() => setActiveDialog(null)}
        onConfirm={() => inactivateLeagueMutation.mutate()}
        onOpenChange={(open) => {
          if (open) {
            inactivateLeagueMutation.reset();
            setActiveDialog('inactivate');
            return;
          }

          if (!inactivateLeagueMutation.isPending) {
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'inactivate'}
        pendingLabel="Inactivating..."
        testId="league-inactivate-modal"
        title="Inactivate league"
      >
        {inactivateLeagueMutation.isError ? (
          <Alert tone="danger">
            {extractErrorMessage(inactivateLeagueMutation.error, { fallback: 'We could not inactivate this league.', codeMessages: LEAGUE_DETAIL_ERROR_CODE_MESSAGES })}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <Modal
        description="Leaving removes your membership from the active roster. If you are the last commissioner, appoint another commissioner before leaving."
        descriptionId="league-leave-modal-description"
        onOpenChange={(open) => {
          if (!open && !leaveLeagueMutation.isPending) {
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'leave'}
        testId="league-leave-modal"
        title="Leave league"
      >
        {leaveCompleted ? (
          <>
            <Alert className="mt-5" tone="success">
              You left {league.name}.
            </Alert>
            <div className="mt-6 flex justify-end">
              <Button
                data-testid="league-leave-ok"
                onClick={handleLeaveCompletionAcknowledge}
              >
                OK
              </Button>
            </div>
          </>
        ) : (
          <>
            {leaveActionError ? (
              <Alert className="mt-4" data-testid="league-leave-error" tone="danger">
                {leaveActionError}
              </Alert>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                disabled={leaveLeagueMutation.isPending}
                onClick={() => setActiveDialog(null)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                data-testid="league-leave"
                disabled={leaveLeagueMutation.isPending || isInactiveLeague}
                onClick={() => void handleLeaveLeague()}
                variant="danger"
              >
                {leaveLeagueMutation.isPending ? 'Leaving...' : 'Leave league'}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        confirmLabel="Delete league"
        confirmTestId="league-delete-submit"
        description="Enter the league code to permanently delete this inactive league."
        isConfirmDisabled={!canDeleteLeague}
        isPending={deleteLeagueMutation.isPending}
        onCancel={handleCloseDeleteModal}
        onConfirm={() => deleteLeagueMutation.mutate()}
        onOpenChange={(open) => {
          if (open) {
            setDeleteModalOpen(true);
            return;
          }

          handleCloseDeleteModal();
        }}
        open={deleteModalOpen}
        pendingLabel="Deleting..."
        testId="league-delete-modal"
        title="Delete league"
        tone="danger"
      >
        <FormField label="League code">
          <Input
            className="font-mono uppercase"
            data-testid="league-delete-confirmation"
            disabled={deleteLeagueMutation.isPending}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder={league.leagueCode}
            type="text"
            value={deleteConfirmation}
          />
        </FormField>

        {deleteLeagueMutation.isError ? (
          <Alert className="mt-4" tone="danger">
            {extractErrorMessage(deleteLeagueMutation.error, { fallback: 'We could not delete this league.', codeMessages: LEAGUE_DETAIL_ERROR_CODE_MESSAGES })}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <IconPickerModal
        canSave={canEditLeague}
        canSelect={canEditLeague}
        closeLabel="Close league icon modal"
        description="Choose an icon for your league."
        descriptionId="league-icon-modal-description"
        errorMessage={
          updateIconMutation.isError
            ? extractErrorMessage(updateIconMutation.error, { fallback: 'We could not save the league icon.', codeMessages: LEAGUE_DETAIL_ERROR_CODE_MESSAGES })
            : null
        }
        isPending={updateIconMutation.isPending}
        modalTestId="league-icon-modal"
        onCancel={handleCloseIconModal}
        onOpenChange={(open) => {
          if (open) {
            handleOpenIconModal();
            return;
          }

          handleCloseIconModal();
        }}
        onSave={() => updateIconMutation.mutate(iconDraftKey)}
        onSelect={setIconDraftKey}
        open={iconModalOpen}
        optionTestIdPrefix="league-icon"
        options={LEAGUE_ICON_OPTIONS}
        paletteTestId="league-icon-palette"
        renderOptionIcon={(icon) => (
          <div className="flex justify-center text-primary">
            <LeagueIcon iconKey={icon.key} size="md" />
          </div>
        )}
        renderSelectedIcon={() => (
          <IconAvatar size="lg">
            <LeagueIcon iconKey={iconDraftKey} size="lg" />
          </IconAvatar>
        )}
        saveTestId="league-save-icon"
        selectedLabel={getLeagueIconOption(iconDraftKey).label}
        title="Change league icon"
        value={iconDraftKey}
      />
    </section>
  );
}

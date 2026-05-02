import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  activateLeague,
  deleteLeague,
  generateInviteLink,
  getLeagueByCode,
  inactivateLeague,
  leaveLeague,
  sendLeagueInvitations,
  updateLeagueDetails,
  updateLeagueIcon,
  type GetLeagueResponses,
  type LeaveLeagueResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  ActionList,
  ActionModal,
  ActionTile,
  Alert,
  Button,
  ConfirmDialog,
  DefinitionList,
  DetailWithActionsPage,
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
import { extractErrorMessage as extractSharedErrorMessage } from '@/lib/errors';
import { useLogger } from '@/lib/logger';
import { removeLeagueSummary, syncLeagueCaches, type LeagueSummary } from './league-cache';
import { getLeagueIconOption, LEAGUE_ICON_OPTIONS } from './league-icon-catalog';
import { LeagueIcon } from './league-icon';
import { getLeagueLoadErrorCopy } from './league-load-error';
import { LeagueSummaryCard } from './league-summary-card';
import { buildInvitePath, setRecentLeagueCode } from './league-routing';

type LeagueDetail = GetLeagueResponses[200]['league'];
type LeaveLeagueResponse = LeaveLeagueResponses[200];
type ActiveLeagueDialog = 'details' | 'inactivate' | 'invite' | 'leave' | null;

function formatRole(role: string | null | undefined) {
  if (!role) {
    return 'Not a member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractErrorMessage(error: unknown, fallback: string) {
  return extractSharedErrorMessage(error, {
    fallback,
    codeMessages: {
      LEAGUE_LAST_COMMISSIONER_REQUIRED:
        'Appoint another commissioner before the last commissioner leaves or steps down.',
    },
  });
}

export function LeagueDetailPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logger = useLogger().child({
    feature: 'league-detail-page',
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [leaveActionError, setLeaveActionError] = useState<string | null>(null);
  const [detailsName, setDetailsName] = useState('');
  const [detailsDescription, setDetailsDescription] = useState('');
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconDraftKey, setIconDraftKey] = useState<LeagueDetail['iconKey']>('TROPHY');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [activeDialog, setActiveDialog] = useState<ActiveLeagueDialog>(null);
  const [leaveCompleted, setLeaveCompleted] = useState(false);

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'league', leagueCode],
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
      }

      return response.data.league;
    },
    enabled: Boolean(leagueCode),
    retry: false,
  });

  useEffect(() => {
    if (leagueQuery.data?.leagueCode) {
      setRecentLeagueCode(leagueQuery.data.leagueCode);
    }
  }, [leagueQuery.data?.leagueCode]);

  useEffect(() => {
    if (!leagueQuery.data) {
      return;
    }

    setDetailsName(leagueQuery.data.name);
    setDetailsDescription(leagueQuery.data.description ?? '');
  }, [leagueQuery.data]);

  useEffect(() => {
    if (!leagueQuery.data || iconModalOpen) {
      return;
    }

    setIconDraftKey(leagueQuery.data.iconKey);
  }, [iconModalOpen, leagueQuery.data]);

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

  const leagueId = leagueQuery.data?.id ?? '';

  const canManageLeague =
    leagueQuery.data?.leagueRelationship.commissioner === true || leagueQuery.data?.isRootAdmin === true;
  const isInactiveLeague = leagueQuery.data?.isActive === false;
  const currentLeagueIconKey = leagueQuery.data?.iconKey ?? iconDraftKey;
  const selectedLeagueIcon = getLeagueIconOption(currentLeagueIconKey);

  const inviteLinkMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const response = await generateInviteLink({
        path: { id: leagueId },
        body: {},
      });

      const inviteCode = response.data?.invitation?.inviteCode;
      if (!inviteCode) {
        throw response.error ?? new Error('Invite link generation did not return an invite code.');
      }

      return `${window.location.origin}${buildInvitePath(inviteCode)}`;
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await sendLeagueInvitations({
        path: { id: leagueId },
        body: {
          emails: [email],
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Invitation send response is missing data.');
      }

      return response.data;
    },
  });

  const updateDetailsMutation = useMutation({
    mutationFn: async () => {
      const response = await updateLeagueDetails({
        path: { id: leagueId },
        body: {
          name: detailsName.trim(),
          ...(detailsDescription.trim() ? { description: detailsDescription.trim() } : {}),
        },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League details update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (league) => {
      setDetailsName(league.name);
      setDetailsDescription(league.description ?? '');
      syncLeagueCaches(queryClient, league);
    },
  });

  const updateIconMutation = useMutation({
    mutationFn: async (iconKey: LeagueDetail['iconKey']) => {
      const response = await updateLeagueIcon({
        path: { id: leagueId },
        body: { iconKey },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League icon update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (league) => {
      setIconDraftKey(league.iconKey);
      setIconModalOpen(false);
      syncLeagueCaches(queryClient, league);
    },
  });

  const inactivateLeagueMutation = useMutation({
    mutationFn: async () => {
      const response = await inactivateLeague({
        path: { id: leagueId },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League inactivation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async () => {
      if (leagueQuery.data) {
        syncLeagueCaches(
          queryClient,
          {
            ...leagueQuery.data,
            isActive: false,
          },
        );
      }
      setActiveDialog((current) => current === 'inactivate' ? null : current);
    },
  });

  const activateLeagueMutation = useMutation({
    mutationFn: async () => {
      const response = await activateLeague({
        path: { id: leagueId },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League activation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (league) => {
      syncLeagueCaches(queryClient, league);
    },
  });

  const deleteLeagueMutation = useMutation({
    mutationFn: async () => {
      if (!leagueQuery.data) {
        throw new Error('League detail response is missing data.');
      }

      const response = await deleteLeague({
        path: { id: leagueId },
        body: { leagueCode: leagueQuery.data.leagueCode },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('League delete response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      setDeleteModalOpen(false);
      queryClient.setQueryData(['poolmaster', 'leagues'], (current: LeagueSummary[] | undefined) =>
        removeLeagueSummary(current, leagueQuery.data?.id ?? ''),
      );
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'manage-leagues'] });
      void navigate(auth.isRootAdmin ? '/manage/leagues' : '/welcome');
    },
  });

  const leaveLeagueMutation = useMutation({
    mutationFn: async (): Promise<LeaveLeagueResponse> => {
      const response = await leaveLeague({
        path: { id: leagueId },
      });

      if (!response.data) {
        throw response.error ?? new Error('Leave league response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      setLeaveActionError(null);
      setLeaveCompleted(true);
      queryClient.setQueryData(['poolmaster', 'leagues'], (current: LeagueSummary[] | undefined) =>
        removeLeagueSummary(current, leagueQuery.data?.id ?? ''),
      );
    },
    onError: (error) => {
      setLeaveActionError(
        extractErrorMessage(error, 'We could not complete that leave request right now.'),
      );
    },
  });

  async function handleGenerateInviteLink() {
    if (isInactiveLeague) {
      return;
    }

    const nextLink = await inviteLinkMutation.mutateAsync();
    setInviteLink(nextLink);
    setInviteLinkCopied(false);
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteLinkCopied(true);
    } catch {
      // Keep the link visible for manual copy when clipboard access is unavailable.
    }
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim();
    if (!email || isInactiveLeague) {
      return;
    }

    await sendInviteMutation.mutateAsync(email);
    setInviteEmail('');
  }

  async function handleLeaveLeague() {
    setLeaveActionError(null);
    try {
      await leaveLeagueMutation.mutateAsync();
    } catch {
      // Error state is handled by the mutation onError callback.
    }
  }

  async function handleLeaveCompletionAcknowledge() {
    const remainingLeagues = queryClient.getQueryData<LeagueSummary[]>(['poolmaster', 'leagues']) ?? [];
    const nextLeague = remainingLeagues.find((league) => league.isActive) ?? remainingLeagues[0];

    setActiveDialog(null);
    setLeaveCompleted(false);

    if (nextLeague) {
      navigate(`/league/${nextLeague.leagueCode}`, { replace: true });
      return;
    }

    await auth.clearSession();
    navigate('/', { replace: true });
  }

  if (leagueQuery.isLoading) {
    return (
      <Tile padding="lg">Loading league detail...</Tile>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
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
    && deleteConfirmation.trim().toUpperCase() === leagueQuery.data.leagueCode;
  const lifecycleStatusLabel = leagueQuery.data.isActive ? 'Active' : 'Inactive';

  function handleOpenIconModal() {
    setIconDraftKey(currentLeagueIconKey);
    setIconModalOpen(true);
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
        activeContestCount={leagueQuery.data.activeContestCount}
        description={leagueQuery.data.description}
        icon={<LeagueIcon iconKey={leagueQuery.data.iconKey} size="lg" />}
        memberCount={leagueQuery.data.memberCount}
        name={leagueQuery.data.name}
        roleLabel={leagueQuery.data.isRootAdmin ? 'Root Admin' : formatRole(leagueQuery.data.memberType)}
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
                  onClick={() => setActiveDialog('details')}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="league-change-icon"
                  label="Change league icon"
                  disabled={!canEditLeague}
                  onClick={handleOpenIconModal}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="league-open-invite-members"
                  label="Invite members"
                  disabled={isInactiveLeague}
                  onClick={() => setActiveDialog('invite')}
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
                      onSelect: () => void activateLeagueMutation.mutateAsync(),
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
                      ? extractErrorMessage(activateLeagueMutation.error, 'We could not activate this league.')
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

            {!leagueQuery.data.isRootAdmin ? (
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
                { label: 'League name', value: leagueQuery.data.name },
                {
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
                  label: 'League code',
                  value: <span className="font-mono">{leagueQuery.data.leagueCode}</span>,
                },
                {
                  label: 'Join policy',
                  value: <span data-testid="league-join-policy">{leagueQuery.data.joinPolicy}</span>,
                },
                {
                  label: 'Created',
                  value: leagueQuery.data.createdAt
                    ? new Date(leagueQuery.data.createdAt).toLocaleDateString()
                    : 'Unknown',
                },
                {
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
                  label: 'Description',
                  value: leagueQuery.data.description?.trim() || 'No description',
                },
              ]}
            />
          </Tile>
        )}
      />

      <Modal
        description="Update the public name and description shown for this league."
        descriptionId="league-details-modal-description"
        onOpenChange={(open) => setActiveDialog(open ? 'details' : null)}
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
            {extractErrorMessage(updateDetailsMutation.error, 'We could not save league details.')}
          </Alert>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button
            disabled={updateDetailsMutation.isPending}
            onClick={() => setActiveDialog(null)}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            data-testid="league-save-details"
            disabled={!canEditLeague || !detailsName.trim() || updateDetailsMutation.isPending}
            isLoading={updateDetailsMutation.isPending}
            onClick={() => void updateDetailsMutation.mutateAsync().then(() => setActiveDialog(null))}
          >
            {updateDetailsMutation.isPending ? 'Saving...' : 'Save details'}
          </Button>
        </div>
      </Modal>

      <ActionModal
        description={`Invite new members to join the ${leagueQuery.data.name} league.`}
        footer={(
          <Button onClick={() => setActiveDialog(null)} variant="secondary">
            Close
          </Button>
        )}
        onCancel={() => setActiveDialog(null)}
        onOpenChange={(open) => setActiveDialog(open ? 'invite' : null)}
        open={activeDialog === 'invite'}
        testId="league-invitations-section"
        title="Invite Members"
      >
        <DefinitionList
          className="sm:grid-cols-1"
          items={[{ label: 'Join policy', value: leagueQuery.data.joinPolicy }]}
        />

        <FormField className="mt-5" label="Join URL">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              className="min-w-0 flex-1 font-mono"
              data-testid="league-join-url"
              disabled={isInactiveLeague}
              placeholder="Create a join URL"
              readOnly
              value={inviteLink}
            />
            <div className="flex gap-2">
              <Button
                data-testid="league-create-join-url"
                disabled={inviteLinkMutation.isPending || isInactiveLeague}
                onClick={() => void handleGenerateInviteLink()}
                variant="secondary"
              >
                {inviteLinkMutation.isPending ? 'Creating...' : inviteLink ? 'Refresh URL' : 'Create URL'}
              </Button>
              <Button
                aria-label="Copy join URL"
                data-testid="league-copy-join-url"
                disabled={!inviteLink || isInactiveLeague}
                onClick={() => void handleCopyInviteLink()}
                size="icon"
                title="Copy join URL"
                variant="icon"
              >
                {inviteLinkCopied ? <Check aria-hidden size={18} /> : <Copy aria-hidden size={18} />}
              </Button>
            </div>
          </div>
        </FormField>

        {inviteLinkMutation.isError ? (
          <Alert className="mt-3" tone="danger">
            {extractErrorMessage(inviteLinkMutation.error, 'We could not create a join URL.')}
          </Alert>
        ) : null}

        <FormField className="mt-5" label="Invite by email">
          <div className="flex gap-3">
            <Input
              data-testid="league-invite-email"
              disabled={isInactiveLeague}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="member@example.com"
              type="email"
              value={inviteEmail}
            />
            <Button
              data-testid="league-send-invite"
              disabled={sendInviteMutation.isPending || !inviteEmail.trim() || isInactiveLeague}
              onClick={() => void handleSendInvite()}
            >
              {sendInviteMutation.isPending ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </FormField>

        {sendInviteMutation.isError ? (
          <Alert className="mt-3" tone="danger">
            {extractErrorMessage(sendInviteMutation.error, 'We could not send that invitation.')}
          </Alert>
        ) : null}

      </ActionModal>

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
        onConfirm={() => void inactivateLeagueMutation.mutateAsync()}
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
            {extractErrorMessage(inactivateLeagueMutation.error, 'We could not inactivate this league.')}
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
              You left {leagueQuery.data.name}.
            </Alert>
            <div className="mt-6 flex justify-end">
              <Button
                data-testid="league-leave-ok"
                onClick={() => void handleLeaveCompletionAcknowledge()}
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
        onConfirm={() => void deleteLeagueMutation.mutateAsync()}
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
            placeholder={leagueQuery.data.leagueCode}
            type="text"
            value={deleteConfirmation}
          />
        </FormField>

        {deleteLeagueMutation.isError ? (
          <Alert className="mt-4" tone="danger">
            {extractErrorMessage(deleteLeagueMutation.error, 'We could not delete this league.')}
          </Alert>
        ) : null}
      </ConfirmDialog>

      <IconPickerModal
        canSave={canEditLeague}
        canSelect={canEditLeague}
        closeLabel="Close league icon modal"
        description="Pick a built-in icon and save it without leaving League Home."
        descriptionId="league-icon-modal-description"
        errorMessage={
          updateIconMutation.isError
            ? extractErrorMessage(updateIconMutation.error, 'We could not save the league icon.')
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
        onSave={() => void updateIconMutation.mutateAsync(iconDraftKey)}
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

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { InvitationStatus, InviteType } from '@poolmaster/shared/domain';
import { Check, Copy } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import {
  generateInviteLink,
  listLeagueInvitations,
  resendLeagueInvitation,
  revokeInviteLink,
  sendLeagueInvitations,
  type LeagueInvitationDto,
  type LeagueMembershipDto,
  type SendLeagueInvitationsResponse,
} from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { buildInvitePath } from '@/features/leagues/league-routing';
import {
  Alert,
  Button,
  DataGrid,
  DateDisplay,
  FormField,
  Input,
  SegmentedControl,
  SettingsSection,
  SettingsSectionHeader,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

/**
 * League invitations, on Commissioner tools › Invites: "Invite people" (by email, or the join link)
 * and the invites still waiting on an answer. Commissioner only, like the endpoints behind it.
 *
 * An invite is pending until it is accepted or cancelled. An email invite past its expiry is still
 * listed, under Expired, so the commissioner can resend it; a resend issues a new link and the old
 * one stops working. A join link can only be cancelled.
 *
 * Every row can copy its own link (#476). With the invite email switched off, a resend sends
 * nothing, so copying the new link is how the commissioner gets it to the invitee.
 */
type LeagueInvitationsProps = {
  isInactiveLeague: boolean;
  leagueId: string;
  membersByUserId: Map<string, LeagueMembershipDto>;
};

const INVITES_PER_PAGE = 25;

type InviteFilter = 'pending' | 'expired';

function isInviteFilter(value: string): value is InviteFilter {
  return value === 'pending' || value === 'expired';
}

type InviteRow = {
  invitation: LeagueInvitationDto;
  isEmail: boolean;
  isExpired: boolean;
  label: string;
  link: string;
  sentBy: string;
};

type RowCopy = { invitationId: string; state: 'copied' | 'failed' };

function buildInviteUrl(inviteCode: string): string {
  return `${window.location.origin}${buildInvitePath(inviteCode)}`;
}

function isExpiredInvitation(invitation: LeagueInvitationDto): boolean {
  return invitation.status === InvitationStatus.EXPIRED
    || (invitation.expiresAt ? new Date(invitation.expiresAt).getTime() < Date.now() : false);
}

/**
 * What happened to the one email the commissioner sent. The server skips an address that already
 * belongs to the league or already has a pending invitation, and says so; without this the field
 * just cleared and read as "sent".
 */
function describeInviteResult(result: SendLeagueInvitationsResponse): string | null {
  const [sent] = result.sent;
  if (sent) {
    return `Invitation sent to ${sent.email}.`;
  }
  const [member] = result.skippedMembers;
  if (member) {
    return `${member} is already a member of this league.`;
  }
  const [duplicate] = result.skippedDuplicates;
  if (duplicate) {
    return `${duplicate} already has a pending invitation.`;
  }
  return null;
}

function joinedCount(count: number): string {
  return count === 1 ? '1 person has used it' : `${String(count)} people have used it`;
}

export function LeagueInvitations({ isInactiveLeague, leagueId, membersByUserId }: LeagueInvitationsProps) {
  const invitationsKey = QueryKeys.leagueInvitations.byLeague(leagueId);

  const invitationsQuery = useQuery({
    queryKey: invitationsKey,
    queryFn: async (): Promise<LeagueInvitationDto[]> => {
      const response = await listLeagueInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throwApiError(response.error, 'League invitation list response is missing data.');
      }
      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const invitations = invitationsQuery.data;

  // The join link is the newest one still usable; older ones keep working until cancelled below.
  const joinLink = useMemo(
    () => (invitations ?? [])
      .filter((invitation) => invitation.inviteType === InviteType.LINK && !isExpiredInvitation(invitation))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .at(0),
    [invitations],
  );

  return (
    <div className="space-y-8" data-testid="league-invitations">
      <InvitePeople
        invitationsKey={invitationsKey}
        isInactiveLeague={isInactiveLeague}
        joinLink={joinLink}
        leagueId={leagueId}
      />
      <WaitingInvites
        invitations={invitations}
        invitationsKey={invitationsKey}
        isError={invitationsQuery.isError}
        isInactiveLeague={isInactiveLeague}
        isLoading={invitationsQuery.isLoading}
        leagueId={leagueId}
        membersByUserId={membersByUserId}
      />
    </div>
  );
}

type InvitePeopleProps = {
  invitationsKey: QueryKey;
  isInactiveLeague: boolean;
  joinLink: LeagueInvitationDto | undefined;
  leagueId: string;
};

/** Invite by email, and the league's join link with Copy. */
function InvitePeople({ invitationsKey, isInactiveLeague, joinLink, leagueId }: InvitePeopleProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const joinUrl = joinLink ? buildInviteUrl(joinLink.inviteCode) : '';

  const sendInviteMutation = useInvalidatingMutation({
    mutationFn: async (email: string) => {
      const response = await sendLeagueInvitations({
        path: { id: leagueId },
        body: { emails: [email] },
      });
      if (!response.data) {
        throwApiError(response.error, 'Invitation send response is missing data.');
      }
      return response.data;
    },
    invalidates: [invitationsKey],
  });

  const inviteLinkMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await generateInviteLink({ path: { id: leagueId }, body: {} });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Invite link generation did not return an invitation.');
      }
      return response.data.invitation;
    },
    invalidates: [invitationsKey],
  });

  async function handleSendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email || isInactiveLeague) {
      return;
    }
    try {
      await sendInviteMutation.mutateAsync(email);
      setInviteEmail('');
    } catch {
      // Error state is rendered from the mutation; the typed email stays for a retry.
    }
  }

  async function handleCopyJoinLink() {
    if (!joinLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedCode(joinLink.inviteCode);
    } catch {
      // The link stays visible in its field for a manual copy.
    }
  }

  const inviteResult = sendInviteMutation.data ? describeInviteResult(sendInviteMutation.data) : null;

  return (
    <SettingsSection testId="league-invite-people" title="Invite people">
      <form className="space-y-3 px-5 py-4" onSubmit={(event) => void handleSendInvite(event)}>
        <FormField helperText="They get their own link by email." label="Invite by email">
          <div className="flex flex-wrap gap-3">
            <Input
              aria-label="Invite by email"
              className="min-w-0 flex-[1_1_16rem]"
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
              type="submit"
            >
              {sendInviteMutation.isPending ? 'Sending...' : 'Send invite'}
            </Button>
          </div>
        </FormField>
        {inviteResult ? <Alert tone="success">{inviteResult}</Alert> : null}
        {sendInviteMutation.isError ? (
          <Alert tone="danger">
            {extractErrorMessage(sendInviteMutation.error, { fallback: 'We could not send that invitation.' })}
          </Alert>
        ) : null}
      </form>

      <div className="space-y-3 px-5 py-4">
        <FormField
          helperText={joinLink
            ? `Anyone with the link can join. ${joinedCount(joinLink.currentUses)}.`
            : 'Anyone with the link can join.'}
          label="Join link"
        >
          <div className="flex flex-wrap gap-3">
            <Input
              aria-label="Join link"
              className="min-w-0 flex-[1_1_16rem] font-mono"
              data-testid="league-join-url"
              placeholder="No join link yet"
              readOnly
              value={joinUrl}
            />
            <div className="flex gap-2">
              <Button
                aria-label="Copy join link"
                data-testid="league-copy-join-url"
                disabled={!joinLink}
                onClick={() => void handleCopyJoinLink()}
                size="icon"
                title="Copy join link"
                type="button"
                variant="icon"
              >
                {joinLink && copiedCode === joinLink.inviteCode
                  ? <Check aria-hidden size={18} />
                  : <Copy aria-hidden size={18} />}
              </Button>
              <Button
                data-testid="league-create-join-url"
                disabled={inviteLinkMutation.isPending || isInactiveLeague}
                onClick={() => void inviteLinkMutation.mutateAsync().catch(() => undefined)}
                type="button"
                variant="secondary"
              >
                {inviteLinkMutation.isPending ? 'Creating...' : joinLink ? 'New link' : 'Create join link'}
              </Button>
            </div>
          </div>
        </FormField>
        {inviteLinkMutation.isError ? (
          <Alert tone="danger">
            {extractErrorMessage(inviteLinkMutation.error, { fallback: 'We could not create a join link.' })}
          </Alert>
        ) : null}
        {isInactiveLeague ? (
          <p className="text-sm text-muted-foreground" data-testid="league-invites-inactive">
            This league is inactive, so nobody new can be invited.
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}

type WaitingInvitesProps = {
  invitations: LeagueInvitationDto[] | undefined;
  invitationsKey: QueryKey;
  isError: boolean;
  isInactiveLeague: boolean;
  isLoading: boolean;
  leagueId: string;
  membersByUserId: Map<string, LeagueMembershipDto>;
};

/** "Waiting on an answer": the invites not yet accepted or cancelled, searchable and paged. */
function WaitingInvites({
  invitations,
  invitationsKey,
  isError,
  isInactiveLeague,
  isLoading,
  leagueId,
  membersByUserId,
}: WaitingInvitesProps) {
  const logger = getLogger().child({ feature: 'league-invitations' });
  const [filter, setFilter] = useState<InviteFilter>('pending');
  const [rowCopy, setRowCopy] = useState<RowCopy | null>(null);

  // A failed resend or cancel can still mean the list is stale: a resend replaces the code before
  // sending, and a refused cancel means the invite was settled elsewhere. Reload either way.
  const queryClient = useQueryClient();
  const reloadInvitations = () => queryClient.invalidateQueries({ queryKey: invitationsKey });

  const resendMutation = useInvalidatingMutation({
    mutationFn: async (invitationId: string) => {
      const response = await resendLeagueInvitation({ path: { id: leagueId, invitationId } });
      if (!response.data?.invitation) {
        throwApiError(response.error, 'Resend invitation response is missing data.');
      }
      return response.data.invitation;
    },
    onSuccess: (invitation) => {
      setRowCopy(null);
      logger.info(
        { action: 'leagueInvitations.resend.succeeded', data: { leagueId, invitationId: invitation.id } },
        'Resent a league invitation',
      );
    },
    onError: reloadInvitations,
    invalidates: [invitationsKey],
  });

  const cancelMutation = useInvalidatingMutation({
    mutationFn: async (inviteCode: string) => {
      const response = await revokeInviteLink({ path: { id: leagueId, code: inviteCode } });
      if (!response.data) {
        throwApiError(response.error, 'Cancel invitation response is missing data.');
      }
      return response.data;
    },
    onError: reloadInvitations,
    invalidates: [invitationsKey],
  });

  const rows = useMemo<InviteRow[]>(
    () => [...(invitations ?? [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((invitation) => {
        const isEmail = invitation.inviteType === InviteType.EMAIL;
        const inviter = membersByUserId.get(invitation.invitedBy);
        return {
          invitation,
          isEmail,
          isExpired: isExpiredInvitation(invitation),
          label: isEmail ? invitation.email ?? '' : 'Join link',
          link: buildInviteUrl(invitation.inviteCode),
          sentBy: inviter ? formatUserName(inviter.user.firstName, inviter.user.lastName) : 'A former commissioner',
        };
      }),
    [invitations, membersByUserId],
  );
  const expiredCount = rows.filter((row) => row.isExpired).length;
  const visibleRows = useMemo(
    () => rows.filter((row) => (filter === 'expired' ? row.isExpired : !row.isExpired)),
    [filter, rows],
  );

  const isBusy = resendMutation.isPending || cancelMutation.isPending;
  const isResending = resendMutation.isPending;
  const resend = resendMutation.mutateAsync;
  const cancel = cancelMutation.mutateAsync;

  const columns = useMemo<ColumnDef<InviteRow, string>[]>(() => {
    async function handleCopyRowLink(invitationId: string, link: string) {
      try {
        await navigator.clipboard.writeText(link);
        setRowCopy({ invitationId, state: 'copied' });
      } catch {
        // Show the link on the row so it can be copied by hand.
        setRowCopy({ invitationId, state: 'failed' });
      }
    }

    return [
      {
        id: 'invited',
        header: 'Invited',
        accessorFn: (row) => row.label,
        cell: ({ row }) => {
          const { invitation, isEmail, label, link } = row.original;
          return (
            <div className="min-w-0 space-y-1">
              <div className="font-medium text-foreground">{label}</div>
              {isEmail ? null : (
                <div className="text-xs text-muted-foreground">{String(invitation.currentUses)} joined</div>
              )}
              {rowCopy?.invitationId === invitation.id && rowCopy.state === 'failed' ? (
                <p
                  className="break-all font-mono text-xs text-foreground"
                  data-testid={`league-invitation-link-${invitation.id}`}
                >
                  {link}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'sentBy',
        header: 'Sent by',
        enableGlobalFilter: false,
        accessorFn: (row) => row.sentBy,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.sentBy} ·{' '}
            <DateDisplay className="text-muted-foreground" timeStyle={null} value={row.original.invitation.createdAt} />
          </span>
        ),
      },
      {
        id: 'expires',
        header: 'Expires',
        enableGlobalFilter: false,
        accessorFn: (row) => row.invitation.expiresAt ?? '',
        cell: ({ row }) => {
          const { expiresAt } = row.original.invitation;
          return expiresAt
            ? <DateDisplay timeStyle={null} value={expiresAt} />
            : <span className="text-muted-foreground">Never</span>;
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const { invitation, isEmail, isExpired, label, link } = row.original;
          const isCopied = rowCopy?.invitationId === invitation.id && rowCopy.state === 'copied';
          return (
            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
              {isCopied ? (
                <span className="text-xs text-muted-foreground" data-testid={`league-invitation-copied-${invitation.id}`}>
                  Link copied
                </span>
              ) : null}
              {/* An expired link no longer works, so there is nothing to copy; Resend makes a new one. */}
              {isExpired ? null : (
                <Button
                  aria-label={`Copy invite link for ${label}`}
                  data-testid={`league-invitation-copy-${invitation.id}`}
                  disabled={isResending}
                  onClick={() => void handleCopyRowLink(invitation.id, link)}
                  size="sm"
                  title="Copy invite link"
                  type="button"
                  variant="ghost"
                >
                  {isCopied ? <Check aria-hidden size={16} /> : <Copy aria-hidden size={16} />}
                </Button>
              )}
              {isEmail ? (
                <Button
                  data-testid={`league-invitation-resend-${invitation.id}`}
                  disabled={isBusy || isInactiveLeague}
                  onClick={() => void resend(invitation.id).catch(() => undefined)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Resend
                </Button>
              ) : null}
              <Button
                data-testid={`league-invitation-cancel-${invitation.id}`}
                disabled={isBusy}
                onClick={() => void cancel(invitation.inviteCode).catch(() => undefined)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          );
        },
      },
    ];
  }, [cancel, isBusy, isInactiveLeague, isResending, resend, rowCopy]);

  return (
    <section className="space-y-3" data-testid="league-waiting-invites">
      <SettingsSectionHeader
        description="Accepted invites leave this list; the new team shows on Teams."
        title="Waiting on an answer"
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading invites...</p>
      ) : isError ? (
        <p className="text-sm text-destructive" data-testid="league-invitations-error">
          We couldn&apos;t load pending invites right now.
        </p>
      ) : (
        <div className="grid gap-3">
          <SegmentedControl
            aria-label="Invites to show"
            onChange={(value) => {
              if (isInviteFilter(value)) {
                setFilter(value);
              }
            }}
            options={[
              { label: `Pending · ${String(rows.length - expiredCount)}`, testId: 'league-invites-pending', value: 'pending' },
              { label: `Expired · ${String(expiredCount)}`, testId: 'league-invites-expired', value: 'expired' },
            ]}
            value={filter}
          />
          <DataGrid
            columns={columns}
            data={visibleRows}
            emptyMessage={rows.length
              ? (filter === 'expired' ? 'No expired invites.' : 'No pending invites.')
              : 'No invites are waiting on an answer.'}
            getRowId={(row) => row.invitation.id}
            pageSize={INVITES_PER_PAGE}
            rowTestId={(row) => `league-invitation-${row.invitation.id}`}
            search={{ label: 'Find an email', testId: 'league-invites-search' }}
            showColumnFilters={false}
            tableTestId="league-invitations-table"
          />
        </div>
      )}
      {resendMutation.isSuccess && !resendMutation.isPending ? (
        <p className="text-sm text-muted-foreground" data-testid="league-invitation-resent">
          Invite resent with a new link. The old link no longer works.
        </p>
      ) : null}
      {resendMutation.isError ? (
        <p className="text-sm text-destructive" data-testid="league-invitation-resend-error">
          {extractErrorMessage(resendMutation.error, {
            fallback: 'We could not resend that invite. Please try again.',
          })}
        </p>
      ) : null}
      {cancelMutation.isError ? (
        <p className="text-sm text-destructive" data-testid="league-invitation-cancel-error">
          {extractErrorMessage(cancelMutation.error, {
            fallback: 'We could not cancel that invite. Please try again.',
          })}
        </p>
      ) : null}
    </section>
  );
}

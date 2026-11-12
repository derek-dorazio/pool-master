import type { QueryKey } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { InviteType } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import type { LeagueInvitationDto, LeagueMembershipDto } from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import {
  DataGrid,
  DateDisplay,
  ErrorState,
  LoadingState,
  SectionCard,
  SegmentedControl,
  StatusBadge,
  Text,
} from '@/features/shared/ui';
import {
  buildInviteUrl,
  emailStatusLabel,
  isEmailProblem,
  isExpiredInvitation,
  isInviteFilter,
  type InviteFilter,
  type InviteRow,
} from './invites-page-helpers';
import { InvitesPageRowActions } from './invites-page-row-actions';

const INVITES_PER_PAGE = 25;

type InvitesPageWaitingInvitesSectionProps = {
  invitations: LeagueInvitationDto[] | undefined;
  invitationsKey: QueryKey;
  isError: boolean;
  isInactiveLeague: boolean;
  isLoading: boolean;
  leagueId: string;
  membersByUserId: Map<string, LeagueMembershipDto>;
  onRetry: () => void;
};

/**
 * "Waiting on an answer": the invites not yet accepted or cancelled, searchable and paged, each
 * with its status and a "⋯" of quick actions. An invite has no page of its own to open.
 */
export function InvitesPageWaitingInvitesSection({
  invitations,
  invitationsKey,
  isError,
  isInactiveLeague,
  isLoading,
  leagueId,
  membersByUserId,
  onRetry,
}: InvitesPageWaitingInvitesSectionProps) {
  const [filter, setFilter] = useState<InviteFilter>('pending');

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

  const columns = useMemo<ColumnDef<InviteRow, string>[]>(() => [
    {
      id: 'invited',
      header: 'Invited',
      accessorFn: (row) => row.label,
      cell: ({ row }) => {
        const { invitation, isEmail, label } = row.original;
        return (
          <div className="min-w-0 space-y-1">
            <Text as="div" size="inherit" variant="strong">{label}</Text>
            {isEmail ? null : (
              <Text as="div" variant="caption">{String(invitation.currentUses)} joined</Text>
            )}
            {invitation.emailStatus ? (
              <Text
                as="div"
                data-testid={`league-invitation-email-status-${invitation.id}`}
                size="xs"
                tone={isEmailProblem(invitation, invitation.emailStatus) ? 'danger' : 'muted'}
              >
                {emailStatusLabel(invitation, invitation.emailStatus)}
              </Text>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <StatusBadge data-testid={`league-invitation-status-${row.original.invitation.id}`} tone={row.original.isExpired ? 'neutral' : 'active'}>
          {row.original.isExpired ? 'Expired' : 'Pending'}
        </StatusBadge>
      ),
    },
    {
      id: 'sentBy',
      header: 'Sent by',
      enableGlobalFilter: false,
      accessorFn: (row) => row.sentBy,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {row.original.sentBy} ·{' '}
          <Text size="inherit" tone="muted">
            <DateDisplay timeStyle={null} tone="inherit" value={row.original.invitation.createdAt} />
          </Text>
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
          : <Text size="inherit" tone="muted">Never</Text>;
      },
    },
  ], []);

  return (
    <SectionCard
      bare
      help="Accepted invites leave this list; the new member shows on Members."
      testId="league-waiting-invites"
      title="Waiting on an answer"
    >
      {isLoading ? (
        <LoadingState body="Loading invites..." rows={2} size="plain" testId="league-invitations-loading" />
      ) : isError ? (
        <ErrorState body="We couldn't load pending invites right now." onRetry={onRetry} size="plain" testId="league-invitations-error" />
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
            rowActions={(row) => (
              <InvitesPageRowActions
                invitationsKey={invitationsKey}
                isInactiveLeague={isInactiveLeague}
                leagueId={leagueId}
                row={row}
              />
            )}
            rowTestId={(row) => `league-invitation-${row.invitation.id}`}
            search={{ label: 'Find an email', testId: 'league-invites-search' }}
            showColumnFilters={false}
            tableTestId="league-invitations-table"
          />
        </div>
      )}
    </SectionCard>
  );
}

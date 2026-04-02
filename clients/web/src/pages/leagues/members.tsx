import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  UserPlus,
  MoreHorizontal,
  Copy,
  Mail,
  X,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api-client';
import { clientPath, API_ROUTES } from '@poolmaster/shared/api-routes';
import type { LeagueMemberDto, LeagueMembersResponse, LeagueResponse } from '@poolmaster/shared/dto';

function useLeagueMembers(leagueId: string) {
  return useQuery({
    queryKey: ['league-members', leagueId],
    queryFn: async (): Promise<LeagueMemberDto[]> => {
      const res = await api.get<LeagueMembersResponse>(
        clientPath(API_ROUTES.leagues.members(leagueId)),
      );
      return res.members;
    },
  });
}

function useLeagueDetail(leagueId: string) {
  return useQuery({
    queryKey: ['league', leagueId],
    queryFn: async () => {
      const res = await api.get<LeagueResponse>(clientPath(API_ROUTES.leagues.detail(leagueId)));
      return res.league;
    },
  });
}

function useInviteLink(leagueId: string) {
  return useQuery({
    queryKey: ['league-invite-link', leagueId],
    queryFn: async (): Promise<string> => {
      const res = await api.get<{ inviteLink: string }>(
        clientPath(API_ROUTES.leagues.inviteLink(leagueId)),
      );
      return res.inviteLink;
    },
  });
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      className={cn(
        role === 'commissioner'
          ? 'bg-amber-100 text-amber-800 border-amber-200'
          : role === 'co-commissioner'
            ? 'bg-purple-100 text-purple-800 border-purple-200'
            : 'bg-blue-100 text-blue-800 border-blue-200',
      )}
    >
      {role === 'commissioner'
        ? 'Commissioner'
        : role === 'co-commissioner'
          ? 'Co-Commissioner'
          : 'Member'}
    </Badge>
  );
}

function MemberActions({ member, isCommissioner }: { member: LeagueMemberDto; isCommissioner: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useConfirmDialog();

  if (!isCommissioner || member.role === 'commissioner') return null;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => {
                toast({ title: 'Role changed', description: `${member.displayName} is now a Co-Commissioner.` });
                setOpen(false);
              }}
            >
              Change Role
            </button>
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
              onClick={async () => {
                setOpen(false);
                const confirmed = await dialog.confirm(
                  'Remove Member',
                  `Remove ${member.displayName} from the league?`,
                  { confirmLabel: 'Remove', variant: 'destructive' },
                );
                if (confirmed) {
                  toast({ title: 'Member removed', description: `${member.displayName} has been removed.` });
                }
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={dialog.open}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel}
        variant={dialog.variant}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
    </div>
  );
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: members = [], isLoading, isError } = useLeagueMembers(leagueId!);
  const { data: league } = useLeagueDetail(leagueId!);
  const { data: inviteLink = '' } = useInviteLink(leagueId!);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  const isCommissioner = league?.role === 'commissioner';

  function handleSendInvite() {
    if (inviteEmail) {
      toast({ title: 'Invite sent', description: `Invitation sent to ${inviteEmail}.` });
      setInviteEmail('');
      setShowInviteDialog(false);
    }
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteLink).catch(() => {});
    toast({ title: 'Copied!', description: 'Invite link copied to clipboard.' });
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Failed to load members</h2>
        <p className="text-muted-foreground">Something went wrong. Please try again later.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground">Loading members...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Members</h1>
          <p className="text-muted-foreground">{members.length} members in this league</p>
        </div>
        <Button onClick={() => setShowInviteDialog(true)}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite Member
        </Button>
      </div>

      {/* Invite dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Invite Member</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowInviteDialog(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <CardDescription>Send an invite by email or share the link.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="email@example.com"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <Button onClick={handleSendInvite}>
                    <Mail className="h-4 w-4 mr-1" />
                    Send
                  </Button>
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or share link</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={inviteLink}
                  readOnly
                  className="bg-muted font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={copyInviteLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Members table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Member</th>
                  <th className="p-4 font-medium">Role</th>
                  <th className="p-4 font-medium hidden sm:table-cell">Joined</th>
                  {isCommissioner && <th className="p-4 font-medium w-12" />}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const initials = member.displayName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <tr key={member.id} className="border-b last:border-0">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
                            {initials}
                          </div>
                          <div>
                            <div className="font-medium">{member.displayName}</div>
                            {member.joinedAt && (
                              <div className="text-xs text-muted-foreground sm:hidden">
                                {new Date(member.joinedAt).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <RoleBadge role={member.role} />
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">
                        {member.joinedAt
                          ? new Date(member.joinedAt).toLocaleDateString()
                          : '-'}
                      </td>
                      {isCommissioner && (
                        <td className="p-4">
                          <MemberActions member={member} isCommissioner={isCommissioner} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

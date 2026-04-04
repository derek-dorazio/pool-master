import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  client,
  getLeague,
  generateInviteLink,
  removeMember,
  sendLeagueInvitations,
  listLeagueMembers,
} from '@/lib/api';
import {
  type LeagueMemberDto,
  type LeagueDetailDto,
} from '@poolmaster/shared/dto';

function normalizeRole(role: string | undefined): string {
  return role?.toUpperCase() ?? '';
}

function isCommissionerRole(role: string | undefined): boolean {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === 'OWNER' || normalizedRole === 'COMMISSIONER';
}

function useLeagueMembers(leagueId: string) {
  return useQuery({
    queryKey: ['league-members', leagueId],
    queryFn: async (): Promise<LeagueMemberDto[]> => {
      const { data, error } = await listLeagueMembers({ client, path: { id: leagueId } });
      if (error) throw error;
      if (!data) {
        throw new Error('League members response was empty.');
      }
      return data.members;
    },
  });
}

function useLeagueDetail(leagueId: string) {
  return useQuery({
    queryKey: ['league', leagueId],
    queryFn: async (): Promise<LeagueDetailDto> => {
      const { data, error } = await getLeague({ client, path: { id: leagueId } });
      if (error) throw error;
      if (!data) {
        throw new Error('League detail response was empty.');
      }
      return data.league;
    },
  });
}

function useInviteLinkMutation(leagueId: string) {
  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await generateInviteLink({
        client,
        path: { id: leagueId },
        body: {},
      });
      if (error) throw error;
      const inviteCode = (data as { invitation?: { inviteCode?: string } } | undefined)?.invitation?.inviteCode;
      if (!inviteCode) {
        throw new Error('Invite link generation did not return an invite code.');
      }
      return `${window.location.origin}/join/${inviteCode}`;
    },
  });
}

function useSendInvitations(leagueId: string) {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await sendLeagueInvitations({
        client,
        path: { id: leagueId },
        body: { emails: [email] },
      });
      if (error) throw error;
    },
  });
}

function useRemoveLeagueMember(leagueId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await removeMember({
        client,
        path: { id: leagueId, uid: userId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['league-members', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    },
  });
}

function RoleBadge({ role }: { role: string }) {
  const normalizedRole = normalizeRole(role);

  return (
    <Badge
      className={cn(
        normalizedRole === 'OWNER'
          ? 'bg-amber-100 text-amber-800 border-amber-200'
          : normalizedRole === 'COMMISSIONER'
            ? 'bg-purple-100 text-purple-800 border-purple-200'
            : normalizedRole === 'MANAGER'
              ? 'bg-blue-100 text-blue-800 border-blue-200'
              : 'bg-slate-100 text-slate-800 border-slate-200',
      )}
    >
      {normalizedRole === 'OWNER'
        ? 'Owner'
        : normalizedRole === 'COMMISSIONER'
          ? 'Commissioner'
          : normalizedRole === 'MANAGER'
            ? 'Manager'
            : 'Viewer'}
    </Badge>
  );
}

function MemberActions({
  member,
  isCommissioner,
  onRemove,
  isRemoving,
}: {
  member: LeagueMemberDto;
  isCommissioner: boolean;
  onRemove: (member: LeagueMemberDto) => Promise<void>;
  isRemoving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useConfirmDialog();

  if (!isCommissioner || normalizeRole(member.role) === 'OWNER') return null;

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(!open)}
        data-testid={`league-member-actions-${member.userId}`}
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
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
              onClick={async () => {
                setOpen(false);
                const confirmed = await dialog.confirm(
                  'Remove Member',
                  `Remove ${member.displayName} from the league?`,
                  { confirmLabel: 'Remove', variant: 'destructive' },
                );
                if (confirmed) {
                  await onRemove(member);
                }
              }}
              disabled={isRemoving}
              data-testid={`league-member-remove-${member.userId}`}
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
  const inviteLinkMutation = useInviteLinkMutation(leagueId!);
  const sendInvitation = useSendInvitations(leagueId!);
  const removeLeagueMember = useRemoveLeagueMember(leagueId!);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  const isCommissioner = isCommissionerRole(league?.role);

  async function handleSendInvite() {
    if (!inviteEmail.trim()) return;

    try {
      await sendInvitation.mutateAsync(inviteEmail.trim());
      toast({ title: 'Invite sent', description: `Invitation sent to ${inviteEmail.trim()}.` });
      setInviteEmail('');
      setShowInviteDialog(false);
    } catch (error) {
      toast({
        title: 'Failed to send invite',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  async function openInviteDialog() {
    if (!isCommissioner) return;

    setShowInviteDialog(true);

    if (inviteLink || inviteLinkMutation.isPending) {
      return;
    }

    try {
      const generatedInviteLink = await inviteLinkMutation.mutateAsync();
      setInviteLink(generatedInviteLink);
    } catch (error) {
      toast({
        title: 'Failed to generate invite link',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  async function handleRemoveMember(member: LeagueMemberDto) {
    try {
      await removeLeagueMember.mutateAsync(member.userId);
      toast({ title: 'Member removed', description: `${member.displayName} has been removed.` });
    } catch (error) {
      toast({
        title: 'Failed to remove member',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  function copyInviteLink() {
    if (!inviteLink) {
      toast({ title: 'Invite link unavailable', description: 'Generate a fresh invite link first.' });
      return;
    }

    navigator.clipboard.writeText(inviteLink).then(() => {
      toast({ title: 'Copied!', description: 'Invite link copied to clipboard.' });
    }).catch(() => {
      toast({ title: 'Copy failed', description: 'Please copy the invite link manually.' });
    });
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
        <Button data-testid="league-members-invite-button" onClick={openInviteDialog} disabled={!isCommissioner}>
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
                  <Button onClick={handleSendInvite} disabled={sendInvitation.isPending || !inviteEmail.trim()}>
                    <Mail className="h-4 w-4 mr-1" />
                    {sendInvitation.isPending ? 'Sending...' : 'Send'}
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
                placeholder={inviteLinkMutation.isPending ? 'Generating invite link...' : 'Invite link unavailable'}
              />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyInviteLink}
                  disabled={!inviteLink}
                  data-testid="league-members-copy-invite-link"
                >
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
                          <MemberActions
                            member={member}
                            isCommissioner={isCommissioner}
                            onRemove={handleRemoveMember}
                            isRemoving={removeLeagueMember.isPending}
                          />
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

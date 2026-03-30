import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  UserPlus,
  MoreHorizontal,
  Copy,
  Mail,
  RefreshCw,
  X,
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

interface Member {
  id: string;
  name: string;
  initials: string;
  role: 'commissioner' | 'co-commissioner' | 'member';
  joinDate: string;
  email: string;
}

interface PendingInvite {
  id: string;
  email: string;
  sentAt: string;
}

const mockMembers: Member[] = [
  { id: 'm1', name: 'Mike Johnson', initials: 'MJ', role: 'commissioner', joinDate: 'Aug 15, 2025', email: 'mike@example.com' },
  { id: 'm2', name: 'Sarah Kim', initials: 'SK', role: 'co-commissioner', joinDate: 'Aug 16, 2025', email: 'sarah@example.com' },
  { id: 'm3', name: 'Dan Miller', initials: 'DM', role: 'member', joinDate: 'Aug 20, 2025', email: 'dan@example.com' },
  { id: 'm4', name: 'Chris Park', initials: 'CP', role: 'member', joinDate: 'Sep 1, 2025', email: 'chris@example.com' },
  { id: 'm5', name: 'Amy Lee', initials: 'AL', role: 'member', joinDate: 'Sep 5, 2025', email: 'amy@example.com' },
  { id: 'm6', name: 'Tom Brown', initials: 'TB', role: 'member', joinDate: 'Oct 12, 2025', email: 'tom@example.com' },
];

const mockPendingInvites: PendingInvite[] = [
  { id: 'inv1', email: 'jessica@example.com', sentAt: 'Mar 20, 2026' },
  { id: 'inv2', email: 'ryan@example.com', sentAt: 'Mar 22, 2026' },
];

const isCommissioner = true;
const inviteLink = 'https://poolmaster.app/join/abc123xyz';

function useMembersData(leagueId: string) {
  return useQuery({
    queryKey: ['league-members', leagueId],
    queryFn: async () => ({ members: mockMembers, pendingInvites: mockPendingInvites }),
    initialData: { members: mockMembers, pendingInvites: mockPendingInvites },
  });
}

function RoleBadge({ role }: { role: Member['role'] }) {
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

function MemberActions({ member }: { member: Member }) {
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
                toast({ title: 'Role changed', description: `${member.name} is now a Co-Commissioner.` });
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
                  `Remove ${member.name} from the league?`,
                  { confirmLabel: 'Remove', variant: 'destructive' },
                );
                if (confirmed) {
                  toast({ title: 'Member removed', description: `${member.name} has been removed.` });
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
  const { data } = useMembersData(leagueId!);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');

  const members = data?.members ?? [];
  const pendingInvites = data?.pendingInvites ?? [];

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
                {members.map((member) => (
                  <tr key={member.id} className="border-b last:border-0">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
                          {member.initials}
                        </div>
                        <div>
                          <div className="font-medium">{member.name}</div>
                          <div className="text-xs text-muted-foreground sm:hidden">
                            {member.joinDate}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">
                      {member.joinDate}
                    </td>
                    {isCommissioner && (
                      <td className="p-4">
                        <MemberActions member={member} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pending invitations (commissioner only) */}
      {isCommissioner && pendingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pending Invitations</CardTitle>
            <CardDescription>{pendingInvites.length} pending invites</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between p-4"
                >
                  <div>
                    <div className="font-medium text-sm">{invite.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Sent {invite.sentAt}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toast({ title: 'Invite resent', description: `Resent to ${invite.email}.` })
                      }
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() =>
                        toast({ title: 'Invite revoked', description: `Invite to ${invite.email} revoked.` })
                      }
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

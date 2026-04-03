import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CurrencySelect } from '@/components/ui/currency-select';
import { toast } from '@/hooks/use-toast';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatCurrency } from '@/lib/format-currency';
import { usePreferencesStore } from '@/stores/preferences-store';
import {
  client,
  generateInviteLink,
  getLeague,
  transferOwnership,
  updateLeagueSettings,
} from '@/lib/api';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  LeagueMembersResponseSchema,
  type LeagueDetailDto,
  type LeagueMemberDto,
} from '@poolmaster/shared/dto';

type InvitePolicy = 'COMMISSIONER_ONLY' | 'LINK_INVITE' | 'OPEN';
type WeekDay =
  | 'MONDAY'
  | 'TUESDAY'
  | 'WEDNESDAY'
  | 'THURSDAY'
  | 'FRIDAY'
  | 'SATURDAY'
  | 'SUNDAY';

interface LeagueSettingsFormState {
  invitePolicy: InvitePolicy;
  allowMidSeasonJoin: boolean;
  requireApproval: boolean;
  activityFeedEnabled: boolean;
  weeklyRecapEnabled: boolean;
  weeklyRecapDay: WeekDay;
  timezone: string;
  currency: string;
}

const DEFAULT_SETTINGS: LeagueSettingsFormState = {
  invitePolicy: 'COMMISSIONER_ONLY',
  allowMidSeasonJoin: false,
  requireApproval: false,
  activityFeedEnabled: true,
  weeklyRecapEnabled: false,
  weeklyRecapDay: 'MONDAY',
  timezone: 'America/New_York',
  currency: 'USD',
};

const INVITE_POLICY_LABELS: Record<InvitePolicy, string> = {
  COMMISSIONER_ONLY: 'Invite only',
  LINK_INVITE: 'Invite link',
  OPEN: 'Open join',
};

function normalizeRole(role: string | undefined): string {
  return role?.toUpperCase() ?? '';
}

function isCommissionerRole(role: string | undefined): boolean {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === 'OWNER' || normalizedRole === 'COMMISSIONER';
}

function isOwnerRole(role: string | undefined): boolean {
  return normalizeRole(role) === 'OWNER';
}

function readLeagueSettings(league: LeagueDetailDto | undefined): LeagueSettingsFormState {
  const rawSettings = (league?.settings ?? {}) as Partial<LeagueSettingsFormState>;
  return {
    invitePolicy:
      rawSettings.invitePolicy && rawSettings.invitePolicy in INVITE_POLICY_LABELS
        ? rawSettings.invitePolicy
        : league?.invitePolicy && league.invitePolicy in INVITE_POLICY_LABELS
          ? (league.invitePolicy as InvitePolicy)
          : DEFAULT_SETTINGS.invitePolicy,
    allowMidSeasonJoin: rawSettings.allowMidSeasonJoin ?? DEFAULT_SETTINGS.allowMidSeasonJoin,
    requireApproval: rawSettings.requireApproval ?? DEFAULT_SETTINGS.requireApproval,
    activityFeedEnabled: rawSettings.activityFeedEnabled ?? DEFAULT_SETTINGS.activityFeedEnabled,
    weeklyRecapEnabled: rawSettings.weeklyRecapEnabled ?? DEFAULT_SETTINGS.weeklyRecapEnabled,
    weeklyRecapDay: rawSettings.weeklyRecapDay ?? DEFAULT_SETTINGS.weeklyRecapDay,
    timezone: rawSettings.timezone ?? DEFAULT_SETTINGS.timezone,
    currency: rawSettings.currency ?? DEFAULT_SETTINGS.currency,
  };
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
    staleTime: 5 * 60 * 1000,
  });
}

function useLeagueMembers(leagueId: string) {
  return useQuery({
    queryKey: ['league-members', leagueId],
    queryFn: async (): Promise<LeagueMemberDto[]> => {
      const { data, error } = await client.get({
        url: API_ROUTES.leagues.members(leagueId),
      });
      if (error) throw error;
      return LeagueMembersResponseSchema.parse(data).members;
    },
  });
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const resolvedLeagueId = leagueId!;
  const queryClient = useQueryClient();
  const dialog = useConfirmDialog();
  const { numberFormat } = usePreferencesStore();
  const { data: league, isLoading } = useLeagueDetail(resolvedLeagueId);
  const { data: members = [] } = useLeagueMembers(resolvedLeagueId);
  const [form, setForm] = useState<LeagueSettingsFormState>(DEFAULT_SETTINGS);
  const [inviteLink, setInviteLink] = useState('');
  const [newOwnerId, setNewOwnerId] = useState('');

  useEffect(() => {
    if (!league) {
      return;
    }
    setForm(readLeagueSettings(league));
  }, [league]);

  const isCommissioner = isCommissionerRole(league?.role);
  const isOwner = isOwnerRole(league?.role);
  const transferCandidates = useMemo(
    () => members.filter((member) => normalizeRole(member.role) !== 'OWNER'),
    [members],
  );

  const saveMutation = useMutation({
    mutationFn: async (body: LeagueSettingsFormState) => {
      const { error } = await updateLeagueSettings({
        client,
        path: { id: resolvedLeagueId },
        body,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['league', resolvedLeagueId] });
      toast({ title: 'Settings saved', description: 'League settings were updated.' });
    },
  });

  const inviteLinkMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await generateInviteLink({
        client,
        path: { id: resolvedLeagueId },
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

  const transferMutation = useMutation({
    mutationFn: async (selectedOwnerId: string) => {
      const { error } = await transferOwnership({
        client,
        path: { id: resolvedLeagueId },
        body: { newOwnerId: selectedOwnerId },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['league', resolvedLeagueId] });
      await queryClient.invalidateQueries({ queryKey: ['league-members', resolvedLeagueId] });
      toast({
        title: 'Ownership transferred',
        description: 'The new commissioner now owns this league.',
      });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="h-8 w-64 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  async function onSave() {
    if (!isCommissioner) {
      return;
    }

    try {
      await saveMutation.mutateAsync(form);
    } catch (error) {
      toast({
        title: 'Failed to save settings',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  function updateForm<K extends keyof LeagueSettingsFormState>(
    key: K,
    value: LeagueSettingsFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function copyInviteLink() {
    if (!inviteLink) {
      toast({
        title: 'Invite link unavailable',
        description: 'Generate a fresh invite link first.',
      });
      return;
    }

    navigator.clipboard.writeText(inviteLink).then(() => {
      toast({ title: 'Copied!', description: 'Invite link copied to clipboard.' });
    }).catch(() => {
      toast({ title: 'Copy failed', description: 'Please copy the invite link manually.' });
    });
  }

  async function generateNewLink() {
    if (!isCommissioner) {
      return;
    }

    try {
      const nextInviteLink = await inviteLinkMutation.mutateAsync();
      setInviteLink(nextInviteLink);
      toast({
        title: 'Invite link generated',
        description: 'Share this link to invite a new member.',
      });
    } catch (error) {
      toast({
        title: 'Failed to generate invite link',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  async function handleTransfer() {
    if (!isOwner || !newOwnerId) {
      return;
    }

    const selectedMember = transferCandidates.find((member) => member.userId === newOwnerId);
    const confirmed = await dialog.confirm(
      'Transfer Commissioner Role',
      selectedMember
        ? `Transfer league ownership to ${selectedMember.displayName}? You will become a commissioner.`
        : 'Transfer league ownership to the selected member? You will become a commissioner.',
      { confirmLabel: 'Transfer', variant: 'destructive' },
    );

    if (!confirmed) {
      return;
    }

    try {
      await transferMutation.mutateAsync(newOwnerId);
      setNewOwnerId('');
    } catch (error) {
      toast({
        title: 'Failed to transfer ownership',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/leagues/${resolvedLeagueId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">League Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>League Details</CardTitle>
          <CardDescription>
            League name and description are read-only here until the backend supports a real edit route.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="league-name">League Name</Label>
            <Input id="league-name" value={league?.name ?? ''} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="league-description">Description</Label>
            <Input
              id="league-description"
              value={league?.description ?? 'No description provided.'}
              readOnly
              className="bg-muted"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gameplay Settings</CardTitle>
          <CardDescription>These controls save real league settings on the backend.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="invite-policy">Invite Policy</Label>
            <Select
              id="invite-policy"
              value={form.invitePolicy}
              onChange={(event) => updateForm('invitePolicy', event.target.value as InvitePolicy)}
              disabled={!isCommissioner}
            >
              <option value="COMMISSIONER_ONLY">Invite only</option>
              <option value="LINK_INVITE">Invite link</option>
              <option value="OPEN">Open join</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              Current policy: {INVITE_POLICY_LABELS[form.invitePolicy]}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-timezone">League Timezone</Label>
            <Input
              id="settings-timezone"
              value={form.timezone}
              onChange={(event) => updateForm('timezone', event.target.value)}
              disabled={!isCommissioner}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="settings-currency">League Currency</Label>
            <CurrencySelect
              id="settings-currency"
              value={form.currency}
              onValueChange={(value) => updateForm('currency', value)}
              disabled={!isCommissioner}
            />
            <p className="text-xs text-muted-foreground">
              Amounts in this league will display as{' '}
              {formatCurrency(123456, form.currency, numberFormat)}.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="allow-mid-season-join">Allow Mid-Season Join</Label>
                  <p className="text-xs text-muted-foreground">Permit members to join after play begins.</p>
                </div>
                <Switch
                  id="allow-mid-season-join"
                  checked={form.allowMidSeasonJoin}
                  onCheckedChange={(checked) => updateForm('allowMidSeasonJoin', checked)}
                  disabled={!isCommissioner}
                />
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="require-approval">Require Approval</Label>
                  <p className="text-xs text-muted-foreground">Review join requests before admitting members.</p>
                </div>
                <Switch
                  id="require-approval"
                  checked={form.requireApproval}
                  onCheckedChange={(checked) => updateForm('requireApproval', checked)}
                  disabled={!isCommissioner}
                />
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="activity-feed-enabled">Activity Feed</Label>
                  <p className="text-xs text-muted-foreground">Show league activity updates to members.</p>
                </div>
                <Switch
                  id="activity-feed-enabled"
                  checked={form.activityFeedEnabled}
                  onCheckedChange={(checked) => updateForm('activityFeedEnabled', checked)}
                  disabled={!isCommissioner}
                />
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="weekly-recap-enabled">Weekly Recap</Label>
                  <p className="text-xs text-muted-foreground">Send weekly league recap summaries.</p>
                </div>
                <Switch
                  id="weekly-recap-enabled"
                  checked={form.weeklyRecapEnabled}
                  onCheckedChange={(checked) => updateForm('weeklyRecapEnabled', checked)}
                  disabled={!isCommissioner}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="weekly-recap-day">Weekly Recap Day</Label>
            <Select
              id="weekly-recap-day"
              value={form.weeklyRecapDay}
              onChange={(event) => updateForm('weeklyRecapDay', event.target.value as WeekDay)}
              disabled={!isCommissioner || !form.weeklyRecapEnabled}
            >
              <option value="MONDAY">Monday</option>
              <option value="TUESDAY">Tuesday</option>
              <option value="WEDNESDAY">Wednesday</option>
              <option value="THURSDAY">Thursday</option>
              <option value="FRIDAY">Friday</option>
              <option value="SATURDAY">Saturday</option>
              <option value="SUNDAY">Sunday</option>
            </Select>
          </div>

          <Button type="button" onClick={onSave} disabled={!isCommissioner || saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Invite links are generated on demand so the UI does not imply there is an active link when there is not.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-link">Invite Link</Label>
            <div className="flex gap-2">
              <Input
                id="invite-link"
                value={inviteLink}
                readOnly
                className="bg-muted font-mono text-xs"
                placeholder="Generate a fresh invite link when you need one."
              />
              <Button variant="outline" size="icon" onClick={copyInviteLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={generateNewLink}
            disabled={!isCommissioner || inviteLinkMutation.isPending}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {inviteLinkMutation.isPending ? 'Generating...' : 'Generate Invite Link'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Ownership Transfer
          </CardTitle>
          <CardDescription>
            Ownership transfer is real. Archive/delete actions are hidden until the backend supports them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-owner">New Owner</Label>
            <Select
              id="new-owner"
              value={newOwnerId}
              onChange={(event) => setNewOwnerId(event.target.value)}
              disabled={!isOwner || transferCandidates.length === 0}
            >
              <option value="">Select a member</option>
              {transferCandidates.map((member) => (
                <option key={member.id} value={member.userId}>
                  {member.displayName} ({normalizeRole(member.role)})
                </option>
              ))}
            </Select>
          </div>

          {!isOwner && (
            <p className="text-sm text-muted-foreground">
              Only the current owner can transfer league ownership.
            </p>
          )}

          {isOwner && transferCandidates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add another member before transferring ownership.
            </p>
          )}

          <Button
            variant="destructive"
            size="sm"
            onClick={handleTransfer}
            disabled={!isOwner || !newOwnerId || transferMutation.isPending}
          >
            {transferMutation.isPending ? 'Transferring...' : 'Transfer Ownership'}
          </Button>
        </CardContent>
      </Card>

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

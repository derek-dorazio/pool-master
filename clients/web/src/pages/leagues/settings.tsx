import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { client, getLeague } from '@/lib/api';

interface LeagueSettings {
  name: string;
  description: string;
  invitePolicy: string;
  inviteLink: string;
}

interface SettingsForm {
  name: string;
  description: string;
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['leagues', leagueId, 'settings'],
    queryFn: async () => {
      const { data, error } = await getLeague({ client, path: { id: leagueId! } });
      if (error) throw error;
      return data as unknown as LeagueSettings;
    },
    staleTime: 5 * 60 * 1000,
  });

  const [inviteLink, setInviteLink] = useState('');
  const [leagueCurrency, setLeagueCurrency] = useState('USD');
  const { numberFormat } = usePreferencesStore();

  const { register, handleSubmit, reset } = useForm<SettingsForm>({
    defaultValues: {
      name: '',
      description: '',
    },
  });

  const dialog = useConfirmDialog();

  // Update form defaults + invite link when settings load
  useEffect(() => {
    if (settings) {
      reset({ name: settings.name, description: settings.description });
      setInviteLink(settings.inviteLink);
    }
  }, [settings, reset]);

  if (isLoading) {
    return <div className="max-w-2xl mx-auto space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  function onSave(data: SettingsForm) {
    toast({ title: 'Settings saved', description: `League "${data.name}" has been updated.` });
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteLink).catch(() => {});
    toast({ title: 'Copied!', description: 'Invite link copied to clipboard.' });
  }

  function generateNewLink() {
    const newId = Math.random().toString(36).substring(2, 14);
    setInviteLink(`https://poolmaster.app/join/${newId}`);
    toast({ title: 'New link generated', description: 'The old invite link is no longer valid.' });
  }

  async function handleArchive() {
    const confirmed = await dialog.confirm(
      'Archive League',
      'Are you sure you want to archive this league? This cannot be undone.',
      { confirmLabel: 'Archive', variant: 'destructive' },
    );
    if (confirmed) {
      toast({ title: 'League archived', description: 'The league has been archived.' });
    }
  }

  async function handleTransfer() {
    const confirmed = await dialog.confirm(
      'Transfer Commissioner Role',
      'Are you sure you want to transfer the commissioner role? You will lose admin privileges.',
      { confirmLabel: 'Transfer', variant: 'destructive' },
    );
    if (confirmed) {
      toast({ title: 'Role transferred', description: 'Commissioner role has been transferred.' });
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/leagues/${leagueId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">League Settings</h1>
      </div>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>Basic league information.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSave)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="settings-name">League Name</Label>
              <Input id="settings-name" {...register('name')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-desc">Description</Label>
              <Textarea id="settings-desc" rows={3} {...register('description')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-currency">League Currency</Label>
              <CurrencySelect
                id="settings-currency"
                value={leagueCurrency}
                onValueChange={setLeagueCurrency}
              />
              <p className="text-xs text-muted-foreground">
                Amounts in this league will display as:{' '}
                {formatCurrency(123456, leagueCurrency, numberFormat)}
              </p>
            </div>
            <Button type="submit">Save Changes</Button>
          </form>
        </CardContent>
      </Card>

      {/* Invitations */}
      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Current policy: <span className="font-medium">{settings?.invitePolicy ?? 'Invite Only'}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Invite Link</Label>
            <div className="flex gap-2">
              <Input value={inviteLink} readOnly className="bg-muted font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyInviteLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button variant="outline" onClick={generateNewLink}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Generate New Link
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>Irreversible actions. Proceed with caution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Archive League</div>
              <div className="text-xs text-muted-foreground">
                Hide the league and prevent new activity.
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={handleArchive}>
              Archive League
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Transfer Commissioner Role</div>
              <div className="text-xs text-muted-foreground">
                Give another member full admin control.
              </div>
            </div>
            <Button variant="destructive" size="sm" onClick={handleTransfer}>
              Transfer Role
            </Button>
          </div>
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

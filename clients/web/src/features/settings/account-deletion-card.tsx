import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProfile } from './hooks/use-profile';
import { toast } from '@/hooks/use-toast';
import {
  AccountDeletionAcceptedResponseSchema,
} from '@poolmaster/shared/dto/compliance.dto';
import { cancelAccountDeletion, requestAccountDeletion, client } from '@/lib/api';

type Step = 'idle' | 'consequences' | 'confirm' | 'waiting';

export function AccountDeletionCard() {
  const { data: profile } = useProfile();
  const [step, setStep] = useState<Step>('idle');
  const [typedName, setTypedName] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);

  const requestDeletion = useMutation({
    mutationFn: async () => {
      const { data, error } = await requestAccountDeletion({
        client,
        body: { reason: 'user_requested' },
      });
      if (error) throw error;
      return AccountDeletionAcceptedResponseSchema.parse(data);
    },
    onSuccess: (data) => {
      setRequestId(data.requestId);
      setStep('waiting');
    },
    onError: () => {
      toast({ title: 'Request failed', description: 'Please try again.' });
    },
  });

  const cancelDeletion = useMutation({
    mutationFn: async () => {
      if (!requestId) throw new Error('No pending deletion request');
      const { error } = await cancelAccountDeletion({ client, path: { id: requestId } });
      if (error) throw error;
    },
    onSuccess: () => {
      setRequestId(null);
      setStep('idle');
      setTypedName('');
      toast({ title: 'Deletion cancelled', description: 'Your account will remain active.' });
    },
    onError: () => {
      toast({ title: 'Request failed', description: 'Please try again.' });
    },
  });

  const displayName = profile?.displayName ?? '';

  async function handleDelete() {
    await requestDeletion.mutateAsync();
  }

  return (
    <Card className="border-destructive/20">
      <CardHeader>
        <CardTitle>Delete Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Deleting your account is permanent. All your leagues, contest entries, and history will
          be removed.
        </div>

        {step === 'idle' && (
          <Button variant="destructive" onClick={() => setStep('consequences')}>
            Delete My Account
          </Button>
        )}

        {step === 'consequences' && (
          <div
            className="space-y-4 rounded-md border p-4"
            role="alertdialog"
            aria-describedby="deletion-consequences"
          >
            <p className="text-sm font-medium">The following will be permanently deleted:</p>
            <ul id="deletion-consequences" className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Your profile and account information</li>
              <li>All contest entries and draft history</li>
              <li>League memberships and commissioner roles</li>
              <li>Payment history and subscription</li>
            </ul>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => setStep('confirm')}>
                Continue
              </Button>
              <Button variant="ghost" onClick={() => setStep('idle')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4 rounded-md border p-4">
            <p className="text-sm">
              Type your display name to confirm: <strong>{displayName}</strong>
            </p>
            <Input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={displayName}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={typedName !== displayName || requestDeletion.isPending}
              >
                {requestDeletion.isPending ? 'Deleting...' : 'Permanently Delete'}
              </Button>
              <Button variant="ghost" onClick={() => { setStep('idle'); setTypedName(''); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === 'waiting' && (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Account scheduled for deletion</p>
            <p className="mt-1 text-muted-foreground">
              Your account will be deactivated immediately and permanently deleted after 14 days.
              You can cancel deletion by signing in within this period.
            </p>
            <div className="mt-3">
              <Button
                variant="outline"
                onClick={() => void cancelDeletion.mutateAsync()}
                disabled={!requestId || cancelDeletion.isPending}
              >
                {cancelDeletion.isPending ? 'Cancelling...' : 'Cancel Deletion'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

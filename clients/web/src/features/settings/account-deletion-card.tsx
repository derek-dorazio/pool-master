import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProfile } from './hooks/use-profile';
import { toast } from '@/hooks/use-toast';
import {
  AccountDeletionAcceptedResponseSchema,
  AccountDeletionStatusResponseSchema,
} from '@poolmaster/shared/dto/compliance.dto';
import { cancelAccountDeletion, getAccountDeletionStatus, requestAccountDeletion, client } from '@/lib/api';
import { settingsKeys } from './hooks/query-keys';

type Step = 'idle' | 'consequences' | 'confirm' | 'waiting';

export function AccountDeletionCard() {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const [step, setStep] = useState<Step>('idle');
  const [typedName, setTypedName] = useState('');
  const deletionStatusQuery = useQuery({
    queryKey: settingsKeys.accountDeletion(),
    queryFn: async () => {
      const { data, error } = await getAccountDeletionStatus({ client });
      if (error) throw error;
      return AccountDeletionStatusResponseSchema.parse(data);
    },
  });

  const pendingRequestId = deletionStatusQuery.data?.status === 'pending'
    ? deletionStatusQuery.data.requestId
    : null;

  const currentStep: Step = pendingRequestId ? 'waiting' : step;

  const requestDeletion = useMutation({
    mutationFn: async () => {
      const { data, error } = await requestAccountDeletion({
        client,
        body: { reason: 'user_requested' },
      });
      if (error) throw error;
      return AccountDeletionAcceptedResponseSchema.parse(data);
    },
    onSuccess: async () => {
      setStep('waiting');
      await queryClient.invalidateQueries({ queryKey: settingsKeys.accountDeletion() });
    },
    onError: () => {
      toast({ title: 'Request failed', description: 'Please try again.' });
    },
  });

  const cancelDeletion = useMutation({
    mutationFn: async () => {
      if (!pendingRequestId) throw new Error('No pending deletion request');
      const { error } = await cancelAccountDeletion({ client, path: { id: pendingRequestId } });
      if (error) throw error;
    },
    onSuccess: async () => {
      setStep('idle');
      setTypedName('');
      toast({ title: 'Deletion cancelled', description: 'Your account will remain active.' });
      await queryClient.invalidateQueries({ queryKey: settingsKeys.accountDeletion() });
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

        {deletionStatusQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading deletion status...</p>
        ) : deletionStatusQuery.isError ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm">
            <p>We couldn't load your account deletion status.</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => void deletionStatusQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {currentStep === 'idle' && !deletionStatusQuery.isLoading && !deletionStatusQuery.isError && (
          <Button variant="destructive" onClick={() => setStep('consequences')}>
            Delete My Account
          </Button>
        )}

        {currentStep === 'consequences' && (
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

        {currentStep === 'confirm' && (
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

        {currentStep === 'waiting' && (
          <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Account scheduled for deletion</p>
            <p className="mt-1 text-muted-foreground">
              Your account will be deactivated immediately and permanently deleted after 14 days.
              You can cancel deletion by signing in within this period.
            </p>
            {deletionStatusQuery.data?.scheduledDeletionAt ? (
              <p className="mt-1 text-muted-foreground">
                Scheduled deletion date:{' '}
                {new Date(deletionStatusQuery.data.scheduledDeletionAt).toLocaleDateString()}
              </p>
            ) : null}
            <div className="mt-3">
              <Button
                variant="outline"
                onClick={() => void cancelDeletion.mutateAsync()}
                disabled={!pendingRequestId || cancelDeletion.isPending}
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

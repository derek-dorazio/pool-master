import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProfile } from './hooks/use-profile';
import { toast } from '@/hooks/use-toast';

type Step = 'idle' | 'consequences' | 'confirm' | 'waiting';

export function AccountDeletionCard() {
  const { data: profile } = useProfile();
  const [step, setStep] = useState<Step>('idle');
  const [typedName, setTypedName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const displayName = profile?.displayName ?? '';

  async function handleDelete() {
    setIsDeleting(true);
    try {
      // TODO: await api.post('/account/delete');
      await new Promise((resolve) => setTimeout(resolve, 500));
      setStep('waiting');
    } catch {
      toast({ title: 'Request failed', description: 'Please try again.' });
    } finally {
      setIsDeleting(false);
    }
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
                disabled={typedName !== displayName || isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Permanently Delete'}
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

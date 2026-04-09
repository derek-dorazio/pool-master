import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLinkedAccounts, useConnectAccount, useDisconnectAccount } from './hooks/use-linked-accounts';
import { useProfile } from './hooks/use-profile';

const providerLabels: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
};

export function LinkedAccounts() {
  const { data: accounts, isLoading } = useLinkedAccounts();
  const { data: profile } = useProfile();
  const connectAccount = useConnectAccount();
  const disconnectAccount = useDisconnectAccount();
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Linked Accounts</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Check if user has only one auth method
  const connectedCount = (accounts?.filter((a) => a.connected).length ?? 0) +
    (profile?.authProvider === 'email' ? 1 : 0);
  const hasOnlyOneMethod = connectedCount <= 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Accounts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts?.map((account) => (
          <div
            key={account.provider}
            className="flex items-center justify-between rounded-md border p-3"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-sm font-bold">
                {account.provider === 'google' ? 'G' : 'A'}
              </span>
              <div>
                <p className="text-sm font-medium">{providerLabels[account.provider]}</p>
                {account.connected ? (
                  <p className="text-xs text-muted-foreground">{account.email}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Not connected</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {account.connected && (
                <span className="text-xs text-green-600 dark:text-green-400">Connected</span>
              )}

              {confirmDisconnect === account.provider ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      disconnectAccount.mutate(account.provider);
                      setConfirmDisconnect(null);
                    }}
                    disabled={disconnectAccount.isPending}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(null)}>
                    Cancel
                  </Button>
                </div>
              ) : account.connected ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDisconnect(account.provider)}
                  disabled={hasOnlyOneMethod}
                  title={hasOnlyOneMethod ? 'You must have at least one sign-in method. Set a password first.' : undefined}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => connectAccount.mutate(account.provider)}
                  disabled={connectAccount.isPending}
                >
                  Connect
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

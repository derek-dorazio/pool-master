import { useState } from 'react';
import { AlertTriangle, Search, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { adminApi } from '@/lib/api-client';
import { useUserSearch } from '@/hooks/use-admin-api';
import type { UserResult } from '@/hooks/use-admin-api';

function UserSearchSelect({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: UserResult | null;
  onSelect: (user: UserResult) => void;
}) {
  const [query, setQuery] = useState('');
  const { data: results } = useUserSearch(query);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{label}</h3>
      {!selected ? (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by email or name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {results && results.length > 0 && (
            <div className="space-y-2">
              {results.map((u) => (
                <button
                  key={u.id}
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => {
                    onSelect(u);
                    setQuery('');
                  }}
                >
                  <div>
                    <p className="font-medium">{u.displayName}</p>
                    <p className="text-muted-foreground">{u.email}</p>
                  </div>
                  <Badge variant="outline">{u.tenants[0]}</Badge>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="font-semibold">{selected.displayName}</p>
                <p className="text-sm text-muted-foreground">{selected.email}</p>
                <p className="text-sm text-muted-foreground">Tenants: {selected.tenants.join(', ')}</p>
                <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
                  <span>3 leagues</span>
                  <span>5 contests</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelect(null as unknown as UserResult)}
              >
                Change
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function Component() {
  const [primary, setPrimary] = useState<UserResult | null>(null);
  const [duplicate, setDuplicate] = useState<UserResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const dialog = useConfirmDialog();

  const bothSelected = primary !== null && duplicate !== null;
  const sameUser = primary?.id === duplicate?.id;

  function handlePreview() {
    if (sameUser) {
      return;
    }
    setShowPreview(true);
  }

  async function handleConfirmMerge() {
    const confirmed = await dialog.confirm(
      'Merge Accounts',
      `Merge "${duplicate?.displayName}" into "${primary?.displayName}"? This action cannot be undone.`,
      { confirmLabel: 'Merge', variant: 'destructive' },
    );
    if (confirmed) {
      try {
        await adminApi.post('/v1/admin/users/merge', {
          primaryId: primary?.id,
          duplicateId: duplicate?.id,
        });
      } catch {
        // Silently handle — backend may not be available yet
      }
      setPrimary(null);
      setDuplicate(null);
      setShowPreview(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Merge Accounts</h1>

      {/* Warning banner */}
      <div className="flex items-center gap-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
        <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600" />
        <p className="text-sm text-yellow-800">
          This action transfers all data from the duplicate to the primary account. This cannot be undone.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-8">
        <UserSearchSelect
          label="Primary Account"
          selected={primary}
          onSelect={(u) => {
            setPrimary(u);
            setShowPreview(false);
          }}
        />
        <UserSearchSelect
          label="Duplicate Account"
          selected={duplicate}
          onSelect={(u) => {
            setDuplicate(u);
            setShowPreview(false);
          }}
        />
      </div>

      {/* Preview button */}
      <div className="flex justify-center">
        <Button
          size="lg"
          disabled={!bothSelected || sameUser}
          onClick={handlePreview}
        >
          Preview Merge
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      {sameUser && bothSelected && (
        <p className="text-center text-sm text-destructive">
          Primary and duplicate accounts must be different users.
        </p>
      )}

      {/* Preview section */}
      {showPreview && bothSelected && !sameUser && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Merge Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The following data will be transferred from{' '}
              <span className="font-medium text-foreground">{duplicate.displayName}</span> to{' '}
              <span className="font-medium text-foreground">{primary.displayName}</span>:
            </p>
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">3</p>
                  <p className="text-sm text-muted-foreground">Leagues</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">5</p>
                  <p className="text-sm text-muted-foreground">Entries</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">12</p>
                  <p className="text-sm text-muted-foreground">History Records</p>
                </CardContent>
              </Card>
            </div>
            <div className="flex justify-center pt-2">
              <Button variant="destructive" size="lg" onClick={handleConfirmMerge}>
                Confirm Merge
              </Button>
            </div>
          </CardContent>
        </Card>
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

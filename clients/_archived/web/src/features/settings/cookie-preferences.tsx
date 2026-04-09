import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConsent, useUpdateConsent } from './hooks/use-consent';

interface CookieCategory {
  key: string;
  label: string;
  description: string;
  locked?: boolean;
}

const cookieCategories: CookieCategory[] = [
  {
    key: 'necessary',
    label: 'Strictly Necessary',
    description: 'Required for the site to function. Cannot be disabled.',
    locked: true,
  },
  {
    key: 'functional',
    label: 'Functional',
    description: 'Always active so we can remember preferences like timezone and display settings.',
    locked: true,
  },
  {
    key: 'analytics',
    label: 'Analytics',
    description: 'Help us understand how the site is used so we can improve it.',
  },
];

interface CookiePreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CookiePreferencesDialog({ open, onOpenChange }: CookiePreferencesDialogProps) {
  const { data: consent } = useConsent();
  const updateConsent = useUpdateConsent();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    necessary: true,
    functional: true,
    analytics: consent?.analytics ?? false,
  });

  useEffect(() => {
    if (consent) {
      setPrefs((p) => ({ ...p, analytics: consent.analytics }));
    }
  }, [consent]);

  if (!open) return null;

  function handleSave() {
    updateConsent.mutate({ analytics: prefs.analytics });
    onOpenChange(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} aria-hidden="true" />
      <div className="relative z-50 w-full max-w-lg rounded-lg border bg-card shadow-lg" role="dialog" aria-modal="true">
        <Card className="border-0 shadow-none">
          <CardHeader>
            <CardTitle>Cookie Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cookieCategories.map((cat) => (
              <div key={cat.key} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{cat.label}</p>
                  <p className="text-xs text-muted-foreground">{cat.description}</p>
                </div>
                <Switch
                  checked={prefs[cat.key] ?? true}
                  onCheckedChange={(checked) => {
                    if (!cat.locked) setPrefs((p) => ({ ...p, [cat.key]: checked }));
                  }}
                  disabled={cat.locked}
                  aria-label={cat.label}
                />
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                Save Preferences
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function CookiePreferencesCard() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Cookie Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Manage which types of cookies we use. Strictly necessary cookies are always active.
          </p>
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            Manage Cookies
          </Button>
        </CardContent>
      </Card>

      <CookiePreferencesDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

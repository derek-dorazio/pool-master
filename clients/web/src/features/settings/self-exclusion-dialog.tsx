import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const coolDownOptions = [
  { value: '24H', label: '24 Hours' },
  { value: '7D', label: '7 Days' },
  { value: '30D', label: '30 Days' },
  { value: '6M', label: '6 Months' },
  { value: '1Y', label: '1 Year' },
];

export function SelfExclusionCard() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [period, setPeriod] = useState('24H');
  const [typed, setTyped] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      // TODO: await api.post('/account/self-exclusion', { period });
      await new Promise((resolve) => setTimeout(resolve, 300));
      toast({ title: 'Self-exclusion activated', description: `Your account will be paused for ${coolDownOptions.find((o) => o.value === period)?.label}.` });
      setDialogOpen(false);
      setTyped('');
    } catch {
      toast({ title: 'Failed to activate self-exclusion' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Self-Exclusion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Take a break from Ultimate Pool Manager. During the cool-down period, you won't be able to enter
            contests or participate in drafts.
          </p>
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            Take a Break
          </Button>
        </CardContent>
      </Card>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setDialogOpen(false)} aria-hidden="true" />
          <div className="relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg" role="alertdialog" aria-modal="true">
            <h2 className="text-lg font-semibold">Self-Exclusion</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose how long you'd like to pause your account. During this time you won't be able
              to enter contests or participate in drafts.
            </p>

            <div className="mt-4 space-y-2">
              {coolDownOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors',
                    period === opt.value ? 'border-primary bg-accent' : 'border-input hover:bg-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="cooldown"
                    value={opt.value}
                    checked={period === opt.value}
                    onChange={() => setPeriod(opt.value)}
                    className="accent-primary"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm">
                Type <strong>CONFIRM</strong> to activate self-exclusion:
              </p>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="CONFIRM"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDialogOpen(false); setTyped(''); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={typed !== 'CONFIRM' || isSubmitting}
              >
                {isSubmitting ? 'Activating...' : 'Activate Self-Exclusion'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

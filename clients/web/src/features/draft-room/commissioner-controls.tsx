import { useState } from 'react';
import { Shield, Pause, Play, Undo2, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface CommissionerControlsProps {
  draftId: string;
  draftStatus: 'PENDING' | 'LIVE' | 'PAUSED' | 'COMPLETE';
  isCommissioner: boolean;
}

export function CommissionerControls({ draftId, draftStatus, isCommissioner }: CommissionerControlsProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const action = useMutation({
    mutationFn: async (_actionType: string) => {
      // TODO: Replace with real API calls
      // await api.post(`/v1/drafts/${draftId}/commissioner/${actionType}`);
      await new Promise((r) => setTimeout(r, 300));
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts', draftId] });
      setConfirming(null);
    },
  });

  if (!isCommissioner || draftStatus === 'COMPLETE') return null;

  const actions = [
    {
      key: 'pause',
      label: 'Pause Draft',
      icon: Pause,
      show: draftStatus === 'LIVE',
      confirm: 'Pause the draft? All timers will stop until you resume.',
    },
    {
      key: 'resume',
      label: 'Resume Draft',
      icon: Play,
      show: draftStatus === 'PAUSED',
      confirm: 'Resume the draft? Timers will restart.',
    },
    {
      key: 'undo',
      label: 'Undo Last Pick',
      icon: Undo2,
      show: draftStatus === 'LIVE' || draftStatus === 'PAUSED',
      confirm: 'Undo the last pick? The player will return to the available pool.',
    },
    {
      key: 'skip',
      label: 'Skip Pick',
      icon: SkipForward,
      show: draftStatus === 'LIVE',
      confirm: 'Skip the current pick? It will be marked as skipped.',
    },
  ];

  return (
    <>
      <div className="flex items-center gap-1 border-l pl-3 ml-3">
        <Shield className="h-4 w-4 text-amber-600" />
        <span className="text-xs font-medium text-amber-600 mr-1">Commissioner</span>
        {actions.filter((a) => a.show).map((a) => (
          <Button
            key={a.key}
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setConfirming(a.key)}
            disabled={action.isPending}
          >
            <a.icon className="h-3.5 w-3.5 mr-1" />
            {a.label}
          </Button>
        ))}
      </div>

      {/* Confirmation dialog */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold">Confirm Action</h3>
            <p className="text-sm text-muted-foreground">
              {actions.find((a) => a.key === confirming)?.confirm}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                onClick={() => action.mutate(confirming)}
                disabled={action.isPending}
              >
                {action.isPending ? 'Processing...' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

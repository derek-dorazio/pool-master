import { Bell, Trophy, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePushPermission } from './hooks/use-push-permission';
import { toast } from '@/hooks/use-toast';

interface PushPermissionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PushPermissionDialog({ open, onOpenChange }: PushPermissionDialogProps) {
  const { requestPermission, isSupported } = usePushPermission();

  async function handleAllow() {
    const result = await requestPermission();
    onOpenChange(false);
    if (result === 'granted') {
      toast({ title: 'Push notifications enabled!' });
    } else if (result === 'denied') {
      toast({
        title: 'Notifications blocked',
        description: 'You can enable notifications anytime in Settings > Notifications.',
      });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className="relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Enable Push Notifications"
      >
        <h2 className="text-lg font-semibold">Enable Push Notifications</h2>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm">Know instantly when your draft is about to start</span>
          </li>
          <li className="flex items-start gap-3">
            <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm">Get real-time score alerts as games happen</span>
          </li>
          <li className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm">Never miss a contest entry deadline</span>
          </li>
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe Later
          </Button>
          <Button onClick={handleAllow} disabled={!isSupported}>
            {isSupported ? 'Allow Notifications' : 'Not supported in this browser'}
          </Button>
        </div>
      </div>
    </div>
  );
}

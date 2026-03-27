import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNotificationUiStore } from '@/stores/notification-ui-store';
import { usePushPermission } from './hooks/use-push-permission';
import { PushPermissionDialog } from './push-permission-dialog';

export function PushPermissionBanner() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const dismissed = useNotificationUiStore((s) => s.pushBannerDismissed);
  const dismissBanner = useNotificationUiStore((s) => s.dismissPushBanner);
  const { isDefault } = usePushPermission();

  if (!isDefault || dismissed) return null;

  return (
    <>
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-center gap-4 py-3">
          <BellRing className="h-5 w-5 shrink-0 text-primary" />
          <p className="flex-1 text-sm">
            Stay in the loop — enable push notifications to get real-time alerts for scores, drafts, and contest updates.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={dismissBanner}>
              Not now
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Enable Notifications
            </Button>
          </div>
        </CardContent>
      </Card>

      <PushPermissionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

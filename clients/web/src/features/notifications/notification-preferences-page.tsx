import { PreferencesMatrix } from './preferences-matrix';
import { DNDScheduler } from './dnd-scheduler';
import { usePushPermission } from './hooks/use-push-permission';

export function NotificationPreferencesPage() {
  const { isDenied } = usePushPermission();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Notification Preferences</h1>
        <p className="mt-1 text-muted-foreground">
          Per-category notification controls. Choose how and when you receive alerts for each type
          of activity.
        </p>
      </div>

      {isDenied && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium">Push notifications are blocked</p>
          <p className="mt-1 text-muted-foreground">
            To re-enable, update your browser's site notification settings.
          </p>
        </div>
      )}

      <PreferencesMatrix />

      <DNDScheduler />
    </div>
  );
}

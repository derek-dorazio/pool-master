import { CategoryFilter } from './category-filter';
import { BulkActions } from './bulk-actions';
import { NotificationList } from './notification-list';
import { PushPermissionBanner } from './push-permission-banner';

export function NotificationCentrePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Notifications</h1>
        <p className="mt-1 text-muted-foreground">
          Your notification centre. View and manage alerts for league activity, contest updates, and draft reminders.
        </p>
      </div>

      <PushPermissionBanner />

      <CategoryFilter />

      <BulkActions />

      <NotificationList />
    </div>
  );
}

import { User, Bell, Globe, Shield } from 'lucide-react';
import { SettingsCard } from './settings-card';
import { useUnreadCount } from '@/features/notifications/hooks/use-unread-count';

export function SettingsHub() {
  const { data: unreadCounts } = useUnreadCount();
  const unreadBadge = unreadCounts && unreadCounts.total > 0
    ? `${unreadCounts.total} unread`
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your profile, notifications, timezone, privacy, and account preferences.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsCard
          title="Profile"
          description="Manage your display name, email, avatar, and linked accounts"
          icon={User}
          href="/settings/profile"
        />
        <SettingsCard
          title="Notifications"
          description="Control what notifications you receive and how they are delivered"
          icon={Bell}
          href="/settings/notifications"
          badge={unreadBadge}
        />
        <SettingsCard
          title="Timezone & Locale"
          description="Set your timezone, date format, and number format preferences"
          icon={Globe}
          href="/settings/timezone"
        />
        <SettingsCard
          title="Privacy & Data"
          description="Export your data, manage consent preferences, or delete your account"
          icon={Shield}
          href="/settings/privacy"
        />
      </div>
    </div>
  );
}

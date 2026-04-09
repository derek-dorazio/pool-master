import { ChannelToggle } from './channel-toggle';
import type { CategoryPreference } from './hooks/use-notification-preferences';

const categoryLabels: Record<string, { label: string; description: string }> = {
  draft: {
    label: 'Draft Reminders',
    description: 'Draft starting soon, pick timer warnings, draft results',
  },
  scoring: {
    label: 'Score Alerts',
    description: 'Score updates, rank changes, scoring corrections',
  },
  contest: {
    label: 'Contest Updates',
    description: 'Contest created, entry deadlines, contest results',
  },
  league: {
    label: 'League Activity',
    description: 'Member joined/left, commissioner announcements, season events',
  },
  social: {
    label: 'Social',
    description: 'Mentions, direct messages, comments on your entries',
  },
  account: {
    label: 'Account & Billing',
    description: 'Password changes, payment confirmations, subscription reminders',
  },
};

interface CategoryRowProps {
  category: string;
  preference: CategoryPreference;
  pushDisabled: boolean;
  onToggle: (channel: keyof CategoryPreference, value: boolean) => void;
}

export function CategoryRow({ category, preference, pushDisabled, onToggle }: CategoryRowProps) {
  const meta = categoryLabels[category] ?? { label: category, description: '' };
  const isAccountCategory = category === 'account';

  return (
    <tr className="border-b last:border-b-0">
      <td className="py-3 pr-4">
        <p className="text-sm font-medium">{meta.label}</p>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </td>
      <td className="px-4 py-3 text-center">
        <ChannelToggle
          checked={preference.inApp}
          locked={isAccountCategory}
          onToggle={(val) => onToggle('inApp', val)}
          ariaLabel={`${meta.label} in-app notifications`}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <ChannelToggle
          checked={preference.push}
          disabled={pushDisabled}
          disabledTooltip="Enable browser notifications first"
          onToggle={(val) => onToggle('push', val)}
          ariaLabel={`${meta.label} push notifications`}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <ChannelToggle
          checked={preference.email}
          locked={isAccountCategory}
          onToggle={(val) => onToggle('email', val)}
          ariaLabel={`${meta.label} email notifications`}
        />
      </td>
    </tr>
  );
}

export function CategoryRowMobile({ category, preference, pushDisabled, onToggle }: CategoryRowProps) {
  const meta = categoryLabels[category] ?? { label: category, description: '' };
  const isAccountCategory = category === 'account';

  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium">{meta.label}</p>
      <p className="mb-3 text-xs text-muted-foreground">{meta.description}</p>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-xs">
          <ChannelToggle
            checked={preference.inApp}
            locked={isAccountCategory}
            onToggle={(val) => onToggle('inApp', val)}
            ariaLabel={`${meta.label} in-app`}
          />
          In-App
        </label>
        <label className="flex items-center gap-2 text-xs">
          <ChannelToggle
            checked={preference.push}
            disabled={pushDisabled}
            disabledTooltip="Enable browser notifications first"
            onToggle={(val) => onToggle('push', val)}
            ariaLabel={`${meta.label} push`}
          />
          Push
        </label>
        <label className="flex items-center gap-2 text-xs">
          <ChannelToggle
            checked={preference.email}
            locked={isAccountCategory}
            onToggle={(val) => onToggle('email', val)}
            ariaLabel={`${meta.label} email`}
          />
          Email
        </label>
      </div>
    </div>
  );
}

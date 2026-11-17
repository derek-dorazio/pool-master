import { Switch, Text } from '@/features/shared/ui';

/**
 * The "My entries" switch in a leaderboard's toolbar (#1750): on, the board lists only the
 * viewer's entries, each at its real place; off, the full board with theirs marked where they
 * fall. A board shows it only while the viewer has an entry on it; `useMyEntriesFilter` keeps
 * its state in the address.
 */
export function MyEntriesToggle({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <span className="flex items-center gap-2">
      <Switch checked={checked} label="My entries" onCheckedChange={onCheckedChange} testId="contest-leaderboard-my-entries" />
      <Text aria-hidden as="span" size="xs" variant="label">My entries</Text>
    </span>
  );
}

import { enumLabel } from '@poolmaster/shared/display-strings';
import { AutoReleaseCheckOutcome, SportEventReleaseAtKind } from '@poolmaster/shared/domain';
import {
  DetailsPeek,
  formatDateTimeDisplay,
  SectionRow,
  SectionRows,
  Text,
  useDisplayPreferences,
} from '@/features/shared/ui';
import type { SportLeagueEventOverviewDto } from '@/lib/api';

/** A Release date cell: an actual date plainly, a planned one grey with its latest check on hover. */
export function LeagueEventReleaseDate({ event }: { event: SportLeagueEventOverviewDto }) {
  const preferences = useDisplayPreferences();
  if (event.releaseAt === null) return null;
  const when = formatDateTimeDisplay(event.releaseAt, preferences);
  if (event.releaseAtKind !== SportEventReleaseAtKind.PLANNED) return <span>{when}</span>;
  const check = event.lastReleaseCheck;
  if (check === null) return <Text tone="muted">{when}</Text>;
  const held = check.outcome === AutoReleaseCheckOutcome.HELD;
  return (
    <DetailsPeek
      icon={<Text tone="muted">{when}</Text>}
      label={`${event.name}: latest release check`}
      testId={`root-admin-league-event-release-${event.id}`}
      trigger="text"
    >
      <SectionRows>
        <SectionRow
          facts={held ? `${check.failedChecks.map((key) => enumLabel('ReleaseCheckKey', key)).join(', ')} failed` : 'Every check passed'}
          name={`Last checked ${formatDateTimeDisplay(check.checkedAt, preferences)}`}
        />
      </SectionRows>
    </DetailsPeek>
  );
}

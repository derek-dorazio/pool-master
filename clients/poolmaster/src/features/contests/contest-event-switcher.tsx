import { FormField, formatDateDisplay, Select, useDisplayPreferences } from '@/features/shared/ui';
import type { ContestSportEvent } from './contest-events';

/**
 * Which of a contest's events a page shows (#713): an NFL pick'em has a week per event, and its
 * entry and leaderboard pages show one week at a time. A contest of one event has nothing to
 * switch, so this renders nothing for it.
 */
export function ContestEventSwitcher({
  describe,
  events,
  label = 'Event',
  onChange,
  testId,
  value,
}: {
  /** A short note after an event's name, such as whether this entry submitted it. */
  describe?: (sportEvent: ContestSportEvent) => string | null;
  events: readonly ContestSportEvent[];
  /** What the contest calls its events: a pick'em's are weeks. */
  label?: string;
  onChange: (sportEventId: string) => void;
  testId: string;
  value: string;
}) {
  const displayPreferences = useDisplayPreferences();
  if (events.length < 2) {
    return null;
  }

  return (
    <FormField className="max-w-md" label={label}>
      <Select data-testid={testId} onChange={(event) => onChange(event.target.value)} value={value}>
        {events.map((sportEvent) => {
          const note = describe?.(sportEvent) ?? null;
          return (
            <option key={sportEvent.sportEventId} value={sportEvent.sportEventId}>
              {`${sportEvent.name} · ${formatDateDisplay(sportEvent.startDate, displayPreferences)}${note ? ` · ${note}` : ''}`}
            </option>
          );
        })}
      </Select>
    </FormField>
  );
}

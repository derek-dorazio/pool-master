import { FormField, Select } from '@/features/shared/ui';

/** The years the pickers offer: a few back for results, one ahead for schedules loaded early. */
const EVENT_YEARS_BACK = 3;
const EVENT_YEARS_AHEAD = 1;

function eventYearOptions(currentYear: number): number[] {
  const years: number[] = [];
  for (let year = currentYear + EVENT_YEARS_AHEAD; year >= currentYear - EVENT_YEARS_BACK; year -= 1) {
    years.push(year);
  }
  return years;
}

/**
 * The year an event list reads. The event lists need a filter (#1180) and a Manage page asks
 * for it first (#1313), so each opens on this year rather than every year's events.
 */
export function EventYearSelect({ value, onChange, testId }: {
  value: number;
  onChange: (eventYear: number) => void;
  testId: string;
}) {
  return (
    <FormField className="max-w-xs" label="Year">
      <Select
        data-testid={testId}
        onChange={(change) => onChange(Number(change.target.value))}
        value={value}
      >
        {eventYearOptions(new Date().getFullYear()).map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

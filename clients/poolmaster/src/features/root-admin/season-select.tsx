import { FormField, Select } from '@/features/shared/ui';
import type { SportLeagueSeasonDto } from '@/lib/api';

/**
 * A sport league's Season picker (#2003): its Seasons, latest first, each labelled by its name.
 * The event lists need a filter (#1180), so each opens on one Season rather than every Season's
 * events.
 */
export function SeasonSelect({ seasons, value, onChange, testId }: {
  seasons: readonly Pick<SportLeagueSeasonDto, 'id' | 'name'>[];
  value: string;
  onChange: (sportLeagueSeasonId: string) => void;
  testId: string;
}) {
  return (
    <FormField className="max-w-xs" label="Season">
      <Select data-testid={testId} onChange={(change) => onChange(change.target.value)} value={value}>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

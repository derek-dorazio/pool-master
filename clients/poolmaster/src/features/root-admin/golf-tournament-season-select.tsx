import { FormField, Select } from '@/features/shared/ui';
import type { AdminListGolfSeasonsResponses } from '@/lib/api';

type GolfSeason = AdminListGolfSeasonsResponses[200]['seasons'][number];

/**
 * plans/124 §6.3 — the required Season picker shared by both tournament-creation
 * modes. A tournament's season is fixed at creation, so this only ever appears on
 * the create page.
 */
export function GolfTournamentSeasonSelect({
  onChange,
  seasons,
  value,
}: {
  onChange: (seasonId: string) => void;
  seasons: readonly GolfSeason[];
  value: string;
}) {
  return (
    <FormField
      error={value === '' ? 'Choose the season this tournament belongs to.' : undefined}
      helperText="Required. A tournament's season is fixed at creation and cannot be changed afterward."
      label="Season *"
    >
      <Select
        data-testid="root-admin-golf-tournament-create-season"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Select a season</option>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

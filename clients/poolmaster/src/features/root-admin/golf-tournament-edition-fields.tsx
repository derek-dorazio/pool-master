import { FormField, Input, Select } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import {
  parseEventYear,
  type GolfTournamentEdition,
} from './golf-tournament-edition';

/**
 * plans/147 — the tour and event year a tournament is created into, shared by both
 * creation modes. They replaced the season picker: a tournament is one year's edition of
 * a series on a tour, and the series is found or created from its name. Both are fixed at
 * creation.
 */
export function GolfTournamentEditionFields({
  edition,
  onChange,
  tours,
}: {
  edition: GolfTournamentEdition;
  onChange: (edition: GolfTournamentEdition) => void;
  tours: readonly SportLeagueDto[];
}) {
  return (
    <>
      <FormField
        error={edition.sportLeagueId === '' ? 'Choose the tour this tournament runs on.' : undefined}
        helperText="Required. Fixed at creation."
        label="Tour *"
      >
        <Select
          data-testid="root-admin-golf-tournament-create-tour"
          onChange={(event) => onChange({ ...edition, sportLeagueId: event.target.value })}
          value={edition.sportLeagueId}
        >
          <option value="">Select a tour</option>
          {tours.map((tour) => (
            <option key={tour.id} value={tour.id}>
              {tour.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        error={parseEventYear(edition.eventYear) === null ? 'Enter the year the tournament is known by.' : undefined}
        helperText="The year in its name — the 2026 Masters — even when it starts the December before."
        label="Event year *"
      >
        <Input
          data-testid="root-admin-golf-tournament-create-event-year"
          inputMode="numeric"
          onChange={(event) => onChange({ ...edition, eventYear: event.target.value })}
          value={edition.eventYear}
        />
      </FormField>
    </>
  );
}

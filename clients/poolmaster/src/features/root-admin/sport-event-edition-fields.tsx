import { FormField, Input, Select } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import {
  parseEventYear,
  type SportEventEdition,
} from './sport-event-edition';
import { capitalize } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/147 — the tour and event year a tournament is created into, shared by both
 * creation modes. They replaced the season picker: a tournament is one year's edition of
 * a series on a tour, and the series is found or created from its name. Both are fixed at
 * creation.
 */
export function SportEventEditionFields({
  edition,
  onChange,
  sportLeagues,
}: {
  edition: SportEventEdition;
  onChange: (edition: SportEventEdition) => void;
  sportLeagues: readonly SportLeagueDto[];
}) {
  const { event, sportLeague: sportLeagueNoun } = useManagedSport().definition.vocabulary;
  return (
    <>
      <FormField
        error={edition.sportLeagueId === '' ? `Choose the ${sportLeagueNoun.one} this ${event.one} runs on.` : undefined}
        helperText="Required. Fixed at creation."
        label={`${capitalize(sportLeagueNoun.one)} *`}
      >
        <Select
          data-testid="root-admin-sport-event-create-tour"
          onChange={(event) => onChange({ ...edition, sportLeagueId: event.target.value })}
          value={edition.sportLeagueId}
        >
          <option value="">Select a {sportLeagueNoun.one}</option>
          {sportLeagues.map((sportLeague) => (
            <option key={sportLeague.id} value={sportLeague.id}>
              {sportLeague.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        error={parseEventYear(edition.eventYear) === null ? `Enter the year the ${event.one} is known by.` : undefined}
        helperText="The year in its name, even when it starts the December before."
        label="Event year *"
      >
        <Input
          data-testid="root-admin-sport-event-create-event-year"
          inputMode="numeric"
          onChange={(event) => onChange({ ...edition, eventYear: event.target.value })}
          value={edition.eventYear}
        />
      </FormField>
    </>
  );
}

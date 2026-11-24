import { sportVocabulary } from '@poolmaster/shared/domain';
import { FormField, Select } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import type { SportEventEdition } from './sport-event-edition';
import { useManagedSport } from './use-managed-sport';
import { upperFirst } from '@/lib/upper-first';

/**
 * The tour a tournament is created into, shared by both creation modes. A tournament is one
 * Season's edition of a series on a tour, and goes in the tour's current Season (#2003); the series
 * is found or created from its name. Both are fixed at creation.
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
  const { event, sportLeague: sportLeagueNoun } = sportVocabulary(useManagedSport().definition);
  return (
    <>
      <FormField
        error={edition.sportLeagueId === '' ? `Choose the ${sportLeagueNoun.one} this ${event.one} runs on.` : undefined}
        helperText="Required. Fixed at creation. The event goes in its current Season."
        label={`${upperFirst(sportLeagueNoun.one)} *`}
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
    </>
  );
}

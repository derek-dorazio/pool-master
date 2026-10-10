import { getTieredRosterSize } from '@poolmaster/shared/domain';
import { Checkbox, FormField, Input } from '@/features/shared/ui';
import { defaultCountedScoresFor, type ContestRulesValues } from './contest-rules-form';

/**
 * The rules inputs for a contest's format: picks per tier and scores that count for a tiered
 * contest, then entries per team with No limit. Create and Edit contest both use it, so a new
 * format adds its fields here once.
 */
export function ContestRulesFields({
  onChange,
  tierCount,
  values,
}: {
  onChange: (next: Partial<ContestRulesValues>) => void;
  tierCount: number;
  values: ContestRulesValues;
}) {
  const picksPerTier = Number(values.picksPerTier);
  const rosterSize = tierCount > 0 && Number.isInteger(picksPerTier) && picksPerTier >= 1
    ? getTieredRosterSize(tierCount, picksPerTier)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          helperText={tierCount > 0
            ? `${tierCount} tiers × ${values.picksPerTier || '?'} = ${rosterSize ?? '—'} golfers per entry`
            : 'The event has no tiers yet.'}
          label="Picks per tier"
        >
          <Input
            data-testid="contest-tiered-picks-per-tier"
            min={1}
            onChange={(event) => {
              const next = event.target.value;
              const countedScores = defaultCountedScoresFor(next, tierCount);
              onChange(countedScores === null ? { picksPerTier: next } : { countedScores, picksPerTier: next });
            }}
            type="number"
            value={values.picksPerTier}
          />
        </FormField>
        <FormField
          helperText={rosterSize !== null ? `Best ${values.countedScores || '?'} of ${rosterSize}` : undefined}
          label="Scores that count"
        >
          <Input
            data-testid="contest-tiered-counted-scores"
            min={1}
            onChange={(event) => onChange({ countedScores: event.target.value })}
            type="number"
            value={values.countedScores}
          />
        </FormField>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Entries per team">
          <Input
            data-testid="contest-max-entries"
            disabled={values.unlimitedEntries}
            min={1}
            onChange={(event) => onChange({ maxEntriesPerTeam: event.target.value })}
            type="number"
            value={values.unlimitedEntries ? '' : values.maxEntriesPerTeam}
          />
        </FormField>
        <label className="flex items-end gap-3 pb-3 text-sm font-medium text-foreground">
          <Checkbox
            checked={values.unlimitedEntries}
            data-testid="contest-max-entries-unlimited"
            onChange={(event) => onChange({ unlimitedEntries: event.target.checked })}
          />
          No limit
        </label>
      </div>
    </div>
  );
}

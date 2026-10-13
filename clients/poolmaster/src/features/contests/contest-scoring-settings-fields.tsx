import { FormField, Input } from '@/features/shared/ui';
import type { ScoringSettingsFieldsProps } from './contest-scoring-settings';

/** A finish-position contest's points table and its "did not finish" value (#622). */
export function FinishPositionPointsFields({ onChange, values, vocabulary }: ScoringSettingsFieldsProps) {
  const example = vocabulary.topPlaces !== undefined ? `: 5, 3, 1 is ${vocabulary.topPlaces}` : '';
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        helperText={`Points by finishing place, winner first${example}. A place beyond the table scores 0.`}
        label="Points table"
      >
        <Input
          data-testid="contest-scoring-points-table"
          inputMode="numeric"
          onChange={(event) => onChange({ pointsTable: event.target.value })}
          type="text"
          value={values.pointsTable}
        />
      </FormField>
      <FormField
        helperText={`What a ${vocabulary.participant.one} scores when it does not finish, is disqualified or does not start.`}
        label="Points for not finishing"
      >
        <Input
          data-testid="contest-scoring-did-not-finish-points"
          min={0}
          onChange={(event) => onChange({ didNotFinishPoints: event.target.value })}
          type="number"
          value={values.didNotFinishPoints}
        />
      </FormField>
    </div>
  );
}

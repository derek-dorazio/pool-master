import { FormField, Input, Select } from '@/features/shared/ui';
import { UpsetBonusRule } from '@poolmaster/shared/domain';
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

/** A knockout contest's points for a win in each round and its upset bonus (#699). */
export function KnockoutRoundPointsFields({ onChange, values, vocabulary }: ScoringSettingsFieldsProps) {
  const team = vocabulary.participant.one;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        helperText={`What a ${team} scores for a win in each ${vocabulary.round.one}, first ${vocabulary.round.one} first: one value for every ${vocabulary.round.one} of the bracket.`}
        label="Points for a win"
      >
        <Input
          data-testid="contest-scoring-round-values"
          inputMode="numeric"
          onChange={(event) => onChange({ roundValues: event.target.value })}
          type="text"
          value={values.roundValues}
        />
      </FormField>
      <FormField
        helperText={`With the bonus on, a win by the worse seed adds the seed difference. An unseeded ${team} counts as the field's worst seed.`}
        label="Upset bonus"
      >
        <Select
          data-testid="contest-scoring-upset-bonus"
          onChange={(event) => onChange({
            upsetBonusRule: event.target.value === UpsetBonusRule.SEED_DIFFERENCE ? UpsetBonusRule.SEED_DIFFERENCE : UpsetBonusRule.NONE,
          })}
          value={values.upsetBonusRule}
        >
          <option value={UpsetBonusRule.NONE}>No upset bonus</option>
          <option value={UpsetBonusRule.SEED_DIFFERENCE}>Seed difference</option>
        </Select>
      </FormField>
      {values.upsetBonusRule === UpsetBonusRule.SEED_DIFFERENCE ? (
        <FormField helperText="The seed difference is multiplied by this: 1 adds it as it is." label="Upset bonus multiplier">
          <Input
            data-testid="contest-scoring-upset-bonus-multiplier"
            min={1}
            onChange={(event) => onChange({ upsetBonusMultiplier: event.target.value })}
            type="number"
            value={values.upsetBonusMultiplier}
          />
        </FormField>
      ) : null}
    </div>
  );
}

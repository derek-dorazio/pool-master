import type { SportDefinition } from '@poolmaster/shared/domain';
import type { ReactElement } from 'react';
import { FormSection, InlineError, Text } from '@/features/shared/ui';
import type { BracketStartRoundOption } from '../bracket-start-round';
import { ContestRulesFields } from '../contest-rules-fields';
import type { ScoringSettingsFieldsProps } from '../contest-scoring-settings';
import { STAT_POOL_STARS } from '../scoring-family-ui/stat-pool-copy';
import type { CreateContestFormValues } from './create-contest-helpers';

/**
 * Create contest, step 3: the chosen format's rules, then its scoring settings when the scoring
 * takes any, each with the first thing wrong under it. Any change leaves the preset for Custom.
 */
export function CreateContestRulesSection({
  bracketStartRounds,
  onChange,
  rulesError,
  salaryCap,
  ScoringFields,
  scoringError,
  sportDefinition,
  statPoolScoring,
  tierCount,
  values,
}: {
  bracketStartRounds: readonly BracketStartRoundOption[];
  onChange: (next: Partial<CreateContestFormValues>) => void;
  rulesError: string | null;
  /** The event's salary cap, or null while its field is unpriced. */
  salaryCap: number | null;
  /** The scoring definition's own inputs, or null when it takes none. */
  ScoringFields: ((props: ScoringSettingsFieldsProps) => ReactElement) | null;
  scoringError: string | null;
  sportDefinition: SportDefinition;
  /** How a Clutch Card's stars score, or null for every other contest. */
  statPoolScoring: string | null;
  tierCount: number;
  values: CreateContestFormValues;
}) {
  return (
    <FormSection
      help="Starts from the preset you chose. Changing any rule makes the contest Custom."
      step={3}
      testId="create-contest-rules"
      title="Rules"
    >
      {statPoolScoring !== null ? (
        <Text as="p" data-testid="create-contest-stat-pool-scoring" variant="meta">
          {`Each ${STAT_POOL_STARS.one} scores ${statPoolScoring}`}
        </Text>
      ) : null}
      <ContestRulesFields
        bracketStartRounds={bracketStartRounds}
        onChange={onChange}
        participant={sportDefinition.vocabulary.participant}
        salaryCap={salaryCap}
        selectionType={values.selectionType}
        tierCount={tierCount}
        values={values}
      />
      {rulesError !== null ? <InlineError testId="contest-rules-error">{rulesError}</InlineError> : null}
      {ScoringFields ? (
        <ScoringFields
          onChange={onChange}
          selectionType={values.selectionType}
          values={values}
          vocabulary={sportDefinition.vocabulary}
        />
      ) : null}
      {scoringError !== null ? <InlineError testId="contest-scoring-error">{scoringError}</InlineError> : null}
    </FormSection>
  );
}

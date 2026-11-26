import { sportVocabulary } from '@poolmaster/shared/domain';
import type { SportDefinition } from '@poolmaster/shared/domain';
import type { ReactElement } from 'react';
import { FormSection, InlineError } from '@/features/shared/ui';
import { ContestRulesFields } from '../contest-rules-fields';
import type { ScoringSettingsFieldsProps } from '../contest-scoring-settings';
import type { CreateContestFormValues } from './create-contest-helpers';

/**
 * Create contest, step 3: the chosen format's rules, then its scoring settings when the scoring
 * takes any, each with the first thing wrong under it. Any change leaves the preset for Custom.
 */
export function CreateContestRulesSection({
  onChange,
  rulesError,
  salaryCap,
  ScoringFields,
  scoringError,
  sportDefinition,
  tierCount,
  values,
}: {
  onChange: (next: Partial<CreateContestFormValues>) => void;
  rulesError: string | null;
  /** The event's salary cap, or null while its field is unpriced. */
  salaryCap: number | null;
  /** The scoring definition's own inputs, or null when it takes none. */
  ScoringFields: ((props: ScoringSettingsFieldsProps) => ReactElement) | null;
  scoringError: string | null;
  sportDefinition: SportDefinition;
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
      <ContestRulesFields
        onChange={onChange}
        participant={sportVocabulary(sportDefinition).participant}
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
          vocabulary={sportVocabulary(sportDefinition)}
        />
      ) : null}
      {scoringError !== null ? <InlineError testId="contest-scoring-error">{scoringError}</InlineError> : null}
    </FormSection>
  );
}

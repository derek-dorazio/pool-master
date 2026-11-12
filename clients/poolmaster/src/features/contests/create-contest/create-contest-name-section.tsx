import { FormField, FormSection, Input } from '@/features/shared/ui';

/**
 * Create contest, step 4: the contest's name, suggested from the event and format until the
 * commissioner types their own.
 */
export function CreateContestNameSection({ onChange, value }: { onChange: (name: string) => void; value: string }) {
  return (
    <FormSection help="Filled from the event and format until you change it." step={4} testId="create-contest-name" title="Name">
      <FormField label="Contest name">
        <Input data-testid="contest-name" onChange={(event) => onChange(event.target.value)} type="text" value={value} />
      </FormField>
    </FormSection>
  );
}

import type { FieldOrderBasis } from '@poolmaster/shared/domain';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { FormField, Input, Textarea } from '@/features/shared/ui';
import { ProfileSourcesField } from './profile-sources-field';

/** A field's validation message, as react-hook-form reports it. */
interface FieldMessage {
  message?: string;
}

/**
 * The fields every profile form opens with (#2160, #2194): its code, its name, its description for
 * agents and root admins, and the sources it orders a field by. Each form hands in its own
 * registration and its sources' controller, so one layout serves the tier and the pricing
 * profile alike.
 */
export interface ProfileIdentityFieldsProps {
  errors: { code?: FieldMessage; name?: FieldMessage; description?: FieldMessage; sources?: FieldMessage };
  /** Which profile's form, which names its fields' ids and test ids. */
  kind: 'tier' | 'pricing';
  /** Called on any edit, as each form clears a refused save's message. */
  onEdit: () => void;
  register: (field: 'code' | 'name' | 'description') => UseFormRegisterReturn;
  sources: { onChange: (sources: FieldOrderBasis[]) => void; value: readonly FieldOrderBasis[] };
}

export function ProfileIdentityFields({ errors, kind, onEdit, register, sources }: ProfileIdentityFieldsProps) {
  const idPrefix = `${kind}-profile`;
  const testIdPrefix = `root-admin-${kind}-profile-editor`;
  return (
    <>
      <FormField error={errors.code?.message} id={`${idPrefix}-code`} label="Code">
        <Input data-testid={`${testIdPrefix}-code`} id={`${idPrefix}-code`} {...register('code')} />
      </FormField>
      <FormField error={errors.name?.message} id={`${idPrefix}-name`} label="Name">
        <Input data-testid={`${testIdPrefix}-name`} id={`${idPrefix}-name`} {...register('name')} />
      </FormField>
      <FormField
        error={errors.description?.message}
        helperText="For agents and root admins: what the profile is and why it exists. Commissioners and members never see it."
        id={`${idPrefix}-description`}
        label="Description"
      >
        <Textarea data-testid={`${testIdPrefix}-description`} id={`${idPrefix}-description`} rows={3} {...register('description')} />
      </FormField>
      <ProfileSourcesField
        error={errors.sources?.message}
        id={`${idPrefix}-sources`}
        onChange={(next) => {
          onEdit();
          sources.onChange(next);
        }}
        testId={`${testIdPrefix}-sources`}
        value={sources.value}
      />
    </>
  );
}

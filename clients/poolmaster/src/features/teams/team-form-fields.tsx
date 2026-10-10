import type { UseFormReturn } from 'react-hook-form';
import { FormField, IconPalette, Input } from '@/features/shared/ui';
import type { TeamFormValues } from './team-form-schema';
import { TEAM_ICON_OPTIONS } from './team-icon-catalog';
import { TeamIcon } from './team-icon';

/** The name field and icon palette shared by Create team and Edit team. */
export function TeamFormFields({
  disabled,
  form,
  idPrefix,
}: {
  disabled: boolean;
  form: UseFormReturn<TeamFormValues>;
  /** Prefixes the field ids and test ids, e.g. `edit-team`. */
  idPrefix: string;
}) {
  const iconKey = form.watch('iconKey');

  return (
    <>
      <FormField error={form.formState.errors.name?.message} id={`${idPrefix}-name`} label="Team name">
        <Input
          data-testid={`${idPrefix}-name`}
          disabled={disabled}
          id={`${idPrefix}-name`}
          maxLength={100}
          type="text"
          {...form.register('name')}
        />
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Icon</legend>
        <IconPalette
          aria-label="Team icon"
          disabled={disabled}
          onSelect={(key) => form.setValue('iconKey', key, { shouldDirty: true })}
          optionTestIdPrefix="team-icon"
          options={TEAM_ICON_OPTIONS}
          renderOptionIcon={(icon) => (
            <div className="flex justify-center">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${icon.themeClass}`}>
                <TeamIcon iconKey={icon.key} size="sm" />
              </span>
            </div>
          )}
          testId="team-icon-palette"
          value={iconKey}
        />
      </fieldset>
    </>
  );
}

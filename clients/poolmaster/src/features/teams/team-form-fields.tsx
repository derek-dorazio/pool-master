import type { UseFormReturn } from 'react-hook-form';
import { FormField, IconPalette, Input } from '@/features/shared/ui';
import type { TeamFormValues } from './team-form-schema';
import { TEAM_ICON_OPTIONS } from './team-icon-catalog';
import { TeamAvatar } from './team-avatar';

/** The name field and icon palette shared by Create team and Edit team. */
export function TeamFormFields({
  disabled,
  form,
  idPrefix,
  isViewerOwn,
}: {
  disabled: boolean;
  form: UseFormReturn<TeamFormValues>;
  /** Prefixes the field ids and test ids, e.g. `edit-team`. */
  idPrefix: string;
  /** Whether the viewer is naming their own squad ("Your name") or a commissioner someone else's. */
  isViewerOwn: boolean;
}) {
  const iconKey = form.watch('iconKey');

  return (
    <>
      <FormField error={form.formState.errors.name?.message} id={`${idPrefix}-name`} label={isViewerOwn ? 'Your name in this league' : 'Name in this league'}>
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
        <legend className="text-sm font-medium text-foreground">{isViewerOwn ? 'Your icon' : 'Icon'}</legend>
        <IconPalette
          aria-label={isViewerOwn ? 'Your icon' : 'Icon'}
          disabled={disabled}
          onSelect={(key) => form.setValue('iconKey', key, { shouldDirty: true })}
          optionTestIdPrefix="team-icon"
          options={TEAM_ICON_OPTIONS}
          renderOptionIcon={(icon) => (
            <div className="flex justify-center">
              <TeamAvatar iconKey={icon.key} />
            </div>
          )}
          testId="team-icon-palette"
          value={iconKey}
        />
      </fieldset>
    </>
  );
}

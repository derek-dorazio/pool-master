import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useController, useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  explicitOrderValues,
  PlatformTierProfileLastTier,
  PlatformTierProfileLastTierOrder,
  TierProfileType,
  TierProfileTypeOrder,
} from '@poolmaster/shared/domain';
import { createPlatformTierProfile, updatePlatformTierProfile, type PlatformTierProfileDto } from '@/lib/api';
import { Button, FormField, Input, Select, useMutationActionWorkflow } from '@/features/shared/ui';
import { hasErrorCode, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { clearsSaveError } from './clears-save-error';
import type { ProfileEditorProps } from './profile-dialog';
import { ProfileFormModal } from './profile-form-modal';
import { formValuesOf, LAST_TIER_MAX_BLANK, NEW_RANGE, requestOf, tierProfileResolver, type TierProfileFormValues } from './tier-profile-form';
import { enumLabel } from '@poolmaster/shared/display-strings';

/** A blank number box is no value (null), not zero. */
const nullableNumber = (value: unknown) => (value === '' || value === null || value === undefined ? null : Number(value));

/**
 * A tier profile's dialog (#1849): its view, then its form on Edit, or a new one's form. Save
 * writes the whole profile and hands back what the server saved; a refusal (a taken code or name, a bad
 * layout) stays in the dialog.
 */
export function PlatformTierProfileEditor(dialog: ProfileEditorProps<PlatformTierProfileDto>) {
  const { onSaved, profile } = dialog;
  const form = useForm<TierProfileFormValues>({
    // A refused layout (PLATFORM_TIER_PROFILE_INVALID) shows under the cap for equal groups, and
    // above the form, with the server's reason, for ranges.
    resolver: tierProfileResolver,
    defaultValues: formValuesOf(profile),
  });
  const rangeRows = useFieldArray({ control: form.control, name: 'ranges' });
  const save = useMutationActionWorkflow({
    action: async (values: TierProfileFormValues) => {
      const body = requestOf(values);
      const response = profile
        ? await updatePlatformTierProfile({ path: { profileId: profile.id }, body })
        : await createPlatformTierProfile({ body });
      if (!response.data?.platformTierProfile) {
        throwApiError(response.error, 'Tier profile response is missing data.');
      }
      return response.data.platformTierProfile;
    },
    invalidateQueries: [QueryKeys.rootAdmin.platformTierProfiles],
    onSuccess: onSaved,
    successToast: { title: 'Tier profile saved', tone: 'success' },
  });
  const { errors } = form.formState;
  const type = useWatch({ control: form.control, name: 'type' });
  const isRanges = type === TierProfileType.RANGES;
  const isCapped = form.watch('lastTier') === PlatformTierProfileLastTier.CAPPED;
  const clearError = clearsSaveError(save);
  const sources = useController({ control: form.control, name: 'sources' });
  // The save sends a cap only for a capped last tier, so the one equal-groups refusal this form
  // can meet is a capped last tier left without its most, and it shows under that field.
  const capRefused = !isRanges && hasErrorCode(save.error, 'PLATFORM_TIER_PROFILE_INVALID');

  return (
    <ProfileFormModal
      dialog={dialog}
      errorFallback="We could not save the tier profile."
      fieldRefusal={isRanges ? undefined : 'PLATFORM_TIER_PROFILE_INVALID'}
      form={form}
      formValues={formValuesOf(profile)}
      identity={{ errors, onEdit: clearError, register: (field) => form.register(field, { onChange: clearError }), sources: sources.field }}
      kind="tier"
      save={save}
      newTitle="New tier profile"
    >
      <>
        <FormField id="tier-profile-type" label="Tiers by">
          <Select data-testid="root-admin-tier-profile-editor-type" id="tier-profile-type" {...form.register('type', { onChange: clearError })}>
            {explicitOrderValues(TierProfileTypeOrder).map((option) => (
              <option key={option} value={option}>{enumLabel('TierProfileType', option)}</option>
            ))}
          </Select>
        </FormField>
        {isRanges ? (
          <div className="grid gap-2" data-testid="root-admin-tier-profile-editor-ranges">
            {rangeRows.fields.map((row, index) => (
              <div className="flex items-end gap-2" data-testid={`root-admin-tier-profile-editor-range-${String(index)}`} key={row.id}>
                <FormField className="flex-1" error={errors.ranges?.[index]?.fromValue?.message} label={`Tier ${String(index + 1)} from`}>
                  <Input data-testid={`root-admin-tier-profile-editor-range-from-${String(index)}`} step="1" type="number" {...form.register(`ranges.${index}.fromValue`, { valueAsNumber: true, onChange: clearError })} />
                </FormField>
                <FormField className="flex-1" error={errors.ranges?.[index]?.toValue?.message} label="to" helperText={index === rangeRows.fields.length - 1 ? 'Blank: and everyone after' : undefined}>
                  <Input data-testid={`root-admin-tier-profile-editor-range-to-${String(index)}`} step="1" type="number" {...form.register(`ranges.${index}.toValue`, { setValueAs: nullableNumber, onChange: clearError })} />
                </FormField>
                <Button aria-label={`Move tier ${String(index + 1)} up`} disabled={index === 0} onClick={() => rangeRows.move(index, index - 1)} size="xs" type="button" variant="icon">
                  <ArrowUp aria-hidden size={14} />
                </Button>
                <Button aria-label={`Move tier ${String(index + 1)} down`} disabled={index === rangeRows.fields.length - 1} onClick={() => rangeRows.move(index, index + 1)} size="xs" type="button" variant="icon">
                  <ArrowDown aria-hidden size={14} />
                </Button>
                <Button aria-label={`Remove tier ${String(index + 1)}`} data-testid={`root-admin-tier-profile-editor-range-remove-${String(index)}`} disabled={rangeRows.fields.length === 1} onClick={() => rangeRows.remove(index)} size="xs" type="button" variant="icon">
                  <X aria-hidden size={14} />
                </Button>
              </div>
            ))}
            <div>
              <Button data-testid="root-admin-tier-profile-editor-range-add" onClick={() => rangeRows.append(NEW_RANGE)} size="sm" type="button" variant="secondary">
                Add a tier
              </Button>
            </div>
          </div>
        ) : (
        <>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={errors.tierCount?.message} id="tier-profile-tier-count" label="Tiers">
            <Input data-testid="root-admin-tier-profile-editor-tier-count" id="tier-profile-tier-count" step="1" type="number" {...form.register('tierCount', { valueAsNumber: true, onChange: clearError })} />
          </FormField>
          <FormField error={errors.tierSize?.message} id="tier-profile-tier-size" label="Per tier">
            <Input data-testid="root-admin-tier-profile-editor-tier-size" id="tier-profile-tier-size" step="1" type="number" {...form.register('tierSize', { valueAsNumber: true, onChange: clearError })} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="tier-profile-last-tier" label="Last tier">
            <Select
              data-testid="root-admin-tier-profile-editor-last-tier"
              id="tier-profile-last-tier"
              {...form.register('lastTier', {
                onChange: (event: { target: { value: string } }) => {
                  clearError();
                  // Capped asks for the most it takes; All remaining takes none.
                  form.setValue('lastTierMax', event.target.value === PlatformTierProfileLastTier.CAPPED ? (profile?.type === TierProfileType.EQUAL_GROUPS ? profile.lastTierMax : null) : null);
                },
              })}
            >
              {explicitOrderValues(PlatformTierProfileLastTierOrder).map((lastTier) => (
                <option key={lastTier} value={lastTier}>{enumLabel('PlatformTierProfileLastTier', lastTier)}</option>
              ))}
            </Select>
          </FormField>
          {isCapped ? (
            <FormField error={errors.lastTierMax?.message ?? (capRefused ? LAST_TIER_MAX_BLANK : undefined)} id="tier-profile-last-tier-max" label="Most in the last tier">
              <Input
                data-testid="root-admin-tier-profile-editor-last-tier-max"
                id="tier-profile-last-tier-max"
                step="1"
                type="number"
                // A blank box (or the null a switch to Capped starts it on) is no cap yet, not zero.
                {...form.register('lastTierMax', { setValueAs: nullableNumber, onChange: clearError })}
              />
            </FormField>
          ) : null}
        </div>
        </>
        )}
      </>
    </ProfileFormModal>
  );
}

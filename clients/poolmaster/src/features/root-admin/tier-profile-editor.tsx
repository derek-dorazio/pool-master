import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { explicitOrderValues, PlatformTierProfileLastTier, PlatformTierProfileLastTierOrder } from '@poolmaster/shared/domain';
import { PlatformTierProfileWriteRequestSchema } from '@poolmaster/shared/dto';
import { createPlatformTierProfile, updatePlatformTierProfile, type PlatformTierProfileDto, type PlatformTierProfileWriteRequest } from '@/lib/api';
import { FormField, Input, Select, useMutationActionWorkflow } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { numberFieldErrors } from '@/lib/number-field-errors';
import { QueryKeys } from '@/lib/query-keys';
import { clearsSaveError } from './clears-save-error';
import type { ProfileEditorProps } from './profile-dialog';
import { ProfileFormModal } from './profile-form-modal';
import { enumLabel } from '@poolmaster/shared/display-strings';

const { shape } = PlatformTierProfileWriteRequestSchema;
const countRange = (min: number, max: number) => `From ${min} to ${max}.`;

const tierErrors = numberFieldErrors({
  tierCount: { schema: shape.tierCount, range: countRange, blank: 'Enter how many tiers.', whole: 'Whole numbers only.' },
  tierSize: { schema: shape.tierSize, range: countRange, blank: 'Enter how many go in each tier.', whole: 'Whole numbers only.' },
  lastTierMax: { schema: shape.lastTierMax.unwrap(), range: countRange, blank: 'Enter the most the last tier takes.', whole: 'Whole numbers only.' },
});


const NEW_PROFILE: PlatformTierProfileWriteRequest = { code: '', name: '', tierCount: 6, tierSize: 10, lastTier: PlatformTierProfileLastTier.ALL_REMAINING, lastTierMax: null };

function formValuesOf(profile: PlatformTierProfileDto | null): PlatformTierProfileWriteRequest {
  return profile
    ? { code: profile.code, name: profile.name, tierCount: profile.tierCount, tierSize: profile.tierSize, lastTier: profile.lastTier, lastTierMax: profile.lastTierMax }
    : NEW_PROFILE;
}

/**
 * A tier profile's dialog (#1849): its view, then its form on Edit, or a new one's form. Save
 * writes the whole profile and hands back what the server saved; a refusal (a taken code or name, a bad
 * layout) stays in the dialog.
 */
export function PlatformTierProfileEditor(dialog: ProfileEditorProps<PlatformTierProfileDto>) {
  const { onSaved, profile } = dialog;
  const form = useForm<PlatformTierProfileWriteRequest>({
    // The request's own shape. Whether the layout can be used (a capped last tier needs the most
    // it takes) is the server's call: its PLATFORM_TIER_PROFILE_INVALID refusal shows in the form.
    resolver: zodResolver(PlatformTierProfileWriteRequestSchema, { error: tierErrors }),
    defaultValues: formValuesOf(profile),
  });
  const save = useMutationActionWorkflow({
    action: async (values: PlatformTierProfileWriteRequest) => {
      const body = { ...values, lastTierMax: values.lastTier === PlatformTierProfileLastTier.CAPPED ? values.lastTierMax : null };
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
  const isCapped = form.watch('lastTier') === PlatformTierProfileLastTier.CAPPED;
  const clearError = clearsSaveError(save);

  return (
    <ProfileFormModal
      dialog={dialog}
      errorFallback="We could not save the tier profile."
      form={form}
      formValues={formValuesOf(profile)}
      save={save}
      saveTestId="root-admin-tier-profile-editor-save"
      testId="root-admin-tier-profile-dialog"
      newTitle="New tier profile"
    >
      <div className="space-y-4">
        <FormField error={errors.code?.message} id="tier-profile-code" label="Code">
          <Input data-testid="root-admin-tier-profile-editor-code" id="tier-profile-code" {...form.register('code', { onChange: clearError })} />
        </FormField>
        <FormField error={errors.name?.message} id="tier-profile-name" label="Name">
          <Input data-testid="root-admin-tier-profile-editor-name" id="tier-profile-name" {...form.register('name', { onChange: clearError })} />
        </FormField>
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
                  form.setValue('lastTierMax', event.target.value === PlatformTierProfileLastTier.CAPPED ? (profile?.lastTierMax ?? null) : null);
                },
              })}
            >
              {explicitOrderValues(PlatformTierProfileLastTierOrder).map((lastTier) => (
                <option key={lastTier} value={lastTier}>{enumLabel('PlatformTierProfileLastTier', lastTier)}</option>
              ))}
            </Select>
          </FormField>
          {isCapped ? (
            <FormField error={errors.lastTierMax?.message} id="tier-profile-last-tier-max" label="Most in the last tier">
              <Input
                data-testid="root-admin-tier-profile-editor-last-tier-max"
                id="tier-profile-last-tier-max"
                step="1"
                type="number"
                // A blank box (or the null a switch to Capped starts it on) is no cap yet, not zero.
                {...form.register('lastTierMax', { setValueAs: (value: unknown) => (value === '' || value === null || value === undefined ? null : Number(value)), onChange: clearError })}
              />
            </FormField>
          ) : null}
        </div>
      </div>
    </ProfileFormModal>
  );
}

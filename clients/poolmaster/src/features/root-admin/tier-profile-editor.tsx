import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { explicitOrderValues, findTierLayoutProblem, TierProfileLastTier, TierProfileLastTierOrder } from '@poolmaster/shared/domain';
import { TierProfileWriteRequestSchema } from '@poolmaster/shared/dto';
import { createTierProfile, updateTierProfile, type TierProfileDto, type TierProfileWriteRequest } from '@/lib/api';
import { FormField, Input, Select, useMutationActionWorkflow } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { numberFieldErrors } from '@/lib/number-field-errors';
import { QueryKeys } from '@/lib/query-keys';
import { clearsSaveError } from './clears-save-error';
import type { ProfileEditorProps } from './profile-dialog';
import { ProfileFormModal } from './profile-form-modal';
import { LAST_TIER_LABELS } from './tier-profile-format';

const { shape } = TierProfileWriteRequestSchema;
const countRange = (min: number, max: number) => `From ${min} to ${max}.`;

const tierErrors = numberFieldErrors({
  tierCount: { schema: shape.tierCount, range: countRange, blank: 'Enter how many tiers.', whole: 'Whole numbers only.' },
  tierSize: { schema: shape.tierSize, range: countRange, blank: 'Enter how many go in each tier.', whole: 'Whole numbers only.' },
  lastTierMax: { schema: shape.lastTierMax.unwrap(), range: countRange, blank: 'Enter the most the last tier takes.', whole: 'Whole numbers only.' },
});

/** The server's own checks, with a capped last tier's most it takes asked for only when Capped. */
const TierProfileFormSchema = TierProfileWriteRequestSchema.superRefine((values, context) => {
  const problem = findTierLayoutProblem(values);
  if (problem) context.addIssue({ code: 'custom', path: ['lastTierMax'], message: problem });
});

const NEW_PROFILE: TierProfileWriteRequest = { name: '', tierCount: 6, tierSize: 10, lastTier: TierProfileLastTier.ALL_REMAINING, lastTierMax: null };

function formValuesOf(profile: TierProfileDto | null): TierProfileWriteRequest {
  return profile
    ? { name: profile.name, tierCount: profile.tierCount, tierSize: profile.tierSize, lastTier: profile.lastTier, lastTierMax: profile.lastTierMax }
    : NEW_PROFILE;
}

/**
 * A tier profile's dialog (#1849): its view, then its form on Edit, or a new one's form. Save
 * writes the whole profile and hands back what the server saved; a refusal (a taken name, a bad
 * layout) stays in the dialog.
 */
export function TierProfileEditor(dialog: ProfileEditorProps<TierProfileDto>) {
  const { onSaved, profile } = dialog;
  const form = useForm<TierProfileWriteRequest>({
    resolver: zodResolver(TierProfileFormSchema, { error: tierErrors }),
    defaultValues: formValuesOf(profile),
  });
  const save = useMutationActionWorkflow({
    action: async (values: TierProfileWriteRequest) => {
      const body = { ...values, lastTierMax: values.lastTier === TierProfileLastTier.CAPPED ? values.lastTierMax : null };
      const response = profile
        ? await updateTierProfile({ path: { profileId: profile.id }, body })
        : await createTierProfile({ body });
      if (!response.data?.tierProfile) {
        throwApiError(response.error, 'Tier profile response is missing data.');
      }
      return response.data.tierProfile;
    },
    invalidateQueries: [QueryKeys.rootAdmin.tierProfiles],
    onSuccess: onSaved,
    successToast: { title: 'Tier profile saved', tone: 'success' },
  });
  const { errors } = form.formState;
  const isCapped = form.watch('lastTier') === TierProfileLastTier.CAPPED;
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
                  form.setValue('lastTierMax', event.target.value === TierProfileLastTier.CAPPED ? (profile?.lastTierMax ?? null) : null);
                },
              })}
            >
              {explicitOrderValues(TierProfileLastTierOrder).map((lastTier) => (
                <option key={lastTier} value={lastTier}>{LAST_TIER_LABELS[lastTier]}</option>
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

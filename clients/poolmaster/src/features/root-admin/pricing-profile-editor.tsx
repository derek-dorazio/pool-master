import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { findBudgetPricingProblem, formatDollars } from '@poolmaster/shared/domain';
import { PricingProfileWriteRequestSchema } from '@poolmaster/shared/dto';
import { createPricingProfile, updatePricingProfile, type PricingProfileDto, type PricingProfileWriteRequest } from '@/lib/api';
import { FormField, Input, useMutationActionWorkflow } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { numberFieldErrors } from '@/lib/number-field-errors';
import { QueryKeys } from '@/lib/query-keys';
import { clearsSaveError } from './clears-save-error';
import type { ProfileEditorProps } from './profile-dialog';
import { ProfileFormModal } from './profile-form-modal';

const { shape } = PricingProfileWriteRequestSchema;
const dollarsRange = (min: number, max: number) => `From ${formatDollars(min)} to ${formatDollars(max)}.`;
const shareRange = (min: number, max: number) => `From ${min}% to ${max}% of the cap.`;

const pricingErrors = numberFieldErrors({
  salaryCap: { schema: shape.salaryCap, range: dollarsRange, blank: 'Enter a salary cap.', whole: 'Whole dollars only.' },
  unit: { schema: shape.unit, range: dollarsRange, blank: 'Enter a rounding unit.', whole: 'Whole dollars only.' },
  topSharePercent: { schema: shape.topSharePercent, range: shareRange, blank: 'Enter a share of the cap.' },
  floorSharePercent: { schema: shape.floorSharePercent, range: shareRange, blank: 'Enter a share of the cap.' },
  steepness: { schema: shape.steepness, range: (min, max) => `From ${min} to ${max}.`, blank: 'Enter a steepness.' },
});

/** The server's own checks: values that agree with each other. */
const PricingProfileFormSchema = PricingProfileWriteRequestSchema.superRefine((values, context) => {
  const problem = findBudgetPricingProblem(values);
  if (problem) context.addIssue({ code: 'custom', path: ['floorSharePercent'], message: problem });
});

const NUMBER_FIELDS = [
  { key: 'salaryCap', label: 'Salary cap ($)', step: '1' },
  { key: 'unit', label: 'Unit ($)', step: '1' },
  { key: 'topSharePercent', label: 'Top share (% of cap)', step: 'any' },
  { key: 'floorSharePercent', label: 'Floor share (% of cap)', step: 'any' },
  { key: 'steepness', label: 'Steepness', step: 'any' },
] as const;

const NEW_PROFILE: PricingProfileWriteRequest = { name: '', salaryCap: 50_000, unit: 100, topSharePercent: 24, floorSharePercent: 12, steepness: 4 };

function formValuesOf(profile: PricingProfileDto | null): PricingProfileWriteRequest {
  return profile
    ? {
      name: profile.name,
      salaryCap: profile.salaryCap,
      unit: profile.unit,
      topSharePercent: profile.topSharePercent,
      floorSharePercent: profile.floorSharePercent,
      steepness: profile.steepness,
    }
    : NEW_PROFILE;
}

/**
 * A pricing profile's dialog (#1849): its view, then its form on Edit, or a new one's form. Save
 * writes the whole profile and hands back what the server saved; a refusal (a taken name, values
 * that disagree) stays in the dialog.
 */
export function PricingProfileEditor(dialog: ProfileEditorProps<PricingProfileDto>) {
  const { onSaved, profile } = dialog;
  const form = useForm<PricingProfileWriteRequest>({
    resolver: zodResolver(PricingProfileFormSchema, { error: pricingErrors }),
    defaultValues: formValuesOf(profile),
  });
  const save = useMutationActionWorkflow({
    action: async (body: PricingProfileWriteRequest) => {
      const response = profile
        ? await updatePricingProfile({ path: { profileId: profile.id }, body })
        : await createPricingProfile({ body });
      if (!response.data?.pricingProfile) {
        throwApiError(response.error, 'Pricing profile response is missing data.');
      }
      return response.data.pricingProfile;
    },
    invalidateQueries: [QueryKeys.rootAdmin.pricingProfiles],
    onSuccess: onSaved,
    successToast: { title: 'Pricing profile saved', tone: 'success' },
  });
  const { errors } = form.formState;
  const clearError = clearsSaveError(save);

  return (
    <ProfileFormModal
      dialog={dialog}
      errorFallback="We could not save the pricing profile."
      form={form}
      formValues={formValuesOf(profile)}
      save={save}
      saveTestId="root-admin-pricing-profile-editor-save"
      testId="root-admin-pricing-profile-dialog"
      newTitle="New pricing profile"
    >
      <div className="space-y-4">
        <FormField error={errors.name?.message} id="pricing-profile-name" label="Name">
          <Input data-testid="root-admin-pricing-profile-editor-name" id="pricing-profile-name" {...form.register('name', { onChange: clearError })} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBER_FIELDS.map((field) => (
            <FormField error={errors[field.key]?.message} id={`pricing-profile-${field.key}`} key={field.key} label={field.label}>
              <Input
                data-testid={`root-admin-pricing-profile-editor-${field.key}`}
                id={`pricing-profile-${field.key}`}
                step={field.step}
                type="number"
                {...form.register(field.key, { valueAsNumber: true, onChange: clearError })}
              />
            </FormField>
          ))}
        </div>
      </div>
    </ProfileFormModal>
  );
}

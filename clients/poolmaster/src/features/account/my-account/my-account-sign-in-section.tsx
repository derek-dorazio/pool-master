import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { type z } from 'zod';
import { UserPasswordChangeRequestSchema } from '@poolmaster/shared/dto';
import { changeUserPassword } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { Button, FormField, FormModal, PasswordInput, SettingsRow, SettingsSection, showToast } from '@/features/shared/ui';
import { SELF_USER_ID } from '../user-routing';
import { ACCOUNT_ACTION_ERROR } from './my-account-helpers';
import { useSectionDialog } from './use-section-dialog';

type PasswordFormValues = z.infer<typeof UserPasswordChangeRequestSchema>;

const EMPTY_PASSWORDS: PasswordFormValues = { currentPassword: '', newPassword: '', confirmNewPassword: '' };

/** My account › Sign-in: the password, with a Change action that opens its dialog. */
export function MyAccountSignInSection() {
  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(UserPasswordChangeRequestSchema),
    mode: 'onSubmit',
    defaultValues: EMPTY_PASSWORDS,
  });
  const [currentPassword, newPassword, confirmNewPassword] = useWatch({
    control: form.control,
    name: ['currentPassword', 'newPassword', 'confirmNewPassword'],
  });

  const mutation = useInvalidatingMutation({
    mutationFn: async (values: PasswordFormValues) => {
      const response = await changeUserPassword({ path: { userId: SELF_USER_ID }, body: values });
      if (!response.data?.success) {
        throwApiError(response.error, 'Password-change response is missing data.');
      }
      return response.data;
    },
    onSuccess: () => {
      form.reset(EMPTY_PASSWORDS);
      dialog.close();
      showToast({ title: 'Password changed', tone: 'success' });
    },
    invalidates: [],
  });

  const dialog = useSectionDialog({ form, mutation, valuesNow: () => EMPTY_PASSWORDS });

  const isPending = mutation.isPending;
  const resetOnEdit = { onChange: () => mutation.reset() };

  return (
    <>
      <SettingsSection testId="my-account-sign-in" title="Sign-in">
        <SettingsRow
          action={(
            <Button aria-label="Change password" data-testid="my-account-password-change" onClick={dialog.openDialog} size="sm" variant="secondary">
              Change
            </Button>
          )}
          label="Password"
          testId="my-account-password"
        />
      </SettingsSection>

      <FormModal
        canSave={!isPending && currentPassword.length > 0 && newPassword.length >= 8 && confirmNewPassword.length >= 8}
        description="You'll stay signed in here and be signed out on your other devices."
        errorMessage={mutation.isError ? extractErrorMessage(mutation.error, { fallback: ACCOUNT_ACTION_ERROR }) : null}
        {...dialog.modalProps}
        saveLabel="Change password"
        saveTestId="my-account-password-save"
        size="sm"
        testId="my-account-password-dialog"
        title="Change password"
      >
        <div className="space-y-4">
          <FormField error={form.formState.errors.currentPassword?.message} label="Current password">
            <PasswordInput autoComplete="current-password" data-testid="my-account-current-password" disabled={isPending} {...form.register('currentPassword', resetOnEdit)} />
          </FormField>
          <FormField error={form.formState.errors.newPassword?.message} label="New password">
            <PasswordInput autoComplete="new-password" data-testid="my-account-new-password" disabled={isPending} {...form.register('newPassword', resetOnEdit)} />
          </FormField>
          <FormField error={form.formState.errors.confirmNewPassword?.message} label="Confirm new password">
            <PasswordInput autoComplete="new-password" data-testid="my-account-confirm-password" disabled={isPending} {...form.register('confirmNewPassword', resetOnEdit)} />
          </FormField>
        </div>
      </FormModal>
    </>
  );
}

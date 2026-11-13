import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { type z } from 'zod';
import { UserProfileUpdateRequestSchema, UserUsernameUpdateRequestSchema } from '@poolmaster/shared/dto';
import { updateUserProfile, updateUserUsername, type UserDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { AUTH_ME_QUERY_KEY, setAuthSessionUser } from '@/features/auth/auth-session-cache';
import { FormField, FormModal, Input, SectionCard, SectionRow, SectionRows, showToast } from '@/features/shared/ui';
import { formatUserName } from '../user-name';
import { useSectionDialog } from './use-section-dialog';
import { SELF_USER_ID } from '../user-routing';

const ProfileFormSchema = UserProfileUpdateRequestSchema.extend(UserUsernameUpdateRequestSchema.shape);
type ProfileFormValues = z.infer<typeof ProfileFormSchema>;

const PROFILE_FIELDS = [
  { name: 'firstName', label: 'First name', autoComplete: 'given-name', testId: 'my-account-first-name', wide: false },
  { name: 'lastName', label: 'Last name', autoComplete: 'family-name', testId: 'my-account-last-name', wide: false },
  { name: 'email', label: 'Email', autoComplete: 'email', testId: 'my-account-email', wide: true },
  { name: 'username', label: 'Username', autoComplete: 'username', testId: 'my-account-username', wide: true },
] as const;

function valuesOf(user: UserDto): ProfileFormValues {
  return { email: user.email, firstName: user.firstName, lastName: user.lastName, username: user.username };
}

/**
 * My account › Profile: name, email and username, edited together in one dialog. Each half is
 * its own call, sent only when it changed, and the session takes each answer as it arrives, so a
 * refused username still keeps a saved name.
 */
export function MyAccountProfileSection({ user }: { user: UserDto }) {
  const queryClient = useQueryClient();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(ProfileFormSchema),
    mode: 'onSubmit',
    defaultValues: valuesOf(user),
  });
  const [email, firstName, lastName, username] = useWatch({
    control: form.control,
    name: ['email', 'firstName', 'lastName', 'username'],
  });

  const mutation = useInvalidatingMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const profile = {
        email: values.email.trim().toLowerCase(),
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
      };
      if (profile.email !== user.email || profile.firstName !== user.firstName || profile.lastName !== user.lastName) {
        const response = await updateUserProfile({ path: { userId: SELF_USER_ID }, body: profile });
        if (!response.data?.user) {
          throwApiError(response.error, 'Profile update response is missing data.');
        }
        setAuthSessionUser(queryClient, response.data.user);
      }
      const nextUsername = values.username.trim().toLowerCase();
      if (nextUsername !== user.username) {
        const response = await updateUserUsername({ path: { userId: SELF_USER_ID }, body: { username: nextUsername } });
        if (!response.data?.user) {
          throwApiError(response.error, 'Username update response is missing data.');
        }
        setAuthSessionUser(queryClient, response.data.user);
      }
    },
    onSuccess: () => {
      dialog.close();
      showToast({ title: 'Profile saved', tone: 'success' });
    },
    // A new email address is not suppressed, so the "we can't email you" notice may go.
    invalidates: [AUTH_ME_QUERY_KEY, QueryKeys.emailPreferences.detail(SELF_USER_ID)],
  });

  const dialog = useSectionDialog({ form, mutation, valuesNow: () => valuesOf(user) });
  const isPending = mutation.isPending;

  return (
    <>
      <SectionCard edit={{ onClick: dialog.openDialog, testId: "my-account-profile-edit" }} testId="my-account-profile" title="Profile">
        <SectionRows>
          <SectionRow layout="setting" name="Name" testId="my-account-profile-name" value={formatUserName(user.firstName, user.lastName)} />
          <SectionRow layout="setting" name="Email" testId="my-account-profile-email" value={user.email} />
          <SectionRow layout="setting" name="Username" testId="my-account-profile-username" value={user.username} />
        </SectionRows>
      </SectionCard>

      <FormModal
        canSave={
          !isPending
          && email.trim().length > 0
          && firstName.trim().length > 0
          && lastName.trim().length > 0
          && username.trim().length >= 3
        }
        {...dialog.modalProps}
        error={mutation.isError ? mutation.error : null}
        errorFallback="We could not save your profile."
        saveLabel="Save profile"
        saveTestId="my-account-profile-save"
        testId="my-account-profile-dialog"
        title="Edit profile"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map((field) => (
            <FormField
              className={field.wide ? 'sm:col-span-2' : undefined}
              error={form.formState.errors[field.name]?.message}
              key={field.name}
              label={field.label}
            >
              <Input
                autoComplete={field.autoComplete}
                data-testid={field.testId}
                disabled={isPending}
                type={field.name === 'email' ? 'email' : 'text'}
                {...form.register(field.name, { onChange: () => mutation.reset() })}
              />
            </FormField>
          ))}
        </div>
      </FormModal>
    </>
  );
}

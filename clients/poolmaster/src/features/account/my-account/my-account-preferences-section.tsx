import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Controller, type RefCallBack, useForm } from 'react-hook-form';
import { type z } from 'zod';
import { UserPreferencesUpdateRequestSchema } from '@poolmaster/shared/dto';
import { ColorScheme, TimeFormat } from '@poolmaster/shared/domain';
import { updateUserPreferences, type UserDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { AUTH_ME_QUERY_KEY, setAuthSessionUser } from '@/features/auth/auth-session-cache';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  FormField,
  FormModal,
  Input,
  localeDisplayName,
  SectionCard,
  SectionRow,
  SectionRows,
  Select,
  showToast,
  timeZoneLabel,
  TimeZoneSelect,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { SELF_USER_ID } from '../user-routing';
import { COLOR_SCHEME_LABELS, MATCH_MY_DEVICE, TIME_FORMAT_LABELS } from './my-account-helpers';
import { useSectionDialog } from './use-section-dialog';

type PreferencesFormValues = z.infer<typeof UserPreferencesUpdateRequestSchema>;

function valuesOf(user: UserDto): PreferencesFormValues {
  return {
    timezone: user.timezone ?? DEFAULT_DISPLAY_PREFERENCES.timeZone,
    locale: user.locale ?? null,
    timeFormat: user.timeFormat ?? null,
    // No choice saved means the website follows the device, so that is what the form shows.
    colorScheme: user.colorScheme ?? ColorScheme.DEVICE,
  };
}

/** My account › Preferences: the time zone, number and date style, clock and theme dates and pages use. */
export function MyAccountPreferencesSection({ user }: { user: UserDto }) {
  const queryClient = useQueryClient();
  const displayPreferences = useDisplayPreferences();
  const form = useForm<PreferencesFormValues>({
    resolver: zodResolver(UserPreferencesUpdateRequestSchema),
    mode: 'onSubmit',
    defaultValues: valuesOf(user),
  });

  const mutation = useInvalidatingMutation({
    mutationFn: async (values: PreferencesFormValues) => {
      const response = await updateUserPreferences({
        path: { userId: SELF_USER_ID },
        body: {
          timezone: values.timezone?.trim() || undefined,
          locale: values.locale?.trim() || undefined,
          timeFormat: values.timeFormat ?? undefined,
          // Sent only when the member changed it: saving other preferences must not turn
          // "no choice yet" into Match my device, since the mobile app treats the two apart.
          colorScheme: values.colorScheme === (user.colorScheme ?? ColorScheme.DEVICE) ? undefined : values.colorScheme ?? undefined,
        },
      });
      if (!response.data?.user) {
        throwApiError(response.error, 'Preferences update response is missing data.');
      }
      return response.data.user;
    },
    onSuccess: (updatedUser) => {
      setAuthSessionUser(queryClient, updatedUser);
      dialog.close();
      showToast({ title: 'Preferences saved', tone: 'success' });
    },
    invalidates: [AUTH_ME_QUERY_KEY],
  });

  const dialog = useSectionDialog({ form, mutation, valuesNow: () => valuesOf(user) });

  // A field: editing it clears the last save's failure, then stores the typed value.
  const bind = <TValue,>(
    field: { name: string; onBlur: () => void; onChange: (value: TValue) => void; ref: RefCallBack },
    toValue: (value: string) => TValue,
  ) => ({
    name: field.name,
    onBlur: field.onBlur,
    onChange: (event: { target: { value: string } }) => {
      mutation.reset();
      field.onChange(toValue(event.target.value));
    },
    ref: field.ref,
  });

  const isPending = mutation.isPending;

  return (
    <>
      <SectionCard edit={{ onClick: dialog.openDialog, testId: "my-account-preferences-edit" }} testId="my-account-preferences" title="Preferences">
        <SectionRows>
          <SectionRow
            layout="setting"
            name="Time zone"
            testId="my-account-preferences-time-zone"
            value={timeZoneLabel(user.timezone ?? DEFAULT_DISPLAY_PREFERENCES.timeZone)}
          />
          <SectionRow
            layout="setting"
            name="Number and date style"
            testId="my-account-preferences-locale"
            value={user.locale ? localeDisplayName(user.locale, displayPreferences) : MATCH_MY_DEVICE}
          />
          <SectionRow
            layout="setting"
            name="Clock"
            testId="my-account-preferences-clock"
            value={user.timeFormat ? TIME_FORMAT_LABELS[user.timeFormat] : MATCH_MY_DEVICE}
          />
          <SectionRow
            layout="setting"
            name="Theme"
            testId="my-account-preferences-theme"
            value={COLOR_SCHEME_LABELS[user.colorScheme ?? ColorScheme.DEVICE]}
          />
        </SectionRows>
      </SectionCard>

      <FormModal
        canSave={!isPending}
        {...dialog.modalProps}
        error={mutation.isError ? mutation.error : null}
        errorFallback="We could not save your preferences."
        saveLabel="Save preferences"
        saveTestId="my-account-preferences-save"
        testId="my-account-preferences-dialog"
        title="Edit preferences"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField error={form.formState.errors.timezone?.message} id="my-account-time-zone" label="Time zone">
            <Controller
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <TimeZoneSelect
                  data-testid="my-account-time-zone"
                  disabled={isPending}
                  id="my-account-time-zone"
                  {...bind(field, (value) => value)}
                  value={field.value ?? DEFAULT_DISPLAY_PREFERENCES.timeZone}
                />
              )}
            />
          </FormField>
          <FormField error={form.formState.errors.locale?.message} label="Number and date style">
            <Controller
              control={form.control}
              name="locale"
              render={({ field }) => (
                <Input
                  data-testid="my-account-locale"
                  disabled={isPending}
                  {...bind(field, (value) => (value.trim() ? value : null))}
                  placeholder="en-US"
                  value={field.value ?? ''}
                />
              )}
            />
          </FormField>
          <FormField error={form.formState.errors.timeFormat?.message} label="Clock">
            <Controller
              control={form.control}
              name="timeFormat"
              render={({ field }) => (
                <Select
                  data-testid="my-account-clock"
                  disabled={isPending}
                  {...bind(field, (value) => value || null)}
                  value={field.value ?? ''}
                >
                  <option value="">{MATCH_MY_DEVICE}</option>
                  <option value={TimeFormat.TWELVE_HOUR}>{TIME_FORMAT_LABELS[TimeFormat.TWELVE_HOUR]}</option>
                  <option value={TimeFormat.TWENTY_FOUR_HOUR}>{TIME_FORMAT_LABELS[TimeFormat.TWENTY_FOUR_HOUR]}</option>
                </Select>
              )}
            />
          </FormField>
          <FormField error={form.formState.errors.colorScheme?.message} label="Theme">
            <Controller
              control={form.control}
              name="colorScheme"
              render={({ field }) => (
                <Select
                  data-testid="my-account-theme"
                  disabled={isPending}
                  {...bind(field, (value) => value)}
                  value={field.value ?? ColorScheme.DEVICE}
                >
                  {Object.values(ColorScheme).map((scheme) => (
                    <option key={scheme} value={scheme}>{COLOR_SCHEME_LABELS[scheme]}</option>
                  ))}
                </Select>
              )}
            />
          </FormField>
        </div>
      </FormModal>
    </>
  );
}

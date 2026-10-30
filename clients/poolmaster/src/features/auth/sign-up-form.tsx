import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { RegisterRequestSchema } from "@poolmaster/shared/dto";
import { registerUser, registerWithTeamOwnerInvitation } from "@/lib/api";
import { ApiError, extractErrorMessage, throwApiError, type ExtractErrorMessageOptions } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { useInvalidatingMutation } from "@/lib/mutation-hooks";
import { QueryKeys } from "@/lib/query-keys";
import {
  Alert,
  Button,
  FormField,
  Input,
  TimeZoneSelect,
  browserTimeZone,
} from "@/features/shared/ui";
import { setAuthSessionUser, type AuthSessionUser } from "./auth-session-cache";
import { signUpWithDisplayPreferences } from "./signup-display-preferences";

const accountFields = {
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required")
    .max(50, "First name is too long"),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required")
    .max(50, "Last name is too long"),
  username: RegisterRequestSchema.shape.username,
  password: RegisterRequestSchema.shape.password,
  confirmPassword: z.string().min(8, "Please confirm your password"),
  timezone: z.string().min(1, "Time zone is required"),
};

function passwordsMatch(values: { password: string; confirmPassword: string }) {
  return values.password === values.confirmPassword;
}

const PASSWORDS_MUST_MATCH = { path: ["confirmPassword"], message: "Passwords must match" };

/** Signing up on your own: the email is yours to type. */
const accountSignUpSchema = z
  .object({ ...accountFields, email: RegisterRequestSchema.shape.email })
  .refine(passwordsMatch, PASSWORDS_MUST_MATCH);

/** Signing up on a co-owner invitation: the invitation names the email, so the form's stays empty and unchecked. */
const invitedSignUpSchema = z
  .object({ ...accountFields, email: z.string() })
  .refine(passwordsMatch, PASSWORDS_MUST_MATCH);

type SignUpFormValues = z.infer<typeof accountSignUpSchema>;

export type SignUpFormProps = {
  /** Called with the new account once it exists and its session is cached; the page decides where to go. */
  onRegistered: (user: AuthSessionUser) => void;
  submitLabel?: string;
  pendingLabel?: string;
  /**
   * Signs up against this co-owner invitation (#217): no email field, because the account takes
   * the address the commissioner invited, and the same request joins the league and the team.
   * A forwarded invite link must not admit whoever typed a different address.
   */
  teamInviteCode?: string;
  /** Words for particular server refusals on this page, such as an invitation already accepted. */
  errorMessages?: ExtractErrorMessageOptions["codeMessages"];
};

/**
 * Creating an account: name, email, username, password twice and time zone, then one request
 * that also sends the browser's locale. Used by the sign-in home and the co-owner invitation.
 */
export function SignUpForm({
  errorMessages,
  onRegistered,
  pendingLabel = "Creating account...",
  submitLabel = "Register and continue",
  teamInviteCode,
}: SignUpFormProps) {
  const logger = useMemo(() => getLogger().child({ feature: "sign-up-form" }), []);
  const queryClient = useQueryClient();
  const asksForEmail = teamInviteCode === undefined;
  const form = useForm<SignUpFormValues>({
    resolver: zodResolver(asksForEmail ? accountSignUpSchema : invitedSignUpSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      firstName: "",
      lastName: "",
      confirmPassword: "",
      timezone: browserTimeZone(),
    },
  });
  const [hasEditedUsername, setHasEditedUsername] = useState(false);
  const watchedEmail = form.watch("email");

  // The username follows the email until the member types one of their own.
  useEffect(() => {
    if (!asksForEmail || hasEditedUsername) {
      return;
    }
    form.setValue("username", watchedEmail.trim().toLowerCase(), {
      shouldDirty: false,
      shouldValidate: false,
    });
  }, [asksForEmail, form, hasEditedUsername, watchedEmail]);

  const mutation = useInvalidatingMutation({
    mutationFn: async (values: SignUpFormValues): Promise<AuthSessionUser> => {
      const account = {
        username: values.username.trim().toLowerCase(),
        password: values.password,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
      };
      const response = await signUpWithDisplayPreferences(values.timezone, (preferences) =>
        teamInviteCode === undefined
          ? registerUser({ body: { ...account, email: values.email, ...preferences } })
          : registerWithTeamOwnerInvitation({ body: { ...account, inviteCode: teamInviteCode, ...preferences } }));
      if (!response.data?.user) {
        throwApiError(response.error, "Registration response is missing data.");
      }
      return response.data.user;
    },
    onMutate: () => {
      logger.debug(
        { action: "auth.register.started", data: { hasTeamInvitation: !asksForEmail } },
        "Submitting registration request",
      );
    },
    onSuccess: (user) => {
      // The session arrives with the response, so seed the cache rather than making the new
      // member's first action a round trip to discover who they are.
      setAuthSessionUser(queryClient, user);
      logger.info(
        { action: "auth.register.succeeded", data: { userId: user.id, hasTeamInvitation: !asksForEmail } },
        "Registered a new account",
      );
      onRegistered(user);
    },
    // A co-owner invitation joins a league and a team in the same request.
    invalidates: [QueryKeys.leagues.list, QueryKeys.leagueTeams.all],
    onError: (error) => {
      const payload = { action: "auth.register.failed", data: { hasTeamInvitation: !asksForEmail }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, "Registration request was rejected");
      } else {
        logger.error(payload, "Registration failed unexpectedly");
      }
    },
  });

  return (
    <form
      className="space-y-4"
      data-testid="sign-up-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit((values) => mutation.mutateAsync(values).catch(() => undefined))();
      }}
    >
      {mutation.isError ? (
        <Alert data-testid="sign-up-error" tone="danger">
          {extractErrorMessage(mutation.error, {
            fallback: "We could not create your account. Please try again.",
            codeMessages: errorMessages,
          })}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={form.formState.errors.firstName?.message} label="First name">
          <Input {...form.register("firstName")} data-testid="sign-up-first-name" placeholder="Taylor" type="text" />
        </FormField>
        <FormField error={form.formState.errors.lastName?.message} label="Last name">
          <Input {...form.register("lastName")} data-testid="sign-up-last-name" placeholder="Commissioner" type="text" />
        </FormField>
      </div>

      {asksForEmail ? (
        <FormField error={form.formState.errors.email?.message} label="Email">
          <Input {...form.register("email")} data-testid="sign-up-email" placeholder="you@example.com" type="email" />
        </FormField>
      ) : null}

      <FormField error={form.formState.errors.username?.message} label="Username">
        <Input
          {...form.register("username", { onChange: () => setHasEditedUsername(true) })}
          data-testid="sign-up-username"
          placeholder="yourname"
          type="text"
        />
      </FormField>

      <FormField error={form.formState.errors.password?.message} label="Create password">
        <Input {...form.register("password")} data-testid="sign-up-password" placeholder="Create a password" type="password" />
      </FormField>

      <FormField error={form.formState.errors.confirmPassword?.message} label="Confirm password">
        <Input
          {...form.register("confirmPassword")}
          data-testid="sign-up-confirm-password"
          placeholder="Re-enter your password"
          type="password"
        />
      </FormField>

      <FormField
        error={form.formState.errors.timezone?.message}
        helperText="Dates and times are shown in this zone. You can change it later in your account."
        id="sign-up-time-zone"
        label="Time zone"
      >
        <Controller
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <TimeZoneSelect
              data-testid="sign-up-time-zone"
              id="sign-up-time-zone"
              name={field.name}
              onBlur={field.onBlur}
              onChange={(event) => field.onChange(event.target.value)}
              ref={field.ref}
              value={field.value}
            />
          )}
        />
      </FormField>

      <Button className="w-full" data-testid="sign-up-submit" disabled={mutation.isPending} type="submit">
        {mutation.isPending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

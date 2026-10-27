import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useNavigate } from "react-router";
import { PasswordResetConfirmRequestSchema } from "@poolmaster/shared/dto";
import { confirmPasswordReset } from "@/lib/api";
import { extractErrorMessage, hasErrorCode, throwApiError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { useInvalidatingMutation } from "@/lib/mutation-hooks";
import { FormField, FormPage, Input, LinkButton, Tile } from "@/features/shared/ui";
import { useAuth } from "./auth-context";
import { FORGOT_PASSWORD_PATH } from "./auth-paths";

const resetPasswordFormSchema = PasswordResetConfirmRequestSchema.omit({ token: true })
  .extend({
    newPassword: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
    confirmNewPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((values) => values.newPassword === values.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Passwords must match",
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

/**
 * The token rides in the link's fragment (`#token=...`), which the browser never sends to a
 * server. Read once on arrival; the page then clears it from the address bar.
 */
function readTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token?.trim() ? token : null;
}

function DeadLinkState() {
  return (
    <Tile className="mx-auto max-w-md space-y-4" padding="lg" radius="xl">
      <h2 className="title-card text-lg text-foreground">Choose a new password</h2>
      <p className="text-sm text-muted-foreground" data-testid="reset-password-link-invalid">
        This reset link has expired or has already been used.
      </p>
      <LinkButton data-testid="reset-password-send-new-link" to={FORGOT_PASSWORD_PATH}>
        Send a new link
      </LinkButton>
    </Tile>
  );
}

/**
 * Sets a new password from a reset link (#848, plans/password-recovery.md). On success every
 * session of the account is signed out, including this browser's, and the page sends the
 * person to sign in with the new password.
 */
export function ResetPasswordPage() {
  const logger = getLogger().child({ feature: "reset-password-page" });
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => readTokenFromHash(location.hash));
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { newPassword: "", confirmNewPassword: "" },
  });

  // Clears the token from the address bar, so it is not left in history or shared by copying
  // the URL. Synchronises with the browser's location, an external system.
  useEffect(() => {
    if (location.hash) {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  const confirmMutation = useInvalidatingMutation({
    mutationFn: async (values: ResetPasswordFormValues & { token: string }) => {
      const response = await confirmPasswordReset({ body: values });
      if (!response.data) {
        throwApiError(response.error, "Password reset response is missing data.");
      }
      return response.data;
    },
    onSuccess: async () => {
      // The reset signed out every session; end this browser's too, so its cached user and
      // cookies match.
      if (auth.user) {
        await auth.clearSession();
      }
    },
    onError: (error) => {
      logger.warn({ action: "auth.passwordReset.confirm.failed", err: error }, "Password reset failed");
    },
    // The session cache is cleared above; nothing else cached depends on a password.
    invalidates: [],
  });

  if (!token || hasErrorCode(confirmMutation.error, "PASSWORD_RESET_LINK_INVALID")) {
    return <DeadLinkState />;
  }

  if (confirmMutation.isSuccess) {
    return (
      <Tile className="mx-auto max-w-md space-y-4" padding="lg" radius="xl">
        <h2 className="title-card text-lg text-foreground">Password reset</h2>
        <p className="text-sm text-muted-foreground" data-testid="reset-password-done">
          Your password is reset. Sign in with your new password.
        </p>
        <LinkButton data-testid="reset-password-sign-in" to="/">
          Sign in
        </LinkButton>
      </Tile>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <FormPage
        cancelTo="/"
        description="Your new password works on every device. You'll sign in again everywhere."
        errorMessage={
          confirmMutation.isError
            ? extractErrorMessage(confirmMutation.error, {
                codeMessages: {
                  PASSWORD_RESET_RATE_LIMITED: "Too many tries. Wait a minute and try again.",
                  PASSWORD_CONFIRMATION_MISMATCH: "Passwords must match",
                },
              })
            : null
        }
        isPending={confirmMutation.isPending}
        onSubmit={(event) =>
          void form.handleSubmit((values) => confirmMutation.mutate({ ...values, token }))(event)
        }
        pendingLabel="Saving..."
        submitLabel="Set new password"
        submitTestId="reset-password-submit"
        testId="reset-password-form"
        title="Choose a new password"
      >
        <FormField error={form.formState.errors.newPassword?.message} label="New password">
          <Input
            {...form.register("newPassword")}
            autoComplete="new-password"
            data-testid="reset-password-new"
            type="password"
          />
        </FormField>
        <FormField error={form.formState.errors.confirmNewPassword?.message} label="Confirm new password">
          <Input
            {...form.register("confirmNewPassword")}
            autoComplete="new-password"
            data-testid="reset-password-confirm"
            type="password"
          />
        </FormField>
      </FormPage>
    </div>
  );
}

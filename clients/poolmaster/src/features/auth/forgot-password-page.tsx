import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PASSWORD_RESET_LINK_MINUTES, PasswordResetRequestSchema } from "@poolmaster/shared/dto";
import { requestPasswordReset } from "@/lib/api";
import { extractErrorMessage, throwApiError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { useInvalidatingMutation } from "@/lib/mutation-hooks";
import { FormField, FormPage, Input, LinkButton, Tile } from "@/features/shared/ui";

const forgotPasswordFormSchema = PasswordResetRequestSchema.extend({
  identifier: z.string().trim().min(1, "Enter your email or username").max(255),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;

/**
 * "Forgot password?" (#848, plans/password-recovery.md). Asks for an email or username and
 * always shows the same confirmation, because the API answers the same whether or not an
 * account matches.
 */
export function ForgotPasswordPage() {
  const logger = getLogger().child({ feature: "forgot-password-page" });
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { identifier: "" },
  });

  const requestMutation = useInvalidatingMutation({
    mutationFn: async (values: ForgotPasswordFormValues) => {
      const response = await requestPasswordReset({ body: { identifier: values.identifier } });
      if (!response.data) {
        throwApiError(response.error, "Password reset request response is missing data.");
      }
      return response.data;
    },
    onError: (error) => {
      logger.warn({ action: "auth.passwordReset.request.failed", err: error }, "Password reset request failed");
    },
    // Nothing cached depends on a reset request; the page switches to its sent state.
    invalidates: [],
  });

  if (requestMutation.isSuccess) {
    return (
      <Tile className="mx-auto max-w-md space-y-4" padding="lg" radius="xl">
        <h2 className="title-card text-lg text-foreground">Check your email</h2>
        <p className="text-sm text-muted-foreground" data-testid="forgot-password-sent">
          If an account matches, we&apos;ve sent a link to reset your password. The link works
          once and expires in {PASSWORD_RESET_LINK_MINUTES} minutes.
        </p>
        <LinkButton data-testid="forgot-password-back-to-sign-in" to="/" variant="secondary">
          Back to sign in
        </LinkButton>
      </Tile>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <FormPage
        cancelTo="/"
        description="Enter the email or username you sign in with. We'll email you a link to choose a new password."
        errorMessage={
          requestMutation.isError
            ? extractErrorMessage(requestMutation.error, {
                codeMessages: {
                  PASSWORD_RESET_RATE_LIMITED: "Too many tries. Wait a minute and try again.",
                },
              })
            : null
        }
        isPending={requestMutation.isPending}
        onSubmit={(event) =>
          void form.handleSubmit((values) => requestMutation.mutate(values))(event)
        }
        pendingLabel="Sending..."
        submitLabel="Send reset link"
        submitTestId="forgot-password-submit"
        testId="forgot-password-form"
        title="Reset your password"
      >
        <FormField error={form.formState.errors.identifier?.message} label="Email or username">
          <Input
            {...form.register("identifier")}
            autoComplete="username"
            data-testid="forgot-password-identifier"
            placeholder="you@example.com"
            type="text"
          />
        </FormField>
      </FormPage>
    </div>
  );
}

import { undoEmailChange } from "@/lib/api";
import { extractErrorMessage, hasErrorCode, throwApiError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { useInvalidatingMutation } from "@/lib/mutation-hooks";
import { Button, LinkButton, Notice, StatusPage } from "@/features/shared/ui";
import { useAuth } from "./auth-context";
import { FORGOT_PASSWORD_PATH } from "./auth-paths";
import { useLinkToken } from "./use-link-token";

/**
 * Puts back an account's old email address from the link in the "your email address was changed"
 * email (#903 A5). The link only opens this page; the button does the undo, so a mail scanner
 * opening the link changes nothing. The undo signs out every session, including this browser's,
 * and replaces the password with one nobody knows, so the page then sends the person to set a new
 * password, which now reaches their address.
 */
export function UndoEmailChangePage() {
  const logger = getLogger().child({ feature: "undo-email-change-page" });
  const auth = useAuth();
  const token = useLinkToken();

  const undoMutation = useInvalidatingMutation({
    mutationFn: async (linkToken: string) => {
      const response = await undoEmailChange({ body: { token: linkToken } });
      if (!response.data) {
        throwApiError(response.error, "Email change undo response is missing data.");
      }
      return response.data;
    },
    onSuccess: async () => {
      // The undo signed out every session; end this browser's too, so its cached user and
      // cookies match.
      if (auth.user) {
        await auth.clearSession();
      }
    },
    onError: (error) => {
      logger.warn({ action: "auth.emailChangeUndo.failed", err: error }, "Email change undo failed");
    },
    // The session cache is cleared above; nothing else cached is shown signed out.
    invalidates: [],
  });

  if (!token || hasErrorCode(undoMutation.error, "EMAIL_CHANGE_UNDO_LINK_INVALID")) {
    return (
      <StatusPage
        body="Links to put an address back work once, for a short time."
        bodyTestId="undo-email-change-link-invalid"
        kind="expired"
        testId="undo-email-change-dead-link"
        title="This link has expired"
      />
    );
  }

  if (undoMutation.isSuccess) {
    return (
      <StatusPage
        action={(
          <LinkButton data-testid="undo-email-change-reset-password" to={FORGOT_PASSWORD_PATH}>
            Set a new password
          </LinkButton>
        )}
        body="Everyone is signed out and the old password no longer works. Set a new one to sign in."
        bodyTestId="undo-email-change-done"
        kind="done"
        testId="undo-email-change-done-page"
        title="Your email address is back"
      />
    );
  }

  return (
    <StatusPage
      action={(
        <Button
          data-testid="undo-email-change-submit"
          disabled={undoMutation.isPending}
          onClick={() => undoMutation.mutate(token)}
        >
          {undoMutation.isPending ? "Putting it back..." : "Put my address back"}
        </Button>
      )}
      body="Everyone is signed out, you included, and you'll set a new password."
      kind="confirm"
      testId="undo-email-change-confirm"
      title="Put your email address back"
    >
      {undoMutation.isError ? (
        <Notice data-testid="undo-email-change-error" tone="danger">
          {extractErrorMessage(undoMutation.error, {
            codeMessages: {
              EMAIL_CHANGE_UNDO_ADDRESS_TAKEN:
                "Another account uses that email address now, so it can't be put back.",
              EMAIL_CHANGE_UNDO_RATE_LIMITED: "Too many tries. Wait a minute and try again.",
            },
          })}
        </Notice>
      ) : null}
    </StatusPage>
  );
}

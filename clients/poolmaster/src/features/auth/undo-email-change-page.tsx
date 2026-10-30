import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { undoEmailChange } from "@/lib/api";
import { extractErrorMessage, hasErrorCode, throwApiError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { useInvalidatingMutation } from "@/lib/mutation-hooks";
import { Alert, Button, LinkButton, PanelCard } from "@/features/shared/ui";
import { useAuth } from "./auth-context";
import { FORGOT_PASSWORD_PATH } from "./auth-paths";

/**
 * The token rides in the link's fragment (`#token=...`), which the browser never sends to a
 * server. Read once on arrival; the page then clears it from the address bar.
 */
function readTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token?.trim() ? token : null;
}

function UndoTile({ children, title }: { children: ReactNode; title: string }) {
  return (
    <PanelCard className="mx-auto max-w-md" padded title={title}>
      {children}
    </PanelCard>
  );
}

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
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => readTokenFromHash(location.hash));

  // Clears the token from the address bar, so it is not left in history or shared by copying
  // the URL. Synchronises with the browser's location, an external system.
  useEffect(() => {
    if (location.hash) {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

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
      <UndoTile title="Put your email address back">
        <p className="text-sm text-muted-foreground" data-testid="undo-email-change-link-invalid">
          This link has expired or has already been used.
        </p>
      </UndoTile>
    );
  }

  if (undoMutation.isSuccess) {
    return (
      <UndoTile title="Your email address is back">
        <p className="text-sm text-muted-foreground" data-testid="undo-email-change-done">
          {"Your account uses your old email address again. Everyone is signed out of it, and its old password no longer works. Set a new password to sign in."}
        </p>
        <LinkButton data-testid="undo-email-change-reset-password" to={FORGOT_PASSWORD_PATH}>
          Set a new password
        </LinkButton>
      </UndoTile>
    );
  }

  return (
    <UndoTile title="Put your email address back">
      <p className="text-sm text-muted-foreground">
        Your account goes back to the email address this link was sent to. Everyone is signed out of
        it, you included, and its password is cleared, so you&apos;ll set a new one.
      </p>
      {undoMutation.isError ? (
        <Alert data-testid="undo-email-change-error" tone="danger">
          {extractErrorMessage(undoMutation.error, {
            codeMessages: {
              EMAIL_CHANGE_UNDO_ADDRESS_TAKEN:
                "Another account uses that email address now, so it can't be put back.",
              EMAIL_CHANGE_UNDO_RATE_LIMITED: "Too many tries. Wait a minute and try again.",
            },
          })}
        </Alert>
      ) : null}
      <Button
        data-testid="undo-email-change-submit"
        disabled={undoMutation.isPending}
        onClick={() => undoMutation.mutate(token)}
      >
        {undoMutation.isPending ? "Putting it back..." : "Put my address back"}
      </Button>
    </UndoTile>
  );
}

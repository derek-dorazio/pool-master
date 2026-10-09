import type { ReactNode } from "react";
import { extractErrorMessage, type ExtractErrorMessageOptions } from "@/lib/errors";
import { Alert } from "./alert";
import { Button } from "./button";

export type ServerErrorDisplayProps = ExtractErrorMessageOptions & {
  action?: ReactNode;
  className?: string;
  error: Error | null | undefined;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
  title?: string;
};

export function ServerErrorBar({
  action,
  className,
  codeMessages,
  error,
  fallback,
  onRetry,
  retryLabel = "Try again",
  testId,
  title = "Something went wrong",
}: ServerErrorDisplayProps) {
  const retryAction = onRetry ? (
    <Button onClick={onRetry} size="sm" type="button" variant="secondary">
      {retryLabel}
    </Button>
  ) : null;

  return (
    <Alert
      action={action ?? retryAction}
      className={className}
      data-testid={testId}
      title={title}
      tone="danger"
    >
      <p>{extractErrorMessage(error, { codeMessages, fallback })}</p>
    </Alert>
  );
}

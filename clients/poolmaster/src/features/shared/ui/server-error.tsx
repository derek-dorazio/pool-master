import type { ReactNode } from "react";
import { extractErrorMessage, type ExtractErrorMessageOptions } from "@/lib/errors";
import { Alert } from "./alert";
import { Button } from "./button";

// Not the API's ErrorEnvelope: whatever was thrown (an ApiError, a fetch failure, an
// unknown value) probed loosely for the fields this display can show.
type ThrownErrorFields = {
  code?: unknown;
  detail?: unknown;
  error?: {
    code?: unknown;
    detail?: unknown;
    message?: unknown;
    requestId?: unknown;
  };
  message?: unknown;
  requestId?: unknown;
  status?: unknown;
};

export type ServerErrorDisplayProps = ExtractErrorMessageOptions & {
  action?: ReactNode;
  className?: string;
  error: unknown;
  includeDebugDetails?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
  title?: string;
};

function readThrownErrorFields(error: unknown): ThrownErrorFields | null {
  return error && typeof error === "object" ? (error as ThrownErrorFields) : null;
}

function readErrorCode(error: unknown) {
  const fields = readThrownErrorFields(error);
  const code = fields?.error?.code ?? fields?.code;
  return typeof code === "string" ? code : null;
}

function readRequestId(error: unknown) {
  const fields = readThrownErrorFields(error);
  const requestId = fields?.error?.requestId ?? fields?.requestId;
  return typeof requestId === "string" ? requestId : null;
}

function readStatus(error: unknown) {
  const fields = readThrownErrorFields(error);
  return typeof fields?.status === "number" ? fields.status : null;
}

function readDetail(error: unknown) {
  const fields = readThrownErrorFields(error);
  const detail = fields?.error?.detail ?? fields?.detail;
  return typeof detail === "string" ? detail : null;
}

function renderDebugDetails(error: unknown) {
  const code = readErrorCode(error);
  const requestId = readRequestId(error);
  const status = readStatus(error);
  const detail = readDetail(error);
  const details = [
    code ? `Code: ${code}` : null,
    status ? `Status: ${status}` : null,
    requestId ? `Request ID: ${requestId}` : null,
    detail ? `Detail: ${detail}` : null,
  ].filter(Boolean);

  if (details.length === 0) {
    return null;
  }

  return (
    <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
      {details.map((item) => {
        const [label, value] = item!.split(/: (.*)/s);
        return (
          <div className="flex flex-wrap gap-1" key={item}>
            <dt className="font-medium text-foreground">{label}:</dt>
            <dd>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function ServerErrorBar({
  action,
  className,
  codeMessages,
  error,
  fallback,
  includeDebugDetails = false,
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
      {includeDebugDetails ? renderDebugDetails(error) : null}
    </Alert>
  );
}

export function ServerErrorPanel(props: ServerErrorDisplayProps) {
  return <ServerErrorBar {...props} />;
}

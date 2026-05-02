import type { ReactNode } from "react";
import { extractErrorMessage, type ExtractErrorMessageOptions } from "@/lib/errors";
import { Alert } from "./alert";
import { Button } from "./button";

type ErrorEnvelope = {
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

function readErrorEnvelope(error: unknown): ErrorEnvelope | null {
  return error && typeof error === "object" ? (error as ErrorEnvelope) : null;
}

function readErrorCode(error: unknown) {
  const envelope = readErrorEnvelope(error);
  const code = envelope?.error?.code ?? envelope?.code;
  return typeof code === "string" ? code : null;
}

function readRequestId(error: unknown) {
  const envelope = readErrorEnvelope(error);
  const requestId = envelope?.error?.requestId ?? envelope?.requestId;
  return typeof requestId === "string" ? requestId : null;
}

function readStatus(error: unknown) {
  const envelope = readErrorEnvelope(error);
  return typeof envelope?.status === "number" ? envelope.status : null;
}

function readDetail(error: unknown) {
  const envelope = readErrorEnvelope(error);
  const detail = envelope?.error?.detail ?? envelope?.detail;
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

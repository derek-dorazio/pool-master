import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { Tile } from "./tile";

export type FormEditorSectionProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  errorMessage?: ReactNode;
  footer?: ReactNode;
  testId?: string;
  title: ReactNode;
};

export function FormEditorSection({
  actions,
  children,
  className,
  description,
  errorMessage,
  footer,
  testId,
  title,
}: FormEditorSectionProps) {
  return (
    <Tile className={className} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Heading level={2} variant="card" size="xl">{title}</Heading>
          {description ? (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>

      <div className="mt-5">{children}</div>

      {errorMessage ? (
        <p className="mt-4 text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      ) : null}

      {footer ? (
        <div className="mt-5 flex flex-wrap justify-end gap-3">{footer}</div>
      ) : null}
    </Tile>
  );
}

export type PublicInviteJoinPageProps = {
  children: ReactNode;
  className?: string;
  context?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  testId?: string;
  title: ReactNode;
};

export function PublicInviteJoinPage({
  children,
  className,
  context,
  primaryAction,
  secondaryAction,
  testId,
  title,
}: PublicInviteJoinPageProps) {
  return (
    <main
      className={cn("mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10", className)}
      data-testid={testId}
    >
      <Tile className="w-full" padding="lg">
        <Heading level={1} variant="page">
          {title}
        </Heading>
        {context ? <div className="mt-5">{context}</div> : null}
        <div className="mt-6">{children}</div>
        {primaryAction || secondaryAction ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {primaryAction}
            {secondaryAction}
          </div>
        ) : null}
      </Tile>
    </main>
  );
}

import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Heading } from "./heading";
import { Tile } from "./tile";

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
      <Tile className="w-full" padding="lg" radius="panel">
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

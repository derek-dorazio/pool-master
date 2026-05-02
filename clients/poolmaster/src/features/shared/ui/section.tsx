import type { ReactNode } from "react";
import { cn } from "./class-names";

type PageSectionProps = {
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function PageSection({ children, className, testId }: PageSectionProps) {
  return (
    <section className={cn("space-y-5", className)} data-testid={testId}>
      {children}
    </section>
  );
}

type SectionActionsProps = {
  children: ReactNode;
  className?: string;
};

export function SectionActions({ children, className }: SectionActionsProps) {
  return <div className={cn("flex flex-wrap gap-3", className)}>{children}</div>;
}

type SectionHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function SectionHeader({
  actions,
  className,
  description,
  title,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="font-medium text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <SectionActions>{actions}</SectionActions> : null}
    </div>
  );
}

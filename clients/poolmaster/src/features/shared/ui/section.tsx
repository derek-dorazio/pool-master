import type { ReactNode } from "react";
import { cn } from "./class-names";

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
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

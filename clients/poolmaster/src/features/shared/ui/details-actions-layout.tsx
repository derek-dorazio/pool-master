import type { ReactNode } from "react";
import { cn } from "./class-names";
import { Tile } from "./tile";

type DetailsActionsLayoutProps = {
  actions: ReactNode;
  actionsClassName?: string;
  actionsListClassName?: string;
  actionsTestId?: string;
  actionsTitle?: ReactNode;
  className?: string;
  details: ReactNode;
  detailsClassName?: string;
};

export function DetailsActionsLayout({
  actions,
  actionsClassName,
  actionsListClassName,
  actionsTestId,
  actionsTitle = "Actions",
  className,
  details,
  detailsClassName,
}: DetailsActionsLayoutProps) {
  return (
    <div
      className={cn(
        "grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]",
        className,
      )}
    >
      <div className={cn("space-y-6", detailsClassName)}>{details}</div>
      <Tile className={actionsClassName} data-testid={actionsTestId} padding="md" radius="xl">
        {actionsTitle ? (
          <h3 className="text-xl font-semibold">{actionsTitle}</h3>
        ) : null}
        <div className={cn(actionsTitle ? "mt-5 space-y-3" : "space-y-3", actionsListClassName)}>
          {actions}
        </div>
      </Tile>
    </div>
  );
}

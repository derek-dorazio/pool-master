import type { ReactNode } from "react";
import { cn } from "./class-names";

type MetricGridProps = {
  children: ReactNode;
  className?: string;
};

export function MetricGrid({ children, className }: MetricGridProps) {
  return (
    // Two across on a phone, so a page's figures do not push its content a screen further down.
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4", className)}>{children}</div>
  );
}

type MetricTileProps = {
  helperText?: ReactNode;
  label: ReactNode;
  value: ReactNode;
};

export function MetricTile({ helperText, label, value }: MetricTileProps) {
  return (
    <div className="min-w-0 rounded-2xl bg-background px-3 py-3 sm:px-4 sm:py-4">
      <div className="text-xs uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      {helperText ? (
        <div className="mt-1 text-xs text-muted-foreground">{helperText}</div>
      ) : null}
    </div>
  );
}

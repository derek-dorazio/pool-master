import type { ReactNode } from "react";
import { cn } from "./class-names";

type MetricGridProps = {
  children: ReactNode;
  className?: string;
};

export function MetricGrid({ children, className }: MetricGridProps) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-3", className)}>{children}</div>
  );
}

type MetricTileProps = {
  helperText?: ReactNode;
  label: ReactNode;
  value: ReactNode;
};

export function MetricTile({ helperText, label, value }: MetricTileProps) {
  return (
    <div className="rounded-2xl bg-background px-4 py-4">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
      {helperText ? (
        <div className="mt-1 text-xs text-muted-foreground">{helperText}</div>
      ) : null}
    </div>
  );
}

type DefinitionItem = {
  label: ReactNode;
  value: ReactNode;
};

type DefinitionListProps = {
  className?: string;
  items: DefinitionItem[];
};

export function DefinitionList({ className, items }: DefinitionListProps) {
  return (
    <dl
      className={cn(
        "grid gap-3 text-sm text-muted-foreground sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item, index) => (
        <div className="rounded-2xl bg-background px-4 py-4" key={index}>
          <dt className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 font-medium text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

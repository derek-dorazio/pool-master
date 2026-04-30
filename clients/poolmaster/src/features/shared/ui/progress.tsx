import type { HTMLAttributes } from "react";
import { cn } from "./class-names";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  lines?: number;
};

export function Skeleton({ className, lines, ...props }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div className={cn("space-y-2", className)} {...props}>
        {Array.from({ length: lines }).map((_, index) => (
          <div
            className="h-4 rounded-full bg-muted"
            key={index}
            style={{ width: `${100 - index * 12}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={cn("h-4 rounded-full bg-muted", className)} {...props} />
  );
}

type ProgressIndicatorProps = {
  className?: string;
  label: string;
  max?: number;
  value: number;
};

export function ProgressIndicator({
  className,
  label,
  max = 100,
  value,
}: ProgressIndicatorProps) {
  const boundedValue = Math.min(Math.max(value, 0), max);
  const percentage = max === 0 ? 0 : Math.round((boundedValue / max) * 100);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{percentage}%</span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={boundedValue}
        className="h-3 rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

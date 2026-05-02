import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./class-names";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]",
  {
    variants: {
      tone: {
        active:
          "border-[color:var(--status-active-border)] bg-[var(--status-active-surface)] [color:var(--status-active-text)]",
        completed:
          "border-[color:var(--status-completed-border)] bg-[var(--status-completed-surface)] [color:var(--status-completed-text)]",
        danger:
          "border-[color:var(--status-danger-border)] bg-[var(--status-danger-surface)] [color:var(--status-danger-text)]",
        failed:
          "border-[color:var(--status-danger-border)] bg-[var(--status-danger-surface)] [color:var(--status-danger-text)]",
        inactive:
          "border-[color:var(--status-neutral-border)] bg-[var(--status-neutral-surface)] [color:var(--status-neutral-text)]",
        info: "border-[color:var(--status-info-border)] bg-[var(--status-info-surface)] [color:var(--status-info-text)]",
        live: "border-[color:var(--status-danger-border)] bg-[var(--status-danger-surface)] [color:var(--status-danger-text)] shadow-[var(--shadow-red-pulse)]",
        locked:
          "border-[color:var(--status-neutral-border)] bg-[var(--status-neutral-surface)] [color:var(--status-completed-text)]",
        neutral:
          "border-[color:var(--status-neutral-border)] bg-[var(--status-neutral-surface)] [color:var(--status-neutral-text)]",
        success:
          "border-[color:var(--status-active-border)] bg-[var(--status-active-surface)] [color:var(--status-active-text)]",
        warning:
          "border-[color:var(--status-warning-border)] bg-[var(--status-warning-surface)] [color:var(--status-warning-text)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({ className, tone, ...props }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ className, tone }))} {...props} />
  );
}

export function Chip({ className, tone, ...props }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        statusBadgeVariants({
          className: cn("normal-case tracking-normal", className),
          tone,
        }),
      )}
      {...props}
    />
  );
}

import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./class-names";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]",
  {
    variants: {
      tone: {
        active: "border-primary/30 bg-primary/10 text-primary",
        completed: "border-primary/30 bg-primary/10 text-primary",
        danger: "border-destructive/40 bg-destructive/10 text-destructive",
        failed: "border-destructive/40 bg-destructive/10 text-destructive",
        inactive: "border-border bg-background text-muted-foreground",
        info: "border-border bg-background text-foreground",
        live: "border-destructive/40 bg-destructive/10 text-destructive",
        locked: "border-border bg-muted/40 text-foreground",
        neutral: "border-border bg-background text-muted-foreground",
        success: "border-primary/30 bg-primary/10 text-primary",
        warning: "border-border bg-muted/40 text-foreground",
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

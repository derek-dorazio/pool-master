import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./class-names";

const alertVariants = cva("rounded-2xl border px-4 py-3 text-sm", {
  variants: {
    tone: {
      danger:
        "border-[color:var(--status-danger-border)] bg-[var(--status-danger-surface)] [color:var(--status-danger-text)]",
      info: "border-[color:var(--status-info-border)] bg-[var(--status-info-surface)] [color:var(--status-info-text)]",
      success:
        "border-[color:var(--status-active-border)] bg-[var(--status-active-surface)] [color:var(--status-active-text)]",
      warning:
        "border-[color:var(--status-warning-border)] bg-[var(--status-warning-surface)] [color:var(--status-warning-text)]",
    },
  },
  defaultVariants: {
    tone: "info",
  },
});

type AlertProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & {
    action?: ReactNode;
    title?: ReactNode;
  };

export function Alert({
  action,
  children,
  className,
  title,
  tone,
  ...props
}: AlertProps) {
  return (
    <div
      className={cn(alertVariants({ className, tone }))}
      role={tone === "danger" ? "alert" : undefined}
      {...props}
    >
      {title ? (
        <div className="font-semibold text-foreground">{title}</div>
      ) : null}
      {children ? (
        <div className={title ? "mt-1" : undefined}>{children}</div>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export const Callout = Alert;

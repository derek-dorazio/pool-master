import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./class-names";

const alertVariants = cva("rounded-2xl border px-4 py-3 text-sm", {
  variants: {
    tone: {
      danger: "border-destructive/30 bg-destructive/10 text-destructive",
      info: "border-border bg-background text-muted-foreground",
      success: "border-primary/30 bg-primary/10 text-foreground",
      warning: "border-border bg-muted/40 text-foreground",
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

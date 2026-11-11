import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./class-names";

const noticeVariants = cva("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", {
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

type NoticeProps = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof noticeVariants> & {
    action?: ReactNode;
    title?: ReactNode;
  };

/**
 * Notice (more-info pattern 4): "you need to know this now". Always visible, right above the
 * thing it affects: a deadline, a draft, a lock, an error, a plan limit. One sentence, plus
 * one action if there is one. It goes away when it no longer applies; it is never a page's
 * explanation of itself (that is a `HelpTip`).
 */
export function Notice({
  action,
  children,
  className,
  title,
  tone,
  ...props
}: NoticeProps) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert;
  return (
    <div
      className={cn(noticeVariants({ className, tone }))}
      role={tone === "danger" ? "alert" : undefined}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? (
          <div className="font-semibold text-foreground">{title}</div>
        ) : null}
        {children ? (
          <div className={title ? "mt-1" : undefined}>{children}</div>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "./class-names";

type SplitContentLayoutProps = {
  aside: ReactNode;
  className?: string;
  main: ReactNode;
};

export function SplitContentLayout({
  aside,
  className,
  main,
}: SplitContentLayoutProps) {
  return (
    <div className={cn("grid gap-6 xl:grid-cols-[1.1fr_0.9fr]", className)}>
      <div className="min-w-0">{main}</div>
      <aside className="min-w-0 space-y-6">{aside}</aside>
    </div>
  );
}

type SummaryMediaLayoutProps = {
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SummaryMediaLayout({
  aside,
  children,
  className,
}: SummaryMediaLayoutProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">{children}</div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

type ResponsiveGridLayoutProps = {
  children: ReactNode;
  className?: string;
};

export function ResponsiveGridLayout({
  children,
  className,
}: ResponsiveGridLayoutProps) {
  return <div className={cn("grid gap-4 md:grid-cols-2", className)}>{children}</div>;
}

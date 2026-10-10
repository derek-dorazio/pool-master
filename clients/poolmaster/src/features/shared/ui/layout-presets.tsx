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

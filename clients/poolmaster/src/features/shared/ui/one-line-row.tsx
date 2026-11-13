import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./class-names";

/** The room kept at the row's end for "+N", in px: wide enough for "+12" at the caption size. */
const MORE_PX = 28;

/**
 * Small items of one width on one line, as many as fit, then "+N" for the rest (#1701: a way to
 * play's sport icons on a phone tile). `itemPx` is one item's width plus the gap after it. The
 * whole list is the row's accessible name (`label`), so nothing is lost to the cap. Until the
 * row has been measured it shows every item.
 */
export function OneLineRow({
  className,
  itemPx,
  items,
  label,
  testId,
}: {
  className?: string;
  itemPx: number;
  items: readonly { key: string; node: ReactNode }[];
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const measure = () => setWidth(row.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const fits = width === 0 || items.length * itemPx <= width
    ? items.length
    : Math.max(0, Math.floor((width - MORE_PX) / itemPx));
  const hidden = items.length - fits;
  return (
    <span aria-label={label} className={cn("flex min-w-0 items-center gap-1 overflow-hidden", className)} data-testid={testId} ref={ref} role="img">
      {items.slice(0, fits).map((item) => <span className="shrink-0" key={item.key}>{item.node}</span>)}
      {hidden > 0 ? (
        <span aria-hidden="true" className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground" data-testid={testId ? `${testId}-more` : undefined}>
          {`+${hidden}`}
        </span>
      ) : null}
    </span>
  );
}

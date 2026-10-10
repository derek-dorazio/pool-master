import { Button } from "./button";

/**
 * "1–25 of 140" with Previous and Next, for any list that pages client-side. Renders nothing for
 * a single page.
 */
export function Pager({
  onNext,
  onPrevious,
  pageCount,
  pageIndex,
  pageSize,
  total,
}: {
  onNext: () => void;
  onPrevious: () => void;
  pageCount: number;
  /** Zero-based. */
  pageIndex: number;
  pageSize: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return null;
  }
  const firstShown = total ? pageIndex * pageSize + 1 : 0;
  const lastShown = Math.min(total, (pageIndex + 1) * pageSize);

  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <span>
        {firstShown}–{lastShown} of {total}
      </span>
      <div className="flex gap-2">
        <Button disabled={pageIndex === 0} onClick={onPrevious} size="sm" variant="secondary">
          Previous
        </Button>
        <Button disabled={pageIndex >= pageCount - 1} onClick={onNext} size="sm" variant="secondary">
          Next
        </Button>
      </div>
    </nav>
  );
}

import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";

type PaginationProps = {
  canGoNext: boolean;
  canGoPrevious: boolean;
  className?: string;
  label?: string;
  nextLabel?: ReactNode;
  onNext: () => void;
  onPrevious: () => void;
  page: number;
  pageCount?: number;
  previousLabel?: ReactNode;
};

export function Pagination({
  canGoNext,
  canGoPrevious,
  className,
  label = "Pagination",
  nextLabel = "Next",
  onNext,
  onPrevious,
  page,
  pageCount,
  previousLabel = "Previous",
}: PaginationProps) {
  const pageSummary = pageCount
    ? `Page ${page} of ${pageCount}`
    : `Page ${page}`;

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div className="text-sm font-medium text-muted-foreground">
        {pageSummary}
      </div>
      <div className="flex gap-2">
        <Button
          disabled={!canGoPrevious}
          onClick={onPrevious}
          type="button"
          variant="secondary"
        >
          {previousLabel}
        </Button>
        <Button
          disabled={!canGoNext}
          onClick={onNext}
          type="button"
          variant="secondary"
        >
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
}

type ResultsSummaryProps = {
  className?: string;
  itemLabel?: string;
  page: number;
  pageSize: number;
  total: number;
};

export function ResultsSummary({
  className,
  itemLabel = "results",
  page,
  pageSize,
  total,
}: ResultsSummaryProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      Showing {start}-{end} of {total} {itemLabel}
    </p>
  );
}

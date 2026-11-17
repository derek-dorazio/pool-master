import { cn } from "./class-names";

/**
 * A team's seed in a knockout (#1753): the number in a small navy square beside its name, on a
 * bracket, a champion card and a leaderboard's champion column.
 */
export function SeedChip({ className, seed }: { className?: string; seed: number }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-surface-inverse px-0.5 text-[10px] font-bold leading-none tabular-nums text-on-inverse",
        className,
      )}
      data-seed={seed}
    >
      <span className="sr-only">Seed </span>
      {seed}
    </span>
  );
}

import { cn } from "./class-names";

/** A trophy's metal: gold for 1st, silver for 2nd, bronze for 3rd (#1768). */
export type TrophyMetal = "bronze" | "gold" | "silver";

const METAL_CLASSES: Record<TrophyMetal, string> = {
  bronze: "text-[color:var(--trophy-bronze)]",
  gold: "text-gold-500",
  silver: "text-[color:var(--trophy-silver)]",
};

/**
 * A drawn trophy (#1753), ours rather than any league's logo: gold while the team it stands for
 * can still win, grey once it is out. A final contest's 2nd and 3rd take silver and bronze.
 */
export function TrophyMark({
  className,
  isOut = false,
  metal = "gold",
}: {
  className?: string;
  isOut?: boolean;
  metal?: TrophyMetal;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-10 w-10", isOut ? "text-muted-foreground opacity-40" : METAL_CLASSES[metal], className)}
      data-metal={isOut ? undefined : metal}
      data-out={isOut || undefined}
      data-testid="trophy-mark"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path d="M7 4H4.5v1.5A3.5 3.5 0 0 0 8 9M17 4h2.5v1.5A3.5 3.5 0 0 1 16 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M6.5 2.5h11V8a5.5 5.5 0 0 1-11 0V2.5Z" fill="currentColor" />
      <path d="M10.75 13h2.5v4h-2.5z" fill="currentColor" />
      <rect fill="currentColor" height="2" rx="0.5" width="10" x="7" y="17.5" />
      <rect fill="currentColor" height="1.5" rx="0.5" width="12" x="6" y="20.5" />
    </svg>
  );
}

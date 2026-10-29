import { cn } from "./class-names";
import { countdownUntil } from "./countdown-parts";

const toneClassNames = {
  default: { box: "border-border bg-background", label: "text-muted-foreground" },
  inverse: { box: "border-inverse-border bg-on-inverse-subtle", label: "text-on-inverse-muted" },
};

/**
 * Days, hours and minutes to `until`, each in its own box. Screen readers hear it as one timer,
 * `label` first ("Entries close in 2 days 3 hours 4 minutes").
 */
export function Countdown({
  label,
  now,
  testId,
  tone = "default",
  until,
}: {
  label: string;
  now: Date;
  testId?: string;
  tone?: "default" | "inverse";
  until: string;
}) {
  const countdown = countdownUntil(until, now);
  const parts = [
    { label: "Days", value: countdown.days },
    { label: "Hours", value: countdown.hours },
    { label: "Min", value: countdown.minutes },
  ];
  return (
    <div
      aria-label={`${label} ${countdown.days} days ${countdown.hours} hours ${countdown.minutes} minutes`}
      className="flex gap-2"
      data-testid={testId}
      role="timer"
    >
      {parts.map((part) => (
        <div className={cn("min-w-16 rounded-xl border px-3 py-2 text-center", toneClassNames[tone].box)} key={part.label}>
          <b className="block font-display text-xl tabular-nums">{String(part.value).padStart(2, "0")}</b>
          <span className={cn("text-xs uppercase tracking-label", toneClassNames[tone].label)}>{part.label}</span>
        </div>
      ))}
    </div>
  );
}

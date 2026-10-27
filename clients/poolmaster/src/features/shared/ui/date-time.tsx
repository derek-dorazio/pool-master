import type { ComponentProps } from "react";
import { cn } from "./class-names";
import { normalizeDate, timeZoneAbbreviation, timeZoneGenericName } from "./date-time-format";
import { useDisplayPreferences } from "./display-preferences";
import { Input } from "./form-field";

type DateDisplayProps = {
  className?: string;
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
  emptyLabel?: string;
  /** `null` shows the date alone. */
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"] | null;
  value: Date | string | null | undefined;
};

export function DateDisplay({
  className,
  dateStyle = "medium",
  emptyLabel = "Unavailable",
  timeStyle = "short",
  value,
}: DateDisplayProps) {
  const preferences = useDisplayPreferences();
  const date = normalizeDate(value);
  // dateStyle and timeStyle can't be combined with timeZoneName, so a time gets its zone appended.
  const formatted = date
    ? new Intl.DateTimeFormat(preferences.locale, {
        dateStyle,
        timeStyle: timeStyle ?? undefined,
        hour12: timeStyle ? preferences.hour12 : undefined,
        timeZone: preferences.timeZone,
      }).format(date) + (timeStyle ? ` ${timeZoneAbbreviation(date, preferences)}` : "")
    : emptyLabel;

  return <span className={cn("text-foreground", className)}>{formatted}</span>;
}

type DateTimeFieldProps = Omit<ComponentProps<"input">, "type">;

/**
 * A date and time entry box. Its value is the wall clock in the member's zone (#1061), named
 * beside it; convert with `toDateTimeLocalValue` and `dateTimeLocalValueToIso`.
 */
export function DateTimeField({ className, ...props }: DateTimeFieldProps) {
  const preferences = useDisplayPreferences();
  return (
    <div className="flex items-center gap-2">
      <Input className={cn("flex-1", className)} type="datetime-local" {...props} />
      <span className="shrink-0 text-sm text-muted-foreground">{timeZoneGenericName(preferences)}</span>
    </div>
  );
}

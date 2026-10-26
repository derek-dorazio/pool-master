import type { InputHTMLAttributes } from "react";
import { cn } from "./class-names";
import { normalizeDate, timeZoneAbbreviation } from "./date-time-format";
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

type DateTimeFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  value: string;
};

export function DateTimeField({ className, ...props }: DateTimeFieldProps) {
  return <Input className={className} type="datetime-local" {...props} />;
}

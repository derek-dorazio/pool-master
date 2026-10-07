import type { InputHTMLAttributes } from "react";
import { cn } from "./class-names";
import { normalizeDate } from "./date-time-format";
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
  const date = normalizeDate(value);

  return (
    <span className={cn("text-foreground", className)}>
      {date
        ? new Intl.DateTimeFormat(undefined, {
            dateStyle,
            timeStyle: timeStyle ?? undefined,
          }).format(date)
        : emptyLabel}
    </span>
  );
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

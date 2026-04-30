import type { InputHTMLAttributes } from "react";
import { cn } from "./class-names";
import { Input } from "./form-field";

type DateDisplayProps = {
  className?: string;
  dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
  emptyLabel?: string;
  timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
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
        ? new Intl.DateTimeFormat(undefined, { dateStyle, timeStyle }).format(
            date,
          )
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

export function toDateTimeLocalValue(value: Date | string | null | undefined) {
  const date = normalizeDate(value);

  if (!date) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

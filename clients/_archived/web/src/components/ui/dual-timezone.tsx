import { usePreferencesStore } from '@/stores/preferences-store';
import { formatTime, getTimezoneAbbr } from '@/lib/format-time';
import { cn } from '@/lib/utils';

interface DualTimezoneProps {
  utcDate: Date | string;
  leagueTimezone: string;
  format?: 'DATETIME_SHORT' | 'DATETIME_LONG';
  className?: string;
}

export function DualTimezone({
  utcDate,
  leagueTimezone,
  format = 'DATETIME_SHORT',
  className,
}: DualTimezoneProps) {
  const userTz = usePreferencesStore((s) => s.timezone);
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  const sameTimezone = userTz === leagueTimezone;

  const primaryStr = formatTime(date, format, userTz);
  const userAbbr = getTimezoneAbbr(userTz, date);

  return (
    <div className={cn('inline-flex flex-col', className)}>
      <span className="text-sm font-medium">
        {primaryStr} {sameTimezone ? '' : userAbbr}
      </span>
      {!sameTimezone && (
        <span className="text-xs text-muted-foreground">
          {formatTime(date, 'TIME', leagueTimezone)} {getTimezoneAbbr(leagueTimezone, date)}
        </span>
      )}
    </div>
  );
}

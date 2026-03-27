import { useEffect, useState } from 'react';
import { formatRelative, formatTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

interface RelativeTimeProps {
  utcDate: Date | string;
  className?: string;
}

export function RelativeTime({ utcDate, className }: RelativeTimeProps) {
  const [display, setDisplay] = useState(() => formatRelative(utcDate));

  useEffect(() => {
    setDisplay(formatRelative(utcDate));

    const interval = setInterval(() => {
      setDisplay(formatRelative(utcDate));
    }, 60_000);

    return () => clearInterval(interval);
  }, [utcDate]);

  const fullDatetime = formatTime(utcDate, 'DATETIME_LONG');

  return (
    <span className={cn('cursor-default', className)} title={fullDatetime}>
      {display}
    </span>
  );
}

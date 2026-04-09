import { cn } from '@/lib/utils';

interface UsageMeterProps {
  label: string;
  current: number;
  limit: number | null;
  icon?: React.ReactNode;
}

function getBarColor(percentage: number): string {
  if (percentage >= 90) return 'bg-red-500';
  if (percentage >= 75) return 'bg-amber-500';
  return 'bg-green-500';
}

export function UsageMeter({ label, current, limit, icon }: UsageMeterProps) {
  const isUnlimited = limit === null;
  const percentage = isUnlimited ? 0 : Math.min((current / limit) * 100, 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {label}
        </span>
        <span className="text-muted-foreground">
          {isUnlimited ? (
            <>{current} used <span className="text-xs">(Unlimited)</span></>
          ) : (
            <>{current} of {limit}</>
          )}
        </span>
      </div>
      {isUnlimited ? (
        <div className="h-2 w-full rounded-full bg-muted">
          <div className="h-full w-1/6 rounded-full bg-green-500/50" />
        </div>
      ) : (
        <div
          className="h-2 w-full rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${label}: ${current} of ${limit}`}
        >
          <div
            className={cn('h-full rounded-full transition-all', getBarColor(percentage))}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      {!isUnlimited && percentage >= 100 && (
        <p className="text-xs text-red-500">
          Limit reached. Upgrade your plan to create more.
        </p>
      )}
    </div>
  );
}

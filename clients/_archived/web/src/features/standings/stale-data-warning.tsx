import { useState } from 'react';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StaleDataWarningProps {
  lastUpdated: Date | null;
  staleThresholdMs?: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

const DEFAULT_STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

export function StaleDataWarning({
  lastUpdated,
  staleThresholdMs = DEFAULT_STALE_THRESHOLD,
  onRefresh,
  isRefreshing,
}: StaleDataWarningProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !lastUpdated) return null;

  const staleness = Date.now() - lastUpdated.getTime();
  if (staleness < staleThresholdMs) return null;

  const minutesAgo = Math.floor(staleness / 60_000);

  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-950">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
      <span className="flex-1 text-amber-800 dark:text-amber-200">
        Scores last updated {minutesAgo} minute{minutesAgo !== 1 ? 's' : ''} ago.
        There may be a delay in live scoring data.
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-amber-700"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={`h-3 w-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
        Refresh
      </Button>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-800"
        aria-label="Dismiss warning"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

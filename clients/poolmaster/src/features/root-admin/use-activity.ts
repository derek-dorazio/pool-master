import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnFiltersState } from '@tanstack/react-table';
import { useCallback, useState } from 'react';
import { BackgroundJobStatus } from '@poolmaster/shared/domain';
import { isSpanToNow, type DataGridFilter } from '@/features/shared/ui';
import { listActivity, type ActivityJobDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { QueryKeys } from '@/lib/query-keys';

/** What an Activity grid shows: every job, one sport league's, or one event's. */
export type ActivityScope = { sportLeagueId: string } | { sportEventId: string } | null;

/** The Started column's id: its filter decides the window the grid asks the server for. */
export const ACTIVITY_STARTED_COLUMN = 'started';

/** Finished jobs are kept this long, so a grid with no Started filter asks for all of them. */
const JOBS_KEPT_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;
/** How often an open grid reads again, well inside the read's limit of 60 a minute. */
const REFRESH_MS = 30_000;

/** The queue-time window to read: from the Started filter's first instant, or every job kept. */
type ActivityWindow = { from: string; to: string | null };

/** The window a grid's filters call for: its Started filter's span (open-ended for Past N), else every job kept. */
export function activityWindow(filters: ColumnFiltersState, now: number = Date.now()): ActivityWindow {
  const started = filters.find((filter) => filter.id === ACTIVITY_STARTED_COLUMN)?.value as DataGridFilter | undefined;
  const span = started?.kind === 'date' ? started : null;
  // A Past span reads up to now each time, so it asks for no end.
  const to = span === null || isSpanToNow(span.span) ? null : span.to;
  return {
    from: new Date(span?.from ?? now - JOBS_KEPT_DAYS * DAY_MS).toISOString(),
    to: to === null ? null : new Date(to).toISOString(),
  };
}

/**
 * The jobs one Activity grid shows (#1887): read for the window its Started filter covers, so
 * widening the filter reads further back, and read again every 30 seconds. The page holding the
 * grid reads the same jobs for its header's counts. No paging: the window bounds the read.
 */
export function useActivity(scope: ActivityScope, { poll = true }: { poll?: boolean } = {}) {
  // Unset until the grid's first render reports its filters, which may come from the link.
  const [readWindow, setReadWindow] = useState<ActivityWindow | null>(null);
  const onFiltersChange = useCallback((filters: ColumnFiltersState) => {
    const next = activityWindow(filters);
    setReadWindow((current) => (current?.from === next.from && current.to === next.to ? current : next));
  }, []);
  const scopeKey = scope === null ? null : 'sportLeagueId' in scope ? `league:${scope.sportLeagueId}` : `event:${scope.sportEventId}`;

  const query = useQuery({
    enabled: readWindow !== null,
    queryKey: QueryKeys.rootAdmin.activityWindow(scopeKey, readWindow?.from ?? '', readWindow?.to ?? null),
    queryFn: async (): Promise<ActivityJobDto[]> => {
      const response = await listActivity({
        query: {
          ...scope,
          from: readWindow?.from,
          ...(readWindow?.to ? { to: readWindow.to } : {}),
        },
      });
      if (!response.data?.jobs) {
        throwApiError(response.error, 'Activity response is missing data.');
      }
      return response.data.jobs;
    },
    placeholderData: keepPreviousData,
    // A page holding the read for a tab that is not open stops re-reading until it is again.
    refetchInterval: poll ? REFRESH_MS : false,
    retry: false,
  });

  return { scope, query, onFiltersChange };
}

export type ActivityState = ReturnType<typeof useActivity>;

/** How many of the jobs read failed. */
export function failedJobCount(jobs: readonly Pick<ActivityJobDto, 'status'>[]): number {
  return jobs.filter((job) => job.status === BackgroundJobStatus.FAILED).length;
}

/** The header's count line, such as "412 jobs · 2 failed · 1 running", over the jobs read. */
export function activityCountLine(jobs: readonly ActivityJobDto[]): string {
  const failed = failedJobCount(jobs);
  const running = jobs.filter((job) => job.status === BackgroundJobStatus.RUNNING).length;
  return [plural(jobs.length, 'job'), failed > 0 ? `${String(failed)} failed` : null, running > 0 ? `${String(running)} running` : null]
    .filter(Boolean)
    .join(' · ');
}

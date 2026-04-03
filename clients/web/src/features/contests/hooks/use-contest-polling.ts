/**
 * useContestPolling — visibility-aware polling hook for live contest standings.
 *
 * Polls at a configurable interval while the page is visible.
 * Pauses when the tab is hidden. Refetches immediately when the
 * tab becomes visible again.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { client, getContest, getStandings } from '@/lib/api';
import {
  ContestResponseSchema,
  StandingsResponseSchema,
} from '@poolmaster/shared/dto';

interface ContestPollingOptions {
  contestId: string;
  interval?: number;
  enabled?: boolean;
}

interface PolledContestData {
  standings: Array<{
    entryId: string;
    entryName: string;
    rank: number;
    totalScore: number;
    previousRank: number | null;
  }>;
  lastUpdatedAt: string | null;
  contestStatus: string;
}

export function useContestPolling({
  contestId,
  interval = 10_000,
  enabled = true,
}: ContestPollingOptions) {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const queryClient = useQueryClient();

  useEffect(() => {
    function handleVisibility() {
      const visible = !document.hidden;
      setIsVisible(visible);

      if (visible) {
        queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'poll'] });
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [contestId, queryClient]);

  return useQuery({
    queryKey: ['contests', contestId, 'poll'],
    queryFn: async (): Promise<PolledContestData> => {
      const [{ data: standingsData, error: standingsError }, { data: contestData, error: contestError }] =
        await Promise.all([
          getStandings({ client, path: { contestId } }),
          getContest({ client, path: { contestId } }),
        ]);

      if (standingsError) throw standingsError;
      if (contestError) throw contestError;
      if (!standingsData || !contestData) {
        throw new Error('Contest polling response was empty.');
      }

      const standings = StandingsResponseSchema.parse(standingsData);
      const contest = ContestResponseSchema.parse(contestData);
      const lastUpdatedAt = standings.standings.reduce<string | null>((latest, entry) => {
        if (!latest) return entry.lastUpdatedAt;
        return new Date(entry.lastUpdatedAt).getTime() > new Date(latest).getTime()
          ? entry.lastUpdatedAt
          : latest;
      }, null);

      return {
        standings: standings.standings.map((entry) => ({
          entryId: entry.entryId,
          entryName: entry.entryName,
          rank: entry.rank,
          totalScore: entry.totalScore,
          previousRank: entry.previousRank,
        })),
        lastUpdatedAt,
        contestStatus: contest.contest.status,
      };
    },
    enabled,
    refetchInterval: isVisible && enabled ? interval : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: interval / 2,
  });
}

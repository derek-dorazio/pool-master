/**
 * useContestPolling — visibility-aware polling hook for live contest data.
 *
 * Polls at a configurable interval while the page is visible.
 * Pauses when the tab is hidden. Refetches immediately when the
 * tab becomes visible again (catches up on missed updates).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface ContestPollingOptions {
  contestId: string;
  /** Polling interval in ms. Default: 10s. */
  interval?: number;
  /** Whether polling is enabled. Default: true. */
  enabled?: boolean;
}

interface PolledContestData {
  standings: Array<{
    entryId: string;
    entryName: string;
    rank: number;
    totalScore: number;
    previousRank: number;
  }>;
  lastUpdatedAt: string;
  contestStatus: string;
}

export function useContestPolling({ contestId, interval = 10_000, enabled = true }: ContestPollingOptions) {
  const [isVisible, setIsVisible] = useState(!document.hidden);
  const queryClient = useQueryClient();

  // Track page visibility
  useEffect(() => {
    function handleVisibility() {
      const visible = !document.hidden;
      setIsVisible(visible);

      // Immediate refetch when tab becomes visible
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
      // TODO: Replace with real API call with ETag support
      // const response = await fetch(`/api/v1/contests/${contestId}/standings`, {
      //   headers: lastEtag ? { 'If-None-Match': lastEtag } : {},
      // });
      // if (response.status === 304) return previous data (no change);
      await new Promise((r) => setTimeout(r, 100));
      return {
        standings: [
          { entryId: 'e1', entryName: 'Eagle Eye', rank: 1, totalScore: 298, previousRank: 2 },
          { entryId: 'e2', entryName: 'Birdie Brigade', rank: 2, totalScore: 285, previousRank: 1 },
          { entryId: 'e3', entryName: 'My Entry', rank: 3, totalScore: 274, previousRank: 3 },
        ],
        lastUpdatedAt: new Date().toISOString(),
        contestStatus: 'ACTIVE',
      };
    },
    refetchInterval: isVisible && enabled ? interval : false,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    staleTime: interval / 2,
  });
}

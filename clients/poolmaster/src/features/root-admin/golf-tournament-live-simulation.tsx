import { useQuery } from '@tanstack/react-query';
import { getEventLiveSimulation, listProviders, startEventLiveSimulation } from '@/lib/api';
import { Button, formatDateTimeDisplay } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportEventDto, SportEventLiveSimulationResponse } from '@/lib/api';

function describeSimulation(simulation: SportEventLiveSimulationResponse): string {
  const finish = formatDateTimeDisplay(simulation.endsAt);
  if (simulation.phase === 'COMPLETED') {
    return `Simulation finished at ${finish}.`;
  }
  const round = simulation.currentRound ? `Round ${simulation.currentRound} of 4 is under way` : 'Simulation starts shortly';
  return `${round}, ${simulation.minutesPerRound} minutes per round; it finishes at ${finish}. Scores sync while the tournament is Live.`;
}

/** How often the open card re-reads the simulation, so its round keeps up with the clock. */
const statusRefreshMs = 30_000;

/**
 * #382 — starts the linked score source's simulated live scoring, so a live contest's
 * leaderboard can be tested without a real tournament under way. Rendered only when the
 * event's provider reports `supportsLiveSimulation` (the QA mock feed); nothing shows for a
 * real provider.
 */
export function GolfTournamentLiveSimulation({ tournament }: { tournament: SportEventDto }) {
  const logger = getLogger().child({ feature: 'root-admin-golf-tournament-home-page' });
  const providersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async () => {
      const response = await listProviders();
      if (!response.data?.providers) {
        throwApiError(response.error, 'Provider list response is missing data.');
      }
      return response.data.providers;
    },
    retry: false,
  });
  const supported = (providersQuery.data ?? []).some(
    (provider) => provider.providerId === tournament.providerId && provider.supportsLiveSimulation,
  );

  const statusQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.liveSimulation(tournament.id),
    queryFn: async () => {
      const response = await getEventLiveSimulation({ path: { eventId: tournament.id } });
      if (response.error?.error.code === 'LIVE_SIMULATION_NOT_RUNNING') {
        return null;
      }
      if (!response.data) {
        throwApiError(response.error, 'Live simulation status response is missing data.');
      }
      return response.data;
    },
    enabled: supported,
    refetchInterval: (query) => (query.state.data?.phase === 'COMPLETED' ? false : statusRefreshMs),
    retry: false,
  });
  const simulation = statusQuery.data ?? null;

  const startMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await startEventLiveSimulation({ path: { eventId: tournament.id }, body: {} });
      if (!response.data) {
        throwApiError(response.error, 'Live simulation response is missing data.');
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tournament(tournament.id)],
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.live-simulation.start.failed', err: error },
        'Live simulation start was rejected',
      );
    },
  });

  if (!supported) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="root-admin-golf-tournament-live-simulation">
      <p className="text-sm text-muted-foreground">
        This score source can simulate live scoring: four rounds played hole by hole on its own clock.
        Start the simulation before moving the tournament to Live; otherwise the first sync stores the
        score source&apos;s fixed scores. Starting again restarts from round 1.
      </p>
      <div className="mt-3">
        <Button
          data-testid="root-admin-golf-tournament-live-simulation-start"
          disabled={startMutation.isPending}
          onClick={() => startMutation.mutate()}
          size="sm"
          type="button"
          variant="secondary"
        >
          {startMutation.isPending ? 'Starting…' : 'Start live simulation'}
        </Button>
      </div>
      {simulation ? (
        <p className="mt-2 text-sm text-foreground" data-testid="root-admin-golf-tournament-live-simulation-status">
          {describeSimulation(simulation)}
        </p>
      ) : null}
      {statusQuery.isError ? (
        <p className="mt-2 text-sm text-destructive" data-testid="root-admin-golf-tournament-live-simulation-status-error" role="alert">
          {extractErrorMessage(statusQuery.error, { fallback: 'The live simulation status could not be read.' })}
        </p>
      ) : null}
      {startMutation.isError ? (
        <p className="mt-2 text-sm text-destructive" data-testid="root-admin-golf-tournament-live-simulation-error" role="alert">
          {extractErrorMessage(startMutation.error, { fallback: 'The live simulation could not be started.' })}
        </p>
      ) : null}
    </div>
  );
}

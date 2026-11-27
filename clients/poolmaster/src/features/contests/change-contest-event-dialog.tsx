import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { listEvents, setContestCoverage, type SportEventDto } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { ConfirmDialog, FormField, QueryState, Select, formatDateDisplay, showToast, useDisplayPreferences } from '@/features/shared/ui';

/** One Season's events, read when the dialog opens (#2003). */
function seasonEventsQueryOptions(sportLeagueSeasonId: string, enabled: boolean) {
  return {
    queryKey: QueryKeys.sportEvents.bySportLeagueSeason(sportLeagueSeasonId),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sportLeagueSeasonId } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }
      return response.data.events;
    },
    enabled,
    retry: false,
  };
}

/**
 * "Change event": moves a contest still in Set up to another event of its Season (#2014), for a
 * commissioner who built it on the wrong one. The server resolves what the contest covers again
 * from its template, as at create; once the contest opens, its event is fixed.
 */
export function ChangeContestEventDialog({
  contestId,
  currentEvent,
  leagueCode,
  leagueId,
  onOpenChange,
  open,
}: {
  contestId: string;
  /** The event the contest covers now; the list is of its Season. */
  currentEvent: SportEventDto;
  leagueCode: string;
  leagueId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const logger = useMemo(() => getLogger().child({ feature: 'change-contest-event-dialog' }), []);
  const displayPreferences = useDisplayPreferences();
  const [chosenId, setChosenId] = useState('');
  const eventsQuery = useQuery(seasonEventsQueryOptions(currentEvent.sportLeagueSeasonId, open));
  useEffect(() => {
    if (eventsQuery.isError) {
      logger.warn({ action: 'contest.event.change.season.load.failed', data: { leagueCode, contestId, sportLeagueSeasonId: currentEvent.sportLeagueSeasonId }, err: eventsQuery.error }, 'Change event dialog failed to load the Season\'s events');
    }
  }, [contestId, currentEvent.sportLeagueSeasonId, eventsQuery.error, eventsQuery.isError, leagueCode, logger]);

  const changeMutation = useInvalidatingMutation({
    mutationFn: async (sportEventId: string) => {
      const response = await setContestCoverage({ path: { id: leagueId, contestId }, body: { sportEventIds: [sportEventId] } });
      if (response.error) {
        throwApiError(response.error);
      }
    },
    onSuccess: (_data, sportEventId) => {
      logger.info({ action: 'contest.event.change.succeeded', data: { leagueCode, contestId, sportEventId } }, 'Changed contest event');
      setChosenId('');
      onOpenChange(false);
      showToast({ title: 'Event changed', tone: 'success' });
    },
    invalidates: [
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.contests.detail(contestId),
      QueryKeys.managedContests.all,
    ],
    onError: (error) => {
      const payload = { action: 'contest.event.change.failed', data: { leagueCode, contestId }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest event change was rejected');
      } else {
        logger.error(payload, 'Contest event change failed unexpectedly');
      }
    },
  });

  function closeDialog() {
    if (!changeMutation.isPending) {
      changeMutation.reset();
      setChosenId('');
      onOpenChange(false);
    }
  }

  return (
    <ConfirmDialog
      confirmLabel="Change event"
      description={`This contest covers ${currentEvent.name} now. You can change it until you open the contest to the league.`}
      error={changeMutation.isError
        ? extractErrorMessage(changeMutation.error, {
          context: ['contestEvents', 'contestSetup'],
          fallback: 'We could not change the event. Please try again.',
        })
        : null}
      isConfirmDisabled={chosenId === ''}
      isPending={changeMutation.isPending}
      onCancel={closeDialog}
      onConfirm={() => void changeMutation.mutateAsync(chosenId).catch(() => undefined)}
      // Opened from outside the dialog, so the one change it reports is a close (Escape).
      onOpenChange={closeDialog}
      open={open}
      pendingLabel="Changing..."
      testId="contest-change-event-dialog"
      title="Change event"
    >
      <QueryState loading="Loading this season's events" query={eventsQuery} testId="contest-change-event-events">
        {(events) => (
          <FormField help="Only an event that is released, has its field loaded and has not started can take a contest." label="Event">
            <Select
              data-testid="contest-change-event-select"
              onChange={(event) => setChosenId(event.target.value)}
              value={chosenId}
            >
              <option value="">Choose an event</option>
              {[...events]
                .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate) || left.id.localeCompare(right.id))
                .map((sportEvent) => (
                  <option
                    disabled={!sportEvent.contestEligible || sportEvent.id === currentEvent.id}
                    key={sportEvent.id}
                    value={sportEvent.id}
                  >
                    {`${sportEvent.name} · ${formatDateDisplay(sportEvent.startDate, displayPreferences)}`}
                  </option>
                ))}
            </Select>
          </FormField>
        )}
      </QueryState>
    </ConfirmDialog>
  );
}

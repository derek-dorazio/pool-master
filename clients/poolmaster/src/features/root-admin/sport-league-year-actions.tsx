import { useState } from 'react';
import { cloneEventYear } from '@/lib/api';
import { Button, ConfirmationModal, StatusBadge } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportLeagueDto } from '@/lib/api';
import { useManagedSport } from './use-managed-sport';
import { useUpdateSportLeague } from './use-update-sport-league';

/**
 * plans/147 — what used to be done to a season is done to a tour's event year: make it
 * the tour's current year, and clone its calendar to the next year (plans/124 §4.2a —
 * fresh tournaments, dates shifted, never last year's field, tiers, scores or provider
 * link). `eventCount` is the tournaments already loaded for the year, so neither action
 * needs a preview call.
 */
export function SportLeagueYearActions({
  eventCount,
  eventYear,
  onCloned,
  sportLeague,
}: {
  eventCount: number;
  eventYear: number;
  onCloned: (targetYear: number) => void;
  sportLeague: SportLeagueDto;
}) {
  const logger = getLogger().child({ feature: 'sport-league-year-actions' });
  const { event } = useManagedSport().definition.vocabulary;
  const [setCurrentOpen, setSetCurrentOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const targetYear = eventYear + 1;
  const isCurrent = sportLeague.currentEventYear === eventYear;

  const setCurrentMutation = useUpdateSportLeague({
    failedAction: 'sportLeague.setCurrentYear.failed',
    onSuccess: () => setSetCurrentOpen(false),
    refusedMessage: 'Set-current event year was rejected',
    sportLeagueId: sportLeague.id,
    toBody: () => ({ currentEventYear: eventYear }),
  });

  const cloneMutation = useInvalidatingMutation({
    mutationFn: async () => {
      // targetYear omitted -> the backend clones to eventYear + 1.
      const response = await cloneEventYear({ body: { sportLeagueId: sportLeague.id, eventYear } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Clone year response is missing data.');
      }
      return response.data.events;
    },
    // The tour's calendar sits under the `tournaments` prefix, and its event count on `tours`.
    invalidates: [QueryKeys.rootAdmin.manageSport.events, QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: (events) => {
      logger.info(
        { action: 'sportLeague.cloneYear', data: { sportLeagueId: sportLeague.id, eventYear, targetYear, count: events.length } },
        'Cloned sport league year',
      );
      setCloneOpen(false);
      onCloned(targetYear);
    },
    onError: (error) => {
      logger.warn({ action: 'sportLeague.cloneYear.failed', err: error }, 'Sport league year clone was rejected');
    },
  });

  return (
    <>
      {isCurrent ? (
        <StatusBadge tone="active">Current year</StatusBadge>
      ) : (
        <Button
          data-testid="root-admin-sport-league-calendar-set-current"
          disabled={eventCount === 0}
          onClick={() => setSetCurrentOpen(true)}
          size="sm"
          variant="secondary"
        >
          Set as current year
        </Button>
      )}
      <Button
        data-testid="root-admin-sport-league-calendar-clone"
        disabled={eventCount === 0}
        onClick={() => setCloneOpen(true)}
        size="sm"
        variant="secondary"
      >
        Clone to {targetYear}
      </Button>

      <ConfirmationModal
        confirmLabel="Set as current"
        confirmTestId="root-admin-sport-league-calendar-set-current-confirm"
        description={`${eventYear} becomes ${sportLeague.name}’s current year, replacing ${sportLeague.currentEventYear ?? 'none'}.`}
        errorMessage={
          setCurrentMutation.isError
            ? extractErrorMessage(setCurrentMutation.error, {
                codeMessages: {
                  EVENT_YEAR_HAS_NO_EVENTS: `${sportLeague.name} has no ${event.many} in ${eventYear}, so it cannot be the current year.`,
                },
                fallback: 'We could not set this year as current.',
              })
            : undefined
        }
        isPending={setCurrentMutation.isPending}
        onCancel={() => setSetCurrentOpen(false)}
        onConfirm={() => setCurrentMutation.mutate()}
        onOpenChange={(next) => !next && setSetCurrentOpen(false)}
        open={setCurrentOpen}
        testId="root-admin-sport-league-calendar-set-current-modal"
        title="Set current year"
      />

      <ConfirmationModal
        confirmLabel={`Clone to ${targetYear}`}
        confirmTestId="root-admin-sport-league-calendar-clone-confirm"
        description={`${eventCount} ${eventCount === 1 ? event.one : event.many} will be copied to ${targetYear}, dates shifted one year forward, each as next year’s edition. The field, tiers, prices, results, and provider link of each ${event.one} are not copied, and the current year does not change.`}
        errorMessage={
          cloneMutation.isError
            ? extractErrorMessage(cloneMutation.error, {
                codeMessages: {
                  EVENT_YEAR_NOT_EMPTY: `${sportLeague.name} already has ${event.many} in ${targetYear}.`,
                },
                fallback: 'We could not clone this year.',
              })
            : undefined
        }
        isPending={cloneMutation.isPending}
        onCancel={() => setCloneOpen(false)}
        onConfirm={() => cloneMutation.mutate()}
        onOpenChange={(next) => !next && setCloneOpen(false)}
        open={cloneOpen}
        testId="root-admin-sport-league-calendar-clone-modal"
        title={`Clone to ${targetYear}`}
      />
    </>
  );
}

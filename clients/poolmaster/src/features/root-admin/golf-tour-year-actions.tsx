import { useState } from 'react';
import { cloneEventYear, updateSportLeague } from '@/lib/api';
import { Button, ConfirmationModal, StatusBadge } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SportLeagueDto } from '@/lib/api';

/**
 * plans/147 — what used to be done to a season is done to a tour's event year: make it
 * the tour's current year, and clone its calendar to the next year (plans/124 §4.2a —
 * fresh tournaments, dates shifted, never last year's field, tiers, scores or provider
 * link). `eventCount` is the tournaments already loaded for the year, so neither action
 * needs a preview call.
 */
export function GolfTourYearActions({
  eventCount,
  eventYear,
  onCloned,
  tour,
}: {
  eventCount: number;
  eventYear: number;
  onCloned: (targetYear: number) => void;
  tour: SportLeagueDto;
}) {
  const logger = getLogger().child({ feature: 'golf-tour-year-actions' });
  const [setCurrentOpen, setSetCurrentOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const targetYear = eventYear + 1;
  const isCurrent = tour.currentEventYear === eventYear;

  const setCurrentMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await updateSportLeague({
        path: { sportLeagueId: tour.id },
        body: { currentEventYear: eventYear },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Set-current response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tours],
    onSuccess: () => setSetCurrentOpen(false),
    onError: (error) => {
      logger.warn({ action: 'golf.tour.setCurrentYear.failed', err: error }, 'Set-current golf year was rejected');
    },
  });

  const cloneMutation = useInvalidatingMutation({
    mutationFn: async () => {
      // targetYear omitted -> the backend clones to eventYear + 1.
      const response = await cloneEventYear({ body: { sportLeagueId: tour.id, eventYear } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Clone year response is missing data.');
      }
      return response.data.events;
    },
    // The tour's calendar sits under the `tournaments` prefix, and its event count on `tours`.
    invalidates: [QueryKeys.rootAdmin.golf.tournaments, QueryKeys.rootAdmin.golf.tours],
    onSuccess: (events) => {
      logger.info(
        { action: 'golf.tour.cloneYear', data: { sportLeagueId: tour.id, eventYear, targetYear, count: events.length } },
        'Cloned golf tour year',
      );
      setCloneOpen(false);
      onCloned(targetYear);
    },
    onError: (error) => {
      logger.warn({ action: 'golf.tour.cloneYear.failed', err: error }, 'Golf tour year clone was rejected');
    },
  });

  return (
    <>
      {isCurrent ? (
        <StatusBadge tone="active">Current year</StatusBadge>
      ) : (
        <Button
          data-testid="root-admin-golf-tour-calendar-set-current"
          disabled={eventCount === 0}
          onClick={() => setSetCurrentOpen(true)}
          size="sm"
          variant="secondary"
        >
          Set as current year
        </Button>
      )}
      <Button
        data-testid="root-admin-golf-tour-calendar-clone"
        disabled={eventCount === 0}
        onClick={() => setCloneOpen(true)}
        size="sm"
        variant="secondary"
      >
        Clone to {targetYear}
      </Button>

      <ConfirmationModal
        confirmLabel="Set as current"
        confirmTestId="root-admin-golf-tour-calendar-set-current-confirm"
        description={`${eventYear} becomes ${tour.name}’s current year, replacing ${tour.currentEventYear ?? 'none'}.`}
        errorMessage={
          setCurrentMutation.isError
            ? extractErrorMessage(setCurrentMutation.error, {
                codeMessages: {
                  EVENT_YEAR_HAS_NO_EVENTS: `${tour.name} has no tournaments in ${eventYear}, so it cannot be the current year.`,
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
        testId="root-admin-golf-tour-calendar-set-current-modal"
        title="Set current year"
      />

      <ConfirmationModal
        confirmLabel={`Clone to ${targetYear}`}
        confirmTestId="root-admin-golf-tour-calendar-clone-confirm"
        description={`${eventCount} tournament${eventCount === 1 ? '' : 's'} will be copied to ${targetYear}, dates shifted one year forward, each as next year’s edition. The field, tiers, prices, scores, and provider link of each tournament are not copied, and the current year does not change.`}
        errorMessage={
          cloneMutation.isError
            ? extractErrorMessage(cloneMutation.error, {
                codeMessages: {
                  EVENT_YEAR_NOT_EMPTY: `${tour.name} already has tournaments in ${targetYear}.`,
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
        testId="root-admin-golf-tour-calendar-clone-modal"
        title={`Clone to ${targetYear}`}
      />
    </>
  );
}

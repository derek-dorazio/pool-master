import { getSportDefinition, type SportNoun } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { releaseEvent } from '@/lib/api';
import { Button, Callout, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { describeEventReleaseBlockers } from './sport-admin-utils';
import type { SportEventDto } from '@/lib/api';

function releaseCodeMessages(event: SportNoun, participant: SportNoun): ErrorCodeMessages {
  return {
    SPORT_EVENT_NOT_DRAFT: `This ${event.one} has already been released.`,
    SPORT_EVENT_ALREADY_STARTED: `This ${event.one} has already started, so it can no longer be released.`,
    SPORT_EVENT_NOT_READY: `This ${event.one} is not ready yet: load its field, put every active ${participant.one} in a tier and assign prices.`,
  };
}

/**
 * "Release for contests" (#431): the one-way step that takes a draft tournament to
 * Scheduled. Commissioners can then build contests on it, and its tiers and prices lock
 * for good, so it asks first. Until the tournament is ready, it says what is missing.
 */
export function SportEventReleaseAction({
  eventId,
  tournament,
}: {
  eventId: string;
  tournament: SportEventDto;
}) {
  const logger = getLogger().child({ feature: 'root-admin-sport-event-release' });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const blockers = describeEventReleaseBlockers(tournament);
  const { event, participant } = getSportDefinition(tournament.sport).vocabulary;

  const releaseMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await releaseEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, `Release ${event.one} response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.sportEvents.all,
    ],
    onSuccess: () => {
      logger.info(
        { action: 'golf.tournament.release.succeeded', data: { eventId } },
        'Released event for contests',
      );
      setIsConfirmOpen(false);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.release.failed', data: { eventId }, err: error },
        'Event release was rejected',
      );
    },
  });

  return (
    <div className="space-y-2" data-testid="root-admin-sport-event-release-panel">
      {blockers.length > 0 ? (
        <Callout tone="warning">
          <p>Before this {event.one} can be released for contests:</p>
          <ul className="mt-1 list-disc pl-5" data-testid="root-admin-sport-event-release-missing">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <Button
        data-testid="root-admin-sport-event-release"
        disabled={blockers.length > 0}
        onClick={() => setIsConfirmOpen(true)}
        size="sm"
        type="button"
      >
        Release for contests
      </Button>
      <ConfirmationModal
        confirmLabel="Release for contests"
        confirmTestId="root-admin-sport-event-release-confirm"
        description={`Commissioners will be able to create contests on this ${event.one}. Its tiers and prices lock for good; the field, ranks, odds and withdrawals stay editable. It can't be returned to a draft.`}
        errorMessage={
          releaseMutation.isError
            ? extractErrorMessage(releaseMutation.error, {
                codeMessages: releaseCodeMessages(event, participant),
                fallback: 'The release was rejected.',
              })
            : undefined
        }
        isPending={releaseMutation.isPending}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => releaseMutation.mutate()}
        onOpenChange={(open) => !open && setIsConfirmOpen(false)}
        open={isConfirmOpen}
        pendingLabel="Releasing..."
        testId="root-admin-sport-event-release-modal"
        title={`Release this ${event.one} for contests?`}
      />
    </div>
  );
}

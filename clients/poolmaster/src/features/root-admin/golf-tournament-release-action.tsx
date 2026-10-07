import { useState } from 'react';
import { releaseEvent } from '@/lib/api';
import { Button, Callout, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { describeGolfReleaseBlockers } from './golf-admin-utils';
import type { SportEventDto } from '@/lib/api';

const RELEASE_CODE_MESSAGES: Record<string, string> = {
  SPORT_EVENT_NOT_DRAFT: 'This tournament has already been released.',
  SPORT_EVENT_ALREADY_STARTED: 'This tournament has already started, so it can no longer be released.',
  SPORT_EVENT_NOT_READY: 'This tournament is not ready yet: load its field and put every active golfer in a tier.',
};

/**
 * "Release for contests" (#431): the one-way step that takes a draft tournament to
 * Scheduled. Commissioners can then build contests on it, and its tiers and prices lock
 * for good, so it asks first. Until the tournament is ready, it says what is missing.
 */
export function GolfTournamentReleaseAction({
  eventId,
  tournament,
}: {
  eventId: string;
  tournament: SportEventDto;
}) {
  const logger = getLogger().child({ feature: 'root-admin-golf-tournament-release' });
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const blockers = describeGolfReleaseBlockers(tournament);

  const releaseMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await releaseEvent({ path: { eventId } });
      if (!response.data?.event) {
        throwApiError(response.error, 'Release tournament response is missing data.');
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
      QueryKeys.sportEvents.all,
    ],
    onSuccess: () => {
      logger.info(
        { action: 'golf.tournament.release.succeeded', data: { eventId } },
        'Released golf tournament for contests',
      );
      setIsConfirmOpen(false);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.release.failed', data: { eventId }, err: error },
        'Golf tournament release was rejected',
      );
    },
  });

  return (
    <div className="space-y-2" data-testid="root-admin-golf-tournament-release-panel">
      {blockers.length > 0 ? (
        <Callout tone="warning">
          <p>Before this tournament can be released for contests:</p>
          <ul className="mt-1 list-disc pl-5" data-testid="root-admin-golf-tournament-release-missing">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <Button
        data-testid="root-admin-golf-tournament-release"
        disabled={blockers.length > 0}
        onClick={() => setIsConfirmOpen(true)}
        size="sm"
        type="button"
      >
        Release for contests
      </Button>
      <ConfirmationModal
        confirmLabel="Release for contests"
        confirmTestId="root-admin-golf-tournament-release-confirm"
        description="Commissioners will be able to create contests on this tournament. Its tiers and prices lock for good; the field, ranks, odds and withdrawals stay editable. It can't be returned to a draft."
        errorMessage={
          releaseMutation.isError
            ? extractErrorMessage(releaseMutation.error, {
                codeMessages: RELEASE_CODE_MESSAGES,
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
        testId="root-admin-golf-tournament-release-modal"
        title="Release this tournament for contests?"
      />
    </div>
  );
}

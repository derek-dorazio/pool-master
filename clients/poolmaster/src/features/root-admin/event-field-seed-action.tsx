import { getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { capitalize } from './manage-navigation';
import { seedEventParticipants } from '@/lib/api';
import { Alert, Button, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { SeedSportEventParticipantsResponse } from '@/lib/api';

type SeedResult = SeedSportEventParticipantsResponse;

/**
 * plans/124 §6.3 Field editor header — "Seed field from league roster": copies
 * the tour's current roster into the field and derives seedNumber / oddsToWin
 * from the tour ranking (§4.7). Always available; golfers already in the field are
 * skipped.
 */
export function EventFieldSeedAction({ eventId, sport }: { eventId: string; sport: Sport }) {
  const { event, participant, sportLeague } = getSportDefinition(sport).vocabulary;
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-field-page',
  });
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);

  const seedMutation = useInvalidatingMutation({
    mutationFn: async (): Promise<SeedResult> => {
      const response = await seedEventParticipants({ path: { eventId } });
      if (!response.data) {
        throwApiError(response.error, 'Seed response is missing data.');
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.field(eventId),
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.rootAdmin.manageSport.tiers(eventId),
    ],
    onSuccess: (data) => {
      setResult(data);
      setOpen(false);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.field.seed.failed', err: error },
        'Field seed was rejected',
      );
    },
  });

  return (
    <>
      <Button
        data-testid="root-admin-event-field-seed"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        size="sm"
        variant="secondary"
      >
        Seed field from {sportLeague.one} roster
      </Button>

      {result ? (
        <Alert
          className="mt-3"
          data-testid="root-admin-event-field-seed-result"
          tone="success"
        >
          Added {result.added} {result.added === 1 ? participant.one : participant.many} ({result.skipped}{' '}
          already in the field). Derived {result.seedNumbersDerived} seed number
          {result.seedNumbersDerived === 1 ? '' : 's'} and {result.oddsDerived} odds.
        </Alert>
      ) : null}

      <ConfirmationModal
        confirmLabel="Seed field"
        confirmTestId="root-admin-event-field-seed-confirm"
        description={`Copies the ${sportLeague.one}'s current roster into this ${event.one}'s field and derives seed numbers and odds-to-win from each ${participant.one}'s ${sportLeague.one} ranking. ${capitalize(participant.many)} already in the field are left untouched.`}
        errorMessage={
          seedMutation.isError
            ? extractErrorMessage(seedMutation.error, {
                fallback: `We could not seed the field from the ${sportLeague.one} roster.`,
              })
            : undefined
        }
        isPending={seedMutation.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => seedMutation.mutate()}
        onOpenChange={(next) => !next && setOpen(false)}
        open={open}
        testId="root-admin-event-field-seed-modal"
        title={`Seed field from ${sportLeague.one} roster`}
      />
    </>
  );
}

import { useState } from 'react';
import { adminSeedGolfTournamentField } from '@/lib/api';
import { Alert, Button, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminSeedGolfTournamentFieldResponses } from '@/lib/api';

type SeedResult = AdminSeedGolfTournamentFieldResponses[200];

/**
 * plans/124 §6.3 Field editor header — "Seed field from league roster": copies
 * the tour's current roster into the field and derives seedNumber / oddsToWin
 * from world ranking (§4.7). Always available; golfers already in the field are
 * skipped.
 */
export function GolfFieldSeedAction({ eventId }: { eventId: string }) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-field-page',
  });
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);

  const seedMutation = useInvalidatingMutation({
    mutationFn: async (): Promise<SeedResult> => {
      const response = await adminSeedGolfTournamentField({ path: { eventId } });
      if (!response.data) {
        throw response.error ?? new Error('Seed response is missing data.');
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.field(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
      QueryKeys.rootAdmin.golf.tiers(eventId),
    ],
    onSuccess: (data) => {
      setResult(data);
      setOpen(false);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.field.seed.failed', err: error },
        'Golf field seed was rejected',
      );
    },
  });

  return (
    <>
      <Button
        data-testid="root-admin-golf-field-seed"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        size="sm"
        variant="secondary"
      >
        Seed field from league roster
      </Button>

      {result ? (
        <Alert
          className="mt-3"
          data-testid="root-admin-golf-field-seed-result"
          tone="success"
        >
          Added {result.added} golfer{result.added === 1 ? '' : 's'} ({result.skipped}{' '}
          already in the field). Derived {result.seedNumbersDerived} seed number
          {result.seedNumbersDerived === 1 ? '' : 's'} and {result.oddsDerived} odds.
        </Alert>
      ) : null}

      <ConfirmationModal
        confirmLabel="Seed field"
        confirmTestId="root-admin-golf-field-seed-confirm"
        description="Copies the tour's current roster into this tournament's field and derives seed numbers and odds-to-win from each golfer's world ranking. Golfers already in the field are left untouched."
        errorMessage={
          seedMutation.isError
            ? extractErrorMessage(seedMutation.error, {
                fallback: 'We could not seed the field from the league roster.',
              })
            : undefined
        }
        isPending={seedMutation.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => seedMutation.mutate()}
        onOpenChange={(next) => !next && setOpen(false)}
        open={open}
        testId="root-admin-golf-field-seed-modal"
        title="Seed field from league roster"
      />
    </>
  );
}

import { useState } from 'react';
import { autoAssignEventTiers } from '@/lib/api';
import type { AutoAssignSportEventTiersRequest } from '@/lib/api';
import {
  Button,
  ConfirmationModal,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

type TierSource = AutoAssignSportEventTiersRequest['source'];

/**
 * plans/124 §6.3 — Tier editor header actions: auto-assign tiers from odds or
 * ranking. Prices are their own action (`GolfPriceAssignAction`) and never touch
 * a tier (§4.5). Replaces manual work, so it confirms.
 */
export function GolfTierAutoAssignActions({
  eventId,
  disabled,
}: {
  eventId: string;
  disabled: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-tiers-page',
  });
  const [tierSource, setTierSource] = useState<TierSource | null>(null);

  const autoTiersMutation = useInvalidatingMutation({
    mutationFn: async (source: TierSource) => {
      const response = await autoAssignEventTiers({
        path: { eventId },
        body: { source },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // The assignments land on the field's valuations (#236).
    invalidates: [
      QueryKeys.rootAdmin.golf.tiers(eventId),
      QueryKeys.rootAdmin.golf.field(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
    ],
    onSuccess: () => setTierSource(null),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tiers.autoAssign.failed', err: error },
        'Golf tier auto-assign was rejected',
      );
    },
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        data-testid="root-admin-golf-tier-auto-odds"
        disabled={disabled}
        onClick={() => setTierSource('ODDS')}
        size="sm"
        variant="secondary"
      >
        Auto-assign tiers from odds
      </Button>
      <Button
        data-testid="root-admin-golf-tier-auto-rank"
        disabled={disabled}
        onClick={() => setTierSource('RANKING')}
        size="sm"
        variant="secondary"
      >
        Auto-assign tiers from ranking
      </Button>
      <ConfirmationModal
        confirmLabel="Replace tier assignments"
        confirmTestId="root-admin-golf-tier-auto-tiers-confirm"
        description={
          tierSource === 'ODDS'
            ? 'Every golfer is re-tiered by odds-to-win. Manual tier assignments will be replaced. Prices are untouched.'
            : 'Every golfer is re-tiered by ranking. Manual tier assignments will be replaced. Prices are untouched.'
        }
        errorMessage={
          autoTiersMutation.isError
            ? extractErrorMessage(autoTiersMutation.error, {
                fallback: 'We could not auto-assign tiers.',
              })
            : undefined
        }
        isPending={autoTiersMutation.isPending}
        onCancel={() => setTierSource(null)}
        onConfirm={() => tierSource && autoTiersMutation.mutate(tierSource)}
        onOpenChange={(next) => !next && setTierSource(null)}
        open={tierSource !== null}
        testId="root-admin-golf-tier-auto-tiers-modal"
        title="Auto-assign tiers"
        tone="danger"
      />

    </div>
  );
}

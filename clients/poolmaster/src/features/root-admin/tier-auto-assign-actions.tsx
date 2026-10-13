import { getSportDefinition, type Sport } from '@poolmaster/shared/domain';
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
 * ranking. Prices are their own action (`PriceAssignAction`) and never touch
 * a tier (§4.5). Replaces manual work, so it confirms.
 */
export function TierAutoAssignActions({
  eventId,
  disabled,
  sport,
}: {
  eventId: string;
  disabled: boolean;
  sport: Sport;
}) {
  const { participant } = getSportDefinition(sport).vocabulary;
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-tiers-page',
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
      QueryKeys.rootAdmin.manageSport.tiers(eventId),
      QueryKeys.rootAdmin.manageSport.field(eventId),
      QueryKeys.rootAdmin.manageSport.event(eventId),
    ],
    onSuccess: () => setTierSource(null),
    onError: (error) => {
      logger.warn(
        { action: 'event.tiers.autoAssign.failed', err: error },
        'Tier auto-assign was rejected',
      );
    },
  });

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        data-testid="root-admin-tier-auto-odds"
        disabled={disabled}
        onClick={() => setTierSource('ODDS')}
        size="sm"
        variant="secondary"
      >
        Auto-assign tiers from odds
      </Button>
      <Button
        data-testid="root-admin-tier-auto-rank"
        disabled={disabled}
        onClick={() => setTierSource('RANKING')}
        size="sm"
        variant="secondary"
      >
        Auto-assign tiers from ranking
      </Button>
      <ConfirmationModal
        confirmLabel="Replace tier assignments"
        confirmTestId="root-admin-tier-auto-tiers-confirm"
        description={
          tierSource === 'ODDS'
            ? `Every ${participant.one} is re-tiered by odds-to-win. Manual tier assignments will be replaced. Prices are untouched.`
            : `Every ${participant.one} is re-tiered by ranking. Manual tier assignments will be replaced. Prices are untouched.`
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
        testId="root-admin-tier-auto-tiers-modal"
        title="Auto-assign tiers"
        tone="danger"
      />

    </div>
  );
}

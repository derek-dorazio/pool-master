import { SportEventParticipantStatus } from '@poolmaster/shared/domain';
import { useState } from 'react';
import { autoAssignEventTiers, type SportEventOverviewDto } from '@/lib/api';
import {
  Button,
  ConfirmDialog,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { EventFieldEntry } from './event-field-patch';
import { describeFieldOrder } from './field-order-copy';

/**
 * plans/124 §6.3 — Tier editor header action: auto-assign tiers in the field's one order (#1807),
 * the order prices use too, which the dialog names. Prices are their own action
 * (`PriceAssignAction`) and never touch a tier (§4.5). Replaces manual work, so it confirms.
 */
export function TierAutoAssignActions({
  eventId,
  disabled,
  field,
  overview,
}: {
  eventId: string;
  disabled: boolean;
  field: readonly EventFieldEntry[];
  /** The event's overview: the order the server decided for its field, which the dialog names. */
  overview: SportEventOverviewDto | undefined;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-event-field',
  });
  const [confirming, setConfirming] = useState(false);

  const autoTiersMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await autoAssignEventTiers({
        path: { eventId },
        body: {},
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
      QueryKeys.rootAdmin.manageSport.eventOverview(eventId),
    ],
    onSuccess: () => setConfirming(false),
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
        data-testid="root-admin-tier-auto-tiers"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        size="sm"
        variant="secondary"
      >
        Auto-assign tiers
      </Button>
      <ConfirmDialog
        confirmLabel="Replace tier assignments"
        confirmTestId="root-admin-tier-auto-tiers-confirm"
        description={`${describeFieldOrder(overview, field.some((entry) => (entry.status === SportEventParticipantStatus.ACTIVE)))} Every participant is re-tiered in that order, the order prices use too. Manual tier assignments will be replaced. Prices are untouched.`}
        error={
          autoTiersMutation.isError
            ? extractErrorMessage(autoTiersMutation.error, {
                fallback: 'We could not auto-assign tiers.',
              })
            : undefined
        }
        isPending={autoTiersMutation.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => autoTiersMutation.mutate()}
        onOpenChange={(next) => !next && setConfirming(false)}
        open={confirming}
        testId="root-admin-tier-auto-tiers-modal"
        title="Auto-assign tiers"
        tone="danger"
      />

    </div>
  );
}

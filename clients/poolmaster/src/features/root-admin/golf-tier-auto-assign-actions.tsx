import { useState } from 'react';
import { adminAutoAssignGolfPrices, adminAutoAssignGolfTiers } from '@/lib/api';
import {
  Button,
  ConfirmationModal,
  FormField,
  Input,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

type TierSource = 'ODDS' | 'WORLD_RANK';

/**
 * plans/124 §6.3 — Tier editor header actions: auto-assign tiers (from odds or
 * world rank) and auto-assign prices (min/max range). Independent — running one
 * never touches the other's `*AssignedSource` (§4.5). Both replace manual work,
 * so both confirm.
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
  const [priceOpen, setPriceOpen] = useState(false);
  const [minPrice, setMinPrice] = useState('1000');
  const [maxPrice, setMaxPrice] = useState('10000');

  const autoTiersMutation = useInvalidatingMutation({
    mutationFn: async (source: TierSource) => {
      const response = await adminAutoAssignGolfTiers({
        path: { eventId },
        body: { source },
      });
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tiers(eventId),
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

  const autoPricesMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await adminAutoAssignGolfPrices({
        path: { eventId },
        body: { minPrice: Number(minPrice), maxPrice: Number(maxPrice) },
      });
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tiers(eventId),
      QueryKeys.rootAdmin.golf.field(eventId),
    ],
    onSuccess: () => setPriceOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.prices.autoAssign.failed', err: error },
        'Golf price auto-assign was rejected',
      );
    },
  });

  const priceRangeValid =
    /^\d+$/.test(minPrice) &&
    /^\d+$/.test(maxPrice) &&
    Number(maxPrice) > Number(minPrice);

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
        onClick={() => setTierSource('WORLD_RANK')}
        size="sm"
        variant="secondary"
      >
        Auto-assign tiers from world rank
      </Button>
      <Button
        data-testid="root-admin-golf-tier-auto-prices"
        disabled={disabled}
        onClick={() => setPriceOpen(true)}
        size="sm"
        variant="secondary"
      >
        Auto-assign prices
      </Button>

      <ConfirmationModal
        confirmLabel="Replace tier assignments"
        confirmTestId="root-admin-golf-tier-auto-tiers-confirm"
        description={
          tierSource === 'ODDS'
            ? 'Every golfer is re-tiered by odds-to-win. Manual tier assignments will be replaced. Prices are untouched.'
            : 'Every golfer is re-tiered by world ranking. Manual tier assignments will be replaced. Prices are untouched.'
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

      <ConfirmationModal
        confirmLabel="Replace prices"
        confirmTestId="root-admin-golf-tier-auto-prices-confirm"
        description="Every golfer's price is recomputed across the range below from best to worst seed. Manual prices will be replaced. Tier assignments are untouched."
        errorMessage={
          autoPricesMutation.isError
            ? extractErrorMessage(autoPricesMutation.error, {
                fallback: 'We could not auto-assign prices.',
              })
            : undefined
        }
        isConfirmDisabled={!priceRangeValid}
        isPending={autoPricesMutation.isPending}
        onCancel={() => setPriceOpen(false)}
        onConfirm={() => autoPricesMutation.mutate()}
        onOpenChange={(next) => !next && setPriceOpen(false)}
        open={priceOpen}
        testId="root-admin-golf-tier-auto-prices-modal"
        title="Auto-assign prices"
        tone="danger"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            error={
              !/^\d+$/.test(minPrice) ? 'Enter a whole number' : undefined
            }
            label="Min price"
          >
            <Input
              data-testid="root-admin-golf-tier-auto-prices-min"
              inputMode="numeric"
              onChange={(event) => setMinPrice(event.target.value)}
              value={minPrice}
            />
          </FormField>
          <FormField
            error={
              /^\d+$/.test(maxPrice) && Number(maxPrice) <= Number(minPrice)
                ? 'Max must exceed min'
                : !/^\d+$/.test(maxPrice)
                  ? 'Enter a whole number'
                  : undefined
            }
            label="Max price"
          >
            <Input
              data-testid="root-admin-golf-tier-auto-prices-max"
              inputMode="numeric"
              onChange={(event) => setMaxPrice(event.target.value)}
              value={maxPrice}
            />
          </FormField>
        </div>
      </ConfirmationModal>
    </div>
  );
}

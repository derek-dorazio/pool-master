import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  AsyncPage,
  Callout,
  LinkButton,
  SplitContentLayout,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { GolfTournamentHeader } from './golf-tournament-header';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { describeBudgetPricing } from './budget-pricing-format';
import { GolfPriceAssignAction } from './golf-price-assign-action';
import { GolfTierAutoAssignActions } from './golf-tier-auto-assign-actions';
import { GolfTierBoard } from './golf-tier-board';
import { GolfTierDefinitionsPanel } from './golf-tier-definitions-panel';
import { golfTiersLocked } from './golf-admin-utils';
import { useGolfFieldQuery, useGolfTiersQuery, useGolfTournamentQuery } from './use-golf-tournament';

/**
 * plans/124 §6.3 — /manage/golf/tournaments/:eventId/tiers. Owns the tournament /
 * tiers / field queries and the split layout; the tier-definition panel, the
 * drag-and-drop board, and the auto-assign actions are each their own component.
 * Prices are assigned here too, with the values they were assigned with shown
 * above the board (#93).
 */
export function RootAdminGolfTournamentTiersPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();

  const tournamentQuery = useGolfTournamentQuery(eventId);
  const tiersQuery = useGolfTiersQuery(eventId);
  const fieldQuery = useGolfFieldQuery(eventId);

  const tournament = tournamentQuery.data;
  useManagePageOwnsHeading();
  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const tiers = useMemo(() => tiersQuery.data ?? [], [tiersQuery.data]);
  const locked = tournament ? golfTiersLocked(tournament.status) : false;
  const field = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);

  const assignmentCountByTierKey = useMemo(() => {
    // A tier's assignments are the golfers whose valuation names it (#236).
    const counts: Record<string, number> = {};
    for (const tier of tiers) {
      counts[tier.tierKey] = field.filter(
        (entry) => entry.valuation?.sportEventTierId === tier.id,
      ).length;
    }
    return counts;
  }, [field, tiers]);

  const pageState = tournamentQuery.isLoading || tiersQuery.isLoading || fieldQuery.isLoading
    ? 'loading'
    : tournamentQuery.isError
      ? 'error'
      : 'ready';

  return (
    <AsyncPage
      errorBody={extractErrorMessage(tournamentQuery.error, {
        fallback: 'We could not load this golf tournament right now.',
      })}
      loadingBody="Loading tiers..."
      state={pageState}
      testId="root-admin-golf-tournament-tiers-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <GolfTournamentHeader current="tiers" tournament={tournament} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="root-admin-golf-tiers-pricing">
              {tournament.pricing
                ? `Priced with ${tournament.pricing.profileName}: ${describeBudgetPricing(tournament.pricing)}.`
                : 'Not priced yet. Prices are needed for budget contests and before release.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <GolfTierAutoAssignActions
                disabled={locked || field.length === 0}
                eventId={eventId}
              />
              <GolfPriceAssignAction
                activeGolferCount={field.filter((entry) => entry.isActive).length}
                current={tournament.pricing}
                disabled={locked || field.length === 0}
                eventId={eventId}
              />
            </div>
          </div>

          {locked ? (
            <Callout data-testid="root-admin-golf-tiers-locked" tone="info">
              This tournament has been released for contests, so its tiers and prices are
              locked for good. A golfer added to the field from now on stays without a tier
              and can&apos;t be picked.
            </Callout>
          ) : null}

          {tiersQuery.isError ? (
            <Alert data-testid="root-admin-golf-tiers-load-error" tone="danger">
              {extractErrorMessage(tiersQuery.error, {
                fallback: 'We could not load the tier definitions.',
              })}
            </Alert>
          ) : (
            <>
              {fieldQuery.isError ? (
                <Alert data-testid="root-admin-golf-tiers-field-error" tone="danger">
                  {extractErrorMessage(fieldQuery.error, {
                    fallback:
                      'We could not load the tournament field, so golfer names and the Unassigned column may be incomplete.',
                  })}
                </Alert>
              ) : null}
              {!fieldQuery.isError && field.length === 0 ? (
                <Callout tone="info">
                  This tournament has no field yet. Load or seed the field before
                  assigning golfers to tiers.
                  <span className="ml-2">
                    <LinkButton
                      data-testid="root-admin-golf-tiers-field-link"
                      size="sm"
                      to={`/manage/golf/tournaments/${eventId}/field`}
                      variant="secondary"
                    >
                      Open Field
                    </LinkButton>
                  </span>
                </Callout>
              ) : null}
              <SplitContentLayout
                aside={
                  <GolfTierBoard
                    eventId={eventId}
                    field={field}
                    locked={locked}
                    tiers={tiers}
                  />
                }
                main={
                  <GolfTierDefinitionsPanel
                    assignmentCountByTierKey={assignmentCountByTierKey}
                    eventId={eventId}
                    locked={locked}
                    tiers={tiers}
                  />
                }
              />
            </>
          )}
        </div>
      ) : null}
    </AsyncPage>
  );
}

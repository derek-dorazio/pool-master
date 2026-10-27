import { useMemo } from 'react';
import { useParams } from 'react-router';
import {
  Alert,
  AsyncPage,
  Callout,
  LinkButton,
  SplitContentLayout,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SportEventHeader } from './sport-event-header';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { describeBudgetPricing } from './budget-pricing-format';
import { PriceAssignAction } from './price-assign-action';
import { TierAutoAssignActions } from './tier-auto-assign-actions';
import { TierBoard } from './tier-board';
import { TierDefinitionsPanel } from './tier-definitions-panel';
import { eventTiersLocked } from './sport-admin-utils';
import { useSportEventFieldQuery, useSportEventTiersQuery, useSportEventQuery } from './use-sport-event';
import { buildSportEventPath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/124 §6.3 — /manage/sports/:sport/events/:eventId/tiers. Owns the tournament /
 * tiers / field queries and the split layout; the tier-definition panel, the
 * drag-and-drop board, and the auto-assign actions are each their own component.
 * Prices are assigned here too, with the values they were assigned with shown
 * above the board (#93).
 */
export function RootAdminSportEventTiersPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const { sport, definition } = useManagedSport();
  const { event, participant } = definition.vocabulary;

  const tournamentQuery = useSportEventQuery(eventId);
  const tiersQuery = useSportEventTiersQuery(eventId);
  const fieldQuery = useSportEventFieldQuery(eventId);

  const tournament = tournamentQuery.data;
  useManagePageOwnsHeading();
  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const tiers = useMemo(() => tiersQuery.data ?? [], [tiersQuery.data]);
  const locked = tournament ? eventTiersLocked(tournament.status) : false;
  const field = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);

  const assignmentCountByTierKey = useMemo(() => {
    // A tier's assignments are the participants whose valuation names it (#236).
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
        fallback: `We could not load this ${event.one} right now.`,
      })}
      loadingBody="Loading tiers..."
      state={pageState}
      testId="root-admin-sport-event-tiers-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <SportEventHeader current="tiers" tournament={tournament} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="root-admin-tiers-pricing">
              {tournament.pricing
                ? `Priced with ${tournament.pricing.profileName}: ${describeBudgetPricing(tournament.pricing)}.`
                : 'Not priced yet. Prices are needed for budget contests and before release.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <TierAutoAssignActions
                disabled={locked || field.length === 0}
                eventId={eventId}
                sport={tournament.sport}
              />
              <PriceAssignAction
                activeParticipantCount={field.filter((entry) => entry.isActive).length}
                current={tournament.pricing}
                disabled={locked || field.length === 0}
                eventId={eventId}
                sport={tournament.sport}
              />
            </div>
          </div>

          {locked ? (
            <Callout data-testid="root-admin-tiers-locked" tone="info">
              This {event.one} has been released for contests, so its tiers and prices are
              locked for good. A {participant.one} added to the field from now on stays without
              a tier and can&apos;t be picked.
            </Callout>
          ) : null}

          {tiersQuery.isError ? (
            <Alert data-testid="root-admin-tiers-load-error" tone="danger">
              {extractErrorMessage(tiersQuery.error, {
                fallback: 'We could not load the tier definitions.',
              })}
            </Alert>
          ) : (
            <>
              {fieldQuery.isError ? (
                <Alert data-testid="root-admin-tiers-field-error" tone="danger">
                  {extractErrorMessage(fieldQuery.error, {
                    fallback:
                      `We could not load the ${event.one} field, so ${participant.one} names and the Unassigned column may be incomplete.`,
                  })}
                </Alert>
              ) : null}
              {!fieldQuery.isError && field.length === 0 ? (
                <Callout tone="info">
                  This {event.one} has no field yet. Load or seed the field before
                  assigning {participant.many} to tiers.
                  <span className="ml-2">
                    <LinkButton
                      data-testid="root-admin-tiers-field-link"
                      size="sm"
                      to={`${buildSportEventPath(sport, eventId)}/field`}
                      variant="secondary"
                    >
                      Open Field
                    </LinkButton>
                  </span>
                </Callout>
              ) : null}
              <SplitContentLayout
                aside={
                  <TierBoard
                    eventId={eventId}
                    field={field}
                    locked={locked}
                    sport={tournament.sport}
                    tiers={tiers}
                  />
                }
                main={
                  <TierDefinitionsPanel
                    assignmentCountByTierKey={assignmentCountByTierKey}
                    eventId={eventId}
                    locked={locked}
                    sport={tournament.sport}
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

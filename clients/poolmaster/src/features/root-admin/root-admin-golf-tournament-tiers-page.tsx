import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  adminGetGolfTournament,
  adminGetGolfTournamentField,
  adminGetGolfTournamentTiers,
} from '@/lib/api';
import {
  Alert,
  AsyncPage,
  Callout,
  LinkButton,
  SplitContentLayout,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminGetGolfTournamentFieldResponses,
  AdminGetGolfTournamentTiersResponses,
} from '@/lib/api';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';
import {
  isAdminManagedGolfTournament,
  type AdminGolfTournamentDetail,
} from './golf-admin-utils';
import { GolfTierAutoAssignActions } from './golf-tier-auto-assign-actions';
import { GolfTierBoard } from './golf-tier-board';
import { GolfTierDefinitionsPanel } from './golf-tier-definitions-panel';

type TierDto = AdminGetGolfTournamentTiersResponses[200]['tiers'][number];
type FieldEntry =
  AdminGetGolfTournamentFieldResponses[200]['entries'][number];

/**
 * plans/124 §6.3 — /manage/golf/tournaments/:eventId/tiers. Owns the tournament /
 * tiers / field queries and the split layout; the tier-definition panel, the
 * drag-and-drop board, and the auto-assign actions are each their own component.
 */
export function RootAdminGolfTournamentTiersPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();

  const tournamentQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tournament(eventId),
    queryFn: async (): Promise<AdminGolfTournamentDetail> => {
      const response = await adminGetGolfTournament({ path: { eventId } });
      if (!response.data?.tournament) {
        throw response.error ?? new Error('Golf tournament response is missing data.');
      }
      return response.data.tournament;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const tiersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.tiers(eventId),
    queryFn: async (): Promise<TierDto[]> => {
      const response = await adminGetGolfTournamentTiers({ path: { eventId } });
      if (!response.data?.tiers) {
        throw response.error ?? new Error('Golf tiers response is missing data.');
      }
      return response.data.tiers;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const fieldQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.field(eventId),
    queryFn: async (): Promise<FieldEntry[]> => {
      const response = await adminGetGolfTournamentField({ path: { eventId } });
      if (!response.data?.entries) {
        throw response.error ?? new Error('Golf tournament field response is missing data.');
      }
      return response.data.entries;
    },
    enabled: eventId !== '',
    retry: false,
  });

  const tournament = tournamentQuery.data;
  useManageBreadcrumbOverride(eventId || undefined, tournament?.name);

  const tiers = useMemo(() => tiersQuery.data ?? [], [tiersQuery.data]);
  const field = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);

  const assignmentCountByTierKey = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tier of tiers) {
      counts[tier.tierKey] = tier.assignments.length;
    }
    return counts;
  }, [tiers]);

  const pageState = tournamentQuery.isLoading || tiersQuery.isLoading || fieldQuery.isLoading
    ? 'loading'
    : tournamentQuery.isError
      ? 'error'
      : 'ready';

  const readOnly = tournament
    ? !isAdminManagedGolfTournament(tournament.syncScope)
    : false;

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LinkButton
              data-testid="root-admin-golf-tiers-back"
              size="sm"
              to={`/manage/golf/tournaments/${eventId}`}
              variant="secondary"
            >
              ← Tournament Home
            </LinkButton>
            {!readOnly ? (
              <GolfTierAutoAssignActions
                disabled={field.length === 0}
                eventId={eventId}
              />
            ) : null}
          </div>

          {readOnly ? (
            <Alert tone="warning">
              This tournament is fully provider-owned. Tiers are read-only here.
            </Alert>
          ) : null}

          {!readOnly && tournament.contestCount > 0 ? (
            <Callout tone="info">
              This tournament has {tournament.contestCount} contest
              {tournament.contestCount === 1 ? '' : 's'}. Tier and price changes are
              rejected once any contest has entries, to keep existing picks consistent.
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
                    readOnly={readOnly}
                    tiers={tiers}
                  />
                }
                main={
                  <GolfTierDefinitionsPanel
                    assignmentCountByTierKey={assignmentCountByTierKey}
                    eventId={eventId}
                    readOnly={readOnly}
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

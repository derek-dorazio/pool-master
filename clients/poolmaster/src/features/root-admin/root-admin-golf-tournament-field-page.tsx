import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminGetGolfTournament, adminGetGolfTournamentField } from '@/lib/api';
import { Alert, AsyncPage, Button, LinkButton } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useManageBreadcrumbOverride } from './root-admin-manage-layout';
import {
  golfTournamentHasScoreSync,
  isAdminManagedGolfTournament,
  type AdminGolfTournamentDetail,
} from './golf-admin-utils';
import { GolfFieldGridCard, type GolfFieldEntry } from './golf-field-grid-card';
import { GolfFieldSeedAction } from './golf-field-seed-action';
import { GolfFieldRefreshAction } from './golf-field-refresh-action';
import { GolfFieldAddParticipantsModal } from './golf-field-add-participants-modal';

/**
 * plans/124 §6.3 — /manage/golf/tournaments/:eventId/field. Owns the tournament +
 * field queries and the header-action layout; the editable grid and each header
 * action are their own component.
 */
export function RootAdminGolfTournamentFieldPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const [addOpen, setAddOpen] = useState(false);

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

  const fieldQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.golf.field(eventId),
    queryFn: async (): Promise<GolfFieldEntry[]> => {
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

  const entries = useMemo(() => fieldQuery.data ?? [], [fieldQuery.data]);
  const existingParticipantIds = useMemo(
    () => new Set(entries.map((entry) => entry.participantId)),
    [entries],
  );

  const pageState = tournamentQuery.isLoading
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
      loadingBody="Loading tournament field..."
      state={pageState}
      testId="root-admin-golf-tournament-field-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LinkButton
              data-testid="root-admin-golf-field-back"
              size="sm"
              to={`/manage/golf/tournaments/${eventId}`}
              variant="secondary"
            >
              ← Tournament Home
            </LinkButton>
            {!readOnly ? (
              <div className="flex flex-wrap gap-2">
                <GolfFieldSeedAction eventId={eventId} />
                <Button
                  data-testid="root-admin-golf-field-add"
                  onClick={() => setAddOpen(true)}
                  size="sm"
                >
                  Add more participants
                </Button>
                {golfTournamentHasScoreSync(tournament.syncScope) ? (
                  <GolfFieldRefreshAction
                    eventId={eventId}
                    fieldCount={entries.length}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {readOnly ? (
            <Alert tone="warning">
              This tournament is fully provider-owned. Its field is read-only here.
            </Alert>
          ) : null}

          <GolfFieldGridCard
            entries={entries}
            eventId={eventId}
            fieldError={
              fieldQuery.isError
                ? extractErrorMessage(fieldQuery.error, {
                    fallback: 'We could not load the field right now.',
                  })
                : null
            }
            fieldLoading={fieldQuery.isLoading}
            readOnly={readOnly}
          />

          {addOpen ? (
            <GolfFieldAddParticipantsModal
              eventId={eventId}
              existingParticipantIds={existingParticipantIds}
              onClose={() => setAddOpen(false)}
            />
          ) : null}
        </div>
      ) : null}
    </AsyncPage>
  );
}

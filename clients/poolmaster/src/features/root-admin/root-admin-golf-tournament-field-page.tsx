import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AsyncPage, Button } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { GolfTournamentHeader } from './golf-tournament-header';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { golfTiersLocked, golfTournamentHasScoreSync } from './golf-admin-utils';
import { GolfFieldGridCard } from './golf-field-grid-card';
import { GolfFieldSeedAction } from './golf-field-seed-action';
import { GolfFieldRefreshAction } from './golf-field-refresh-action';
import { GolfFieldAddParticipantsModal } from './golf-field-add-participants-modal';
import { GolfFieldUploadCard } from './golf-field-upload-card';
import { useGolfFieldQuery, useGolfTournamentQuery } from './use-golf-tournament';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/124 §6.3 — /manage/sports/:sport/events/:eventId/field. Owns the tournament +
 * field queries and the header-action layout; the editable grid and each header
 * action are their own component.
 */
export function RootAdminGolfTournamentFieldPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { event } = useManagedSport().definition.vocabulary;

  const tournamentQuery = useGolfTournamentQuery(eventId);
  const fieldQuery = useGolfFieldQuery(eventId);

  const tournament = tournamentQuery.data;
  useManagePageOwnsHeading();
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

  return (
    <AsyncPage
      errorBody={extractErrorMessage(tournamentQuery.error, {
        fallback: `We could not load this ${event.one} right now.`,
      })}
      loadingBody={`Loading ${event.one} field...`}
      state={pageState}
      testId="root-admin-golf-tournament-field-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <GolfTournamentHeader current="field" tournament={tournament} />

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap gap-2">
              <GolfFieldSeedAction eventId={eventId} sport={tournament.sport} />
              <Button
                data-testid="root-admin-golf-field-add"
                onClick={() => setAddOpen(true)}
                size="sm"
              >
                Add more participants
              </Button>
              <Button
                data-testid="root-admin-golf-field-upload-open"
                disabled={uploadOpen}
                onClick={() => setUploadOpen(true)}
                size="sm"
                variant="secondary"
              >
                Bulk upload
              </Button>
              {golfTournamentHasScoreSync(tournament.syncScope) ? (
                <GolfFieldRefreshAction
                  eventId={eventId}
                  fieldCount={entries.length}
                />
              ) : null}
            </div>
          </div>

          {uploadOpen ? (
            <GolfFieldUploadCard
              entries={entries}
              eventId={eventId}
              onClose={() => setUploadOpen(false)}
              sport={tournament.sport}
            />
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
            pricesLocked={golfTiersLocked(tournament.status)}
            sport={tournament.sport}
          />

          {addOpen ? (
            <GolfFieldAddParticipantsModal
              eventId={eventId}
              existingParticipantIds={existingParticipantIds}
              onClose={() => setAddOpen(false)}
              sport={tournament.sport}
            />
          ) : null}
        </div>
      ) : null}
    </AsyncPage>
  );
}

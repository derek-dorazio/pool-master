import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AsyncPage, Button } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { SportEventHeader } from './sport-event-header';
import { useManageBreadcrumbOverride, useManagePageOwnsHeading } from './manage-breadcrumb-context';
import { eventTiersLocked, sportEventHasScoreSync } from './sport-admin-utils';
import { EventFieldGridCard } from './event-field-grid-card';
import { EventFieldSeedAction } from './event-field-seed-action';
import { EventFieldRefreshAction } from './event-field-refresh-action';
import { EventFieldAddParticipantsModal } from './event-field-add-participants-modal';
import { EventFieldUploadCard } from './event-field-upload-card';
import { useSportEventFieldQuery, useSportEventQuery } from './use-sport-event';
import { useSportLeagueNoun } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

/**
 * plans/124 §6.3 — /manage/sports/:sport/events/:eventId/field. Owns the tournament +
 * field queries and the header-action layout; the editable grid and each header
 * action are their own component.
 */
export function RootAdminSportEventFieldPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;

  const tournamentQuery = useSportEventQuery(eventId);
  const fieldQuery = useSportEventFieldQuery(eventId);

  const tournament = tournamentQuery.data;
  const sportLeagueNoun = useSportLeagueNoun(sport, tournament?.sportLeagueId);
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
      testId="root-admin-sport-event-field-page"
    >
      {tournament ? (
        <div className="space-y-6">
          <SportEventHeader current="field" tournament={tournament} />

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap gap-2">
              <EventFieldSeedAction eventId={eventId} sport={tournament.sport} sportLeague={sportLeagueNoun} />
              <Button
                data-testid="root-admin-event-field-add"
                onClick={() => setAddOpen(true)}
                size="sm"
              >
                Add more participants
              </Button>
              <Button
                data-testid="root-admin-event-field-upload-open"
                disabled={uploadOpen}
                onClick={() => setUploadOpen(true)}
                size="sm"
                variant="secondary"
              >
                Bulk upload
              </Button>
              {sportEventHasScoreSync(tournament.syncScope) ? (
                <EventFieldRefreshAction
                  eventId={eventId}
                  fieldCount={entries.length}
                />
              ) : null}
            </div>
          </div>

          {uploadOpen ? (
            <EventFieldUploadCard
              entries={entries}
              eventId={eventId}
              onClose={() => setUploadOpen(false)}
              sport={tournament.sport}
            />
          ) : null}

          <EventFieldGridCard
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
            pricesLocked={eventTiersLocked(tournament.status)}
            sport={tournament.sport}
            sportLeagueNoun={sportLeagueNoun}
          />

          {addOpen ? (
            <EventFieldAddParticipantsModal
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

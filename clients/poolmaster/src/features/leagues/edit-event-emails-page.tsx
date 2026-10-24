import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { updateLeagueEventEmailSettings, type LeagueDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { Button, Checkbox, ErrorState, FormPage, LoadingState } from '@/features/shared/ui';
import {
  EVENT_EMAIL_FEATURES,
  describeEventEmailsPage,
  groupEventEmailSportLeagues,
  hasEventEmails,
  type EventEmailSport,
} from './event-emails-view';
import { syncLeagueCaches } from './league-cache';
import { buildLeagueAdminPath } from './league-routing';
import { useLeagueContext } from './use-league-context';

/**
 * Edit event emails (#851): which sport leagues' upcoming events the league's commissioners are
 * emailed about, "Coming up soon" and "Ready for contests", ticked in groups by sport. On a plan
 * with neither email, the locked note instead.
 */
export function EditEventEmailsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league, viewer } = useLeagueContext(leagueCode);
  const sportLeaguesQuery = useSportLeaguesQuery();
  const sports = useMemo(() => groupEventEmailSportLeagues(sportLeaguesQuery.data ?? []), [sportLeaguesQuery.data]);

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }
  // An inactive league is read-only; its settings page says why Edit is unavailable.
  if (!league.isActive) {
    return <Navigate replace to={buildLeagueAdminPath(league.leagueCode)} />;
  }
  if (!hasEventEmails(league)) {
    return <PlanLockedNotice feature={EVENT_EMAIL_FEATURES[0]} isCommissioner={viewer.isCommissioner} leagueCode={league.leagueCode} title="Event emails" />;
  }
  if (sportLeaguesQuery.isLoading) {
    return <LoadingState testId="edit-event-emails-loading" />;
  }
  if (sportLeaguesQuery.isError) {
    return (
      <ErrorState
        body={extractErrorMessage(sportLeaguesQuery.error, { fallback: 'We could not load the sport leagues.' })}
        testId="edit-event-emails-error"
        title="Sport leagues unavailable"
      />
    );
  }

  // Keyed by the league so a background refetch never overwrites the draft
  // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  return <EventEmailsForm key={league.id} league={league} sports={sports} />;
}

function EventEmailsForm({ league, sports }: { league: LeagueDto; sports: EventEmailSport[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settingsPath = buildLeagueAdminPath(league.leagueCode);
  // Muted ids of sport leagues not listed (no longer active) stay muted: the save sends them back.
  const [muted, setMuted] = useState(() => new Set(league.mutedSportLeagueIds));
  const allIds = sports.flatMap((sport) => sport.sportLeagues.map((sportLeague) => sportLeague.id));

  const setHeard = (ids: readonly string[], heard: boolean) => {
    setMuted((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (heard) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (mutedSportLeagueIds: string[]) => {
      const response = await updateLeagueEventEmailSettings({
        path: { id: league.id },
        body: { mutedSportLeagueIds },
      });
      if (!response.data?.league) {
        throwApiError(response.error, 'Event email settings response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      navigate(settingsPath);
    },
    // Nothing else shows which sport leagues the league hears about.
    invalidates: [],
  });
  const isPending = saveMutation.isPending;

  return (
    <FormPage
      cancelTo={settingsPath}
      description={describeEventEmailsPage(league)}
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not save the event email settings.' })
        : null}
      isPending={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate([...muted]);
      }}
      pendingLabel="Saving..."
      submitLabel="Save settings"
      submitTestId="edit-event-emails-save"
      testId="edit-event-emails-page"
      title="Edit event emails"
    >
      <div className="flex flex-wrap gap-2">
        <Button data-testid="edit-event-emails-all" disabled={isPending} onClick={() => setHeard(allIds, true)} size="sm" type="button" variant="secondary">
          Select all
        </Button>
        <Button data-testid="edit-event-emails-none" disabled={isPending} onClick={() => setHeard(allIds, false)} size="sm" type="button" variant="secondary">
          Clear all
        </Button>
      </div>

      {sports.map((sport) => {
        const ids = sport.sportLeagues.map((sportLeague) => sportLeague.id);
        const heardCount = ids.filter((id) => !muted.has(id)).length;
        return (
          <fieldset className="space-y-2" data-testid={`edit-event-emails-sport-${sport.sport}`} key={sport.sport}>
            <legend className="sr-only">{sport.name}</legend>
            <label className="flex items-center gap-3">
              <Checkbox
                checked={heardCount === ids.length}
                data-testid={`edit-event-emails-sport-${sport.sport}-all`}
                disabled={isPending}
                indeterminate={heardCount > 0 && heardCount < ids.length}
                onChange={(event) => setHeard(ids, event.target.checked)}
              />
              <span className="text-sm font-semibold text-foreground">{sport.name}</span>
            </label>
            <div className="grid gap-2 pl-7 sm:grid-cols-2">
              {sport.sportLeagues.map((sportLeague) => (
                <label className="flex items-center gap-3 text-sm text-foreground" key={sportLeague.id}>
                  <Checkbox
                    checked={!muted.has(sportLeague.id)}
                    data-testid={`edit-event-emails-league-${sportLeague.id}`}
                    disabled={isPending}
                    onChange={(event) => setHeard([sportLeague.id], event.target.checked)}
                  />
                  {sportLeague.name}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Sport leagues added later are included until you clear them. Each commissioner can also turn off
        Commissioner updates for themselves in their email settings.
      </p>
    </FormPage>
  );
}

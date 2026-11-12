import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { EventEmailDelivery } from '@poolmaster/shared/domain';
import { updateLeagueEventEmailSettings, type LeagueDto, type UpdateLeagueEventEmailSettingsRequest } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import {
  Button,
  Checkbox,
  ChoiceCard,
  ChoiceCardText,
  FormPage,
  FormSection,
  QueryState,
  SectionCard,
  SectionRow,
  SectionRows,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import {
  EVENT_EMAIL_DELIVERIES,
  EVENT_EMAIL_DELIVERY_COPY,
  EVENT_EMAIL_FEATURES,
  describeEventEmailsPage,
  groupEventEmailSportLeagues,
  hasEventEmails,
  hasWeeklyDigest,
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
  // Keyed by the league so a background refetch never overwrites the draft
  // (rules/react-ui-rules.md §5 Server Data Form-State Hazard). Nothing to save until the sport
  // leagues are in.
  return (
    <QueryState
      empty="There are no sport leagues to hear about yet."
      error={extractErrorMessage(sportLeaguesQuery.error, { fallback: 'We could not load the sport leagues.' })}
      isEmpty={(sportLeagues) => sportLeagues.length === 0}
      loading="Loading sport leagues..."
      query={sportLeaguesQuery}
      testId="edit-event-emails"
    >
      {() => <EventEmailsForm key={league.id} league={league} sports={sports} />}
    </QueryState>
  );
}

function EventEmailsForm({ league, sports }: { league: LeagueDto; sports: EventEmailSport[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { locale } = useDisplayPreferences();
  const settingsPath = buildLeagueAdminPath(league.leagueCode);
  // Muted ids of sport leagues not listed (no longer active) stay muted: the save sends them back.
  const [muted, setMuted] = useState(() => new Set(league.mutedSportLeagueIds));
  const allIds = sports.flatMap((sport) => sport.sportLeagues.map((sportLeague) => sportLeague.id));
  const offersDigest = hasWeeklyDigest(league);
  // On a plan without the digest, a saved digest choice goes back to an email for each event.
  const [delivery, setDelivery] = useState<EventEmailDelivery>(() => (offersDigest ? league.eventEmailDelivery : EventEmailDelivery.PER_EVENT));

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
    mutationFn: async (body: UpdateLeagueEventEmailSettingsRequest) => {
      const response = await updateLeagueEventEmailSettings({ path: { id: league.id }, body });
      if (!response.data?.league) {
        throwApiError(response.error, 'Event email settings response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      void navigate(settingsPath);
    },
    // Nothing else shows how the league hears about events.
    invalidates: [],
  });
  const isPending = saveMutation.isPending;

  return (
    <FormPage
      cancelTo={settingsPath}
      help={describeEventEmailsPage(league)}
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, { fallback: 'We could not save the event email settings.' })
        : null}
      isPending={isPending}
      onSubmit={(event) => {
        event.preventDefault();
        saveMutation.mutate({ mutedSportLeagueIds: [...muted], eventEmailDelivery: delivery });
      }}
      pendingLabel="Saving..."
      submitLabel="Save settings"
      submitTestId="edit-event-emails-save"
      testId="edit-event-emails-page"
      title="Edit event emails"
    >
      {offersDigest ? (
        <FormSection testId="edit-event-emails-delivery" title="How you get them">
          <div aria-label="How you get them" className="grid gap-2" role="radiogroup">
            {EVENT_EMAIL_DELIVERIES.map((option) => (
              <ChoiceCard
                isDisabled={isPending}
                isSelected={option === delivery}
                key={option}
                onSelect={() => setDelivery(option)}
                testId={`edit-event-emails-delivery-${option}`}
              >
                <ChoiceCardText description={EVENT_EMAIL_DELIVERY_COPY[option].description} label={EVENT_EMAIL_DELIVERY_COPY[option].label} />
              </ChoiceCard>
            ))}
          </div>
        </FormSection>
      ) : null}

      <FormSection
        help="Sport leagues added later are included until you clear them. Each commissioner can also turn off Commissioner updates for themselves in their email settings."
        testId="edit-event-emails-leagues"
        title="Sport leagues"
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
            <SectionCard
              headingLevel={4}
              key={sport.sport}
              testId={`edit-event-emails-sport-${sport.sport}`}
              title={sport.name}
              trailing={(
                <>
                  <span data-testid={`edit-event-emails-sport-${sport.sport}-count`}>{`${formatNumber(heardCount, locale)} chosen`}</span>
                  <Checkbox
                    aria-label={`All ${sport.name}`}
                    checked={heardCount === ids.length}
                    data-testid={`edit-event-emails-sport-${sport.sport}-all`}
                    disabled={isPending}
                    indeterminate={heardCount > 0 && heardCount < ids.length}
                    onChange={(event) => setHeard(ids, event.target.checked)}
                  />
                </>
              )}
            >
              <SectionRows>
                {sport.sportLeagues.map((sportLeague) => (
                  <SectionRow
                    control={(
                      <Checkbox
                        aria-label={sportLeague.name}
                        checked={!muted.has(sportLeague.id)}
                        data-testid={`edit-event-emails-league-${sportLeague.id}`}
                        disabled={isPending}
                        onChange={(event) => setHeard([sportLeague.id], event.target.checked)}
                      />
                    )}
                    isSelected={!muted.has(sportLeague.id)}
                    key={sportLeague.id}
                    name={sportLeague.name}
                    testId={`edit-event-emails-row-${sportLeague.id}`}
                  />
                ))}
              </SectionRows>
            </SectionCard>
          );
        })}
      </FormSection>
    </FormPage>
  );
}

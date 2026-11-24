import { ContestStatus, coversOneEvent } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { listEvents, setContestSportEvents, type ContestDto, type SportEventDto, type SportLeagueSeasonDto } from '@/lib/api';
import { useSportLeagueSeasonsQuery } from './use-sport-league-seasons';
import { buildLeagueAdminContestPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  Button,
  Checkbox,
  DateDisplay,
  FormField,
  FormPage,
  Icon,
  LoadingState,
  QueryState,
  SectionBody,
  SectionCard,
  SectionEmpty,
  SectionNote,
  SectionRow,
  SectionRows,
  Select,
  Text,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { firstContestEvent, hasContestEventStarted } from './contest-events';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useContestQuery } from './use-contest-query';
import { entryWriteKeys } from './use-contest-entries';

/** Why an event outside the contest can't be added right now; null when it can. */
function unavailableReason(event: SportEventDto): string | null {
  if (event.contestEligible) {
    return null;
  }
  switch (event.readinessStatus) {
    case 'EVENT_STARTED':
      return 'Started';
    case 'PENDING_FIELD':
      return 'Field not loaded yet';
    case 'NOT_RELEASED':
      return 'Not released yet';
    case 'CONTEST_ELIGIBLE':
      return null;
  }
}

type ChosenEvent = { id: string; name: string; startDate: string };

function byStartDate(left: { startDate: string; id: string }, right: { startDate: string; id: string }) {
  return Date.parse(left.startDate) - Date.parse(right.startDate) || left.id.localeCompare(right.id);
}

/** One Season's events, read when it is picked rather than every Season at once (#1198, #2003). */
function seasonEventsQueryOptions(sportLeagueSeasonId: string) {
  return {
    queryKey: QueryKeys.sportEvents.bySportLeagueSeason(sportLeagueSeasonId),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sportLeagueSeasonId } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }
      return response.data.events;
    },
    retry: false,
  };
}

/**
 * The event picker for one contest (#713). Mount it with `key={contest.id}` so the draft is built
 * once and a background refetch never overwrites the choices being made (rules/react-ui-rules.md
 * §5).
 */
function ContestEventsForm({
  contest,
  firstEvent,
  leagueCode,
  seasons,
  leagueId,
}: {
  contest: ContestDto;
  firstEvent: SportEventDto;
  leagueCode: string;
  seasons: SportLeagueSeasonDto[];
  leagueId: string;
}) {
  const logger = useMemo(() => getLogger().child({ feature: 'contest-events-page' }), []);
  const navigate = useNavigate();
  const contestPath = buildLeagueAdminContestPath(leagueCode, contest.id);
  // The chosen events by id, each with what the order list shows: a season read later may not hold it.
  const [selected, setSelected] = useState<ReadonlyMap<string, ChosenEvent>>(
    () => new Map(contest.sportEvents.map((sportEvent) => [
      sportEvent.sportEventId,
      { id: sportEvent.sportEventId, name: sportEvent.name, startDate: sportEvent.startDate },
    ])),
  );
  // The picker opens on the first event's Season and lists the league's Seasons by name.
  const [seasonId, setSeasonId] = useState(firstEvent.sportLeagueSeasonId);
  const seasonName = seasons.find((season) => season.id === seasonId)?.name ?? '';
  const seasonEventsQuery = useQuery(seasonEventsQueryOptions(seasonId));
  useEffect(() => {
    if (seasonEventsQuery.isError) {
      logger.warn({ action: 'contest.events.season.load.failed', data: { leagueCode, contestId: contest.id, sportLeagueSeasonId: seasonId }, err: seasonEventsQuery.error }, 'Contest events page failed to load a Season of events');
    }
  }, [contest.id, leagueCode, logger, seasonId, seasonEventsQuery.error, seasonEventsQuery.isError]);
  const contestEventIds = useMemo(
    () => new Set(contest.sportEvents.map((sportEvent) => sportEvent.sportEventId)),
    [contest.sportEvents],
  );
  // Once one of the contest's events has started, its events can be added to but not removed.
  const removalsLocked = contest.sportEvents.some((sportEvent) => hasContestEventStarted(sportEvent));
  const seasonEvents = useMemo(
    () => [...(seasonEventsQuery.data ?? [])].sort(byStartDate),
    [seasonEventsQuery.data],
  );
  const addable = seasonEvents.filter((event) => !selected.has(event.id) && event.contestEligible);

  // The chosen events in the order the contest will play them: by start, as the server keeps them.
  const chosen = useMemo(() => [...selected.values()].sort(byStartDate), [selected]);
  const chosenThisSeason = seasonEvents.filter((event) => selected.has(event.id)).length;
  const { locale } = useDisplayPreferences();

  function toggle(event: SportEventDto) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(event.id)) {
        next.delete(event.id);
      } else {
        next.set(event.id, { id: event.id, name: event.name, startDate: event.startDate });
      }
      return next;
    });
  }

  function addAll() {
    setSelected((current) => new Map([
      ...current,
      ...addable.map((event) => [event.id, { id: event.id, name: event.name, startDate: event.startDate }] as const),
    ]));
  }

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (sportEventIds: string[]) => {
      const response = await setContestSportEvents({
        path: { id: leagueId, contestId: contest.id },
        body: { sportEventIds },
      });
      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest events response is missing data.');
      }
      return response.data.contest;
    },
    onSuccess: () => {
      logger.info({ action: 'contest.events.save.succeeded', data: { leagueCode, contestId: contest.id } }, 'Saved contest events');
      void navigate(contestPath);
    },
    invalidates: [
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.managedContests.all,
      ...entryWriteKeys(contest.id),
      QueryKeys.selectionStates.byContest(contest.id),
    ],
    onError: (error) => {
      const payload = { action: 'contest.events.save.failed', data: { leagueCode, contestId: contest.id }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest events save was rejected');
      } else {
        logger.error(payload, 'Contest events save failed unexpectedly');
      }
    },
  });

  const removedCount = [...contestEventIds].filter((id) => !selected.has(id)).length;

  return (
    <FormPage
      cancelTo={contestPath}
      help={removalsLocked
        ? 'The contest has started, so you can add events but not remove them. Entries make picks for each event before it starts.'
        : 'Choose the events this contest covers. Entries make picks for each event before it starts, and the contest is final when the last one ends.'}
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, {
          context: ['contestEvents', 'contestSetup'],
          fallback: 'We could not save these events. Please try again.',
        })
        : null}
      isPending={saveMutation.isPending}
      isSubmitDisabled={chosen.length === 0}
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        saveMutation.mutate(chosen.map((event) => event.id));
      }}
      pendingLabel="Saving..."
      submitLabel="Save events"
      submitTestId="contest-events-save"
      testId="contest-events-page"
      title="Contest events"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FormField className="w-40" label="Season">
          <Select
            data-testid="contest-events-season"
            onChange={(event) => setSeasonId(event.target.value)}
            value={seasonId}
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>{season.name}</option>
            ))}
          </Select>
        </FormField>
        <Button
          data-testid="contest-events-add-all"
          disabled={addable.length === 0}
          onClick={addAll}
          type="button"
          variant="secondary"
        >
          {addable.length ? `Add all ${addable.length}` : 'Add all'}
        </Button>
      </div>

      <SectionCard
        testId="contest-events-options"
        title={`${seasonName} events`}
        trailing={<span data-testid="contest-events-chosen-count">{`${formatNumber(chosenThisSeason, locale)} chosen`}</span>}
      >
        <QueryState
          empty={`No events in ${seasonName} yet.`}
          error={`We couldn't load the ${seasonName} events.`}
          isEmpty={(events) => events.length === 0}
          loading={`Loading ${seasonName} events...`}
          query={seasonEventsQuery}
          rows={3}
          testId="contest-events-season"
        >
          {() => (
            <SectionRows>
              {seasonEvents.map((event) => {
                const isChosen = selected.has(event.id);
                const inContest = contestEventIds.has(event.id);
                const locked = inContest && removalsLocked;
                const reason = inContest ? null : unavailableReason(event);
                return (
                  <SectionRow
                    aside={locked ? (
                      <Text className="inline-flex items-center gap-1.5" variant="caption">
                        <Icon icon={Lock} size={13} />
                        In the contest
                      </Text>
                    ) : undefined}
                    control={(
                      <Checkbox
                        aria-label={event.name}
                        checked={isChosen}
                        data-testid={`contest-events-option-${event.id}`}
                        disabled={locked || (!isChosen && reason !== null)}
                        onChange={() => toggle(event)}
                      />
                    )}
                    facts={(
                      <>
                        <DateDisplay tone="inherit" value={event.startDate} />
                        {reason ? ` · ${reason}` : ''}
                      </>
                    )}
                    isSelected={isChosen}
                    key={event.id}
                    name={event.name}
                    testId={`contest-events-row-${event.id}`}
                  />
                );
              })}
            </SectionRows>
          )}
        </QueryState>
      </SectionCard>

      <SectionCard
        testId="contest-events-chosen"
        title={chosen.length === 1 ? '1 event, in order' : `${chosen.length} events, in order`}
      >
        {chosen.length ? (
          <SectionRows>
            {chosen.map((event, index) => (
              <SectionRow
                facts={<DateDisplay tone="inherit" value={event.startDate} />}
                key={event.id}
                name={event.name}
                testId={`contest-events-chosen-${event.id}`}
                value={index + 1}
              />
            ))}
          </SectionRows>
        ) : (
          <SectionEmpty testId="contest-events-chosen-empty">Choose at least one event.</SectionEmpty>
        )}
        {removedCount > 0 ? (
          <SectionBody>
            <SectionNote testId="contest-events-removal-note">Picks already made for a removed event are deleted.</SectionNote>
          </SectionBody>
        ) : null}
      </SectionCard>
    </FormPage>
  );
}

/**
 * Commissioner tools › Contests › one contest › Events: which events of its sport league the
 * contest covers (#713), with Add all for a season. Events can be added until the contest is
 * final, and removed only until one of them starts. A random draw deals one event, so it has no
 * events to change and this page goes back to the contest.
 */
export function ContestEventsPage() {
  const { leagueCode = '', contestId = '' } = useParams<{ leagueCode: string; contestId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const contestQuery = useContestQuery(contestId);
  const contest = contestQuery.data ?? null;
  const firstEventQuery = useQuery(sportEventQueryOptions((contest ? firstContestEvent(contest)?.sportEventId : undefined) ?? ''));
  const firstEvent = firstEventQuery.data;
  const sportLeagueId = firstEvent?.sportLeagueId ?? null;
  // The Seasons the picker offers, not every Season's events (#1198, #2003).
  const seasonsQuery = useSportLeagueSeasonsQuery(sportLeagueId ?? '');
  const contestPath = buildLeagueAdminContestPath(leagueCode, contestId);

  if (!league) {
    return null;
  }
  if (contestQuery.isLoading || firstEventQuery.isLoading || seasonsQuery.isLoading) {
    return <LoadingState body="Loading events..." testId="contest-events-loading" />;
  }
  // A missing contest or another league's, a final one, one that covers a single event (a draw, a bracket, squares), or a read that failed
  // goes back to the contest page, which says why.
  if (
    !contest
    || contest.leagueId !== league.id
    || !firstEvent
    || !seasonsQuery.data
    || contest.status === ContestStatus.COMPLETED
    || coversOneEvent(contest.selectionType)
    || !league.isActive
  ) {
    return <Navigate replace to={contestPath} />;
  }
  return (
    <ContestEventsForm
      contest={contest}
      firstEvent={firstEvent}
      key={contest.id}
      leagueCode={leagueCode}
      seasons={seasonsQuery.data}
      leagueId={league.id}
    />
  );
}

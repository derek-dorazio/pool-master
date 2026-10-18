import { ContestStatus } from '@poolmaster/shared/domain';
import {
  CONTEST_BUDGET_SALARY_CAP_MISMATCH,
  CONTEST_EVENTS_LEAGUE_MISMATCH,
  CONTEST_EVENTS_LOCKED,
} from '@poolmaster/shared/dto';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { listEvents, setContestSportEvents, type ContestDto, type SportEventDto } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError, type ErrorCodeMessages } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildLeagueAdminContestPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  Button,
  Checkbox,
  DateDisplay,
  FormField,
  FormPage,
  LoadingState,
  Select,
} from '@/features/shared/ui';
import { coversOneEvent, firstContestEvent, hasContestEventStarted } from './contest-events';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useLeagueContestsQuery } from './use-league-contests-query';

const CONTEST_EVENTS_CODE_MESSAGES: ErrorCodeMessages = {
  ...CONTEST_RELEASE_CODE_MESSAGES,
  [CONTEST_EVENTS_LOCKED]: 'An event in this contest has started, so its events can no longer be removed.',
  [CONTEST_EVENTS_LEAGUE_MISMATCH]: 'Every event in a contest comes from the same league.',
  [CONTEST_BUDGET_SALARY_CAP_MISMATCH]: 'These events have different salary caps, so they cannot share an open budget contest.',
};

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

function byStartDate(left: { startDate: string; id: string }, right: { startDate: string; id: string }) {
  return Date.parse(left.startDate) - Date.parse(right.startDate) || left.id.localeCompare(right.id);
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
  leagueEvents,
  leagueId,
}: {
  contest: ContestDto;
  firstEvent: SportEventDto;
  leagueCode: string;
  leagueEvents: SportEventDto[];
  leagueId: string;
}) {
  const logger = getLogger().child({ feature: 'contest-events-page' });
  const navigate = useNavigate();
  const contestPath = buildLeagueAdminContestPath(leagueCode, contest.id);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(contest.sportEvents.map((sportEvent) => sportEvent.sportEventId)),
  );
  const [year, setYear] = useState(firstEvent.eventYear);
  const contestEventIds = useMemo(
    () => new Set(contest.sportEvents.map((sportEvent) => sportEvent.sportEventId)),
    [contest.sportEvents],
  );
  // Once one of the contest's events has started, its events can be added to but not removed.
  const removalsLocked = contest.sportEvents.some((sportEvent) => hasContestEventStarted(sportEvent));
  const years = useMemo(
    () => [...new Set([firstEvent.eventYear, ...leagueEvents.map((event) => event.eventYear)])].sort((a, b) => a - b),
    [firstEvent.eventYear, leagueEvents],
  );
  const yearEvents = useMemo(
    () => leagueEvents.filter((event) => event.eventYear === year).sort(byStartDate),
    [leagueEvents, year],
  );
  const addable = yearEvents.filter((event) => !selectedIds.has(event.id) && event.contestEligible);

  // The chosen events in the order the contest will play them: by start, as the server keeps them.
  const chosen = useMemo(() => {
    const known = new Map<string, { id: string; name: string; startDate: string }>();
    for (const sportEvent of contest.sportEvents) {
      known.set(sportEvent.sportEventId, { id: sportEvent.sportEventId, name: sportEvent.name, startDate: sportEvent.startDate });
    }
    for (const event of leagueEvents) {
      known.set(event.id, { id: event.id, name: event.name, startDate: event.startDate });
    }
    return [...selectedIds].flatMap((id) => known.get(id) ?? []).sort(byStartDate);
  }, [contest.sportEvents, leagueEvents, selectedIds]);

  function toggle(eventId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  function addAll() {
    setSelectedIds((current) => new Set([...current, ...addable.map((event) => event.id)]));
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
      navigate(contestPath);
    },
    invalidates: [
      QueryKeys.contests.list({ leagueId }),
      QueryKeys.contests.detail(contest.id),
      QueryKeys.managedContests.all,
      QueryKeys.contestEntries.byContest(contest.id),
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

  const removedCount = [...contestEventIds].filter((id) => !selectedIds.has(id)).length;

  return (
    <FormPage
      cancelTo={contestPath}
      description={removalsLocked
        ? 'The contest has started, so you can add events but not remove them. Entries make picks for each event before it starts.'
        : 'Choose the events this contest covers. Entries make picks for each event before it starts, and the contest is final when the last one ends.'}
      errorMessage={saveMutation.isError
        ? extractErrorMessage(saveMutation.error, {
          codeMessages: CONTEST_EVENTS_CODE_MESSAGES,
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
            data-testid="contest-events-year"
            onChange={(event) => setYear(Number(event.target.value))}
            value={String(year)}
          >
            {years.map((option) => (
              <option key={option} value={option}>{option}</option>
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

      <ul className="divide-y divide-border rounded-xl border border-border" data-testid="contest-events-options">
        {yearEvents.length ? yearEvents.map((event) => {
          const isChosen = selectedIds.has(event.id);
          const inContest = contestEventIds.has(event.id);
          const locked = inContest && removalsLocked;
          const reason = inContest ? null : unavailableReason(event);
          return (
            <li key={event.id}>
              <label className="flex items-center gap-3 px-4 py-3 text-sm">
                <Checkbox
                  aria-label={event.name}
                  checked={isChosen}
                  data-testid={`contest-events-option-${event.id}`}
                  disabled={locked || (!isChosen && reason !== null)}
                  onChange={() => toggle(event.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{event.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    <DateDisplay className="text-muted-foreground" value={event.startDate} />
                    {reason ? ` · ${reason}` : ''}
                  </span>
                </span>
                {locked ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock aria-hidden size={13} />
                    In the contest
                  </span>
                ) : null}
              </label>
            </li>
          );
        }) : (
          <li className="px-4 py-3 text-sm text-muted-foreground" data-testid="contest-events-none">
            No events in {year} yet.
          </li>
        )}
      </ul>

      <div className="space-y-2" data-testid="contest-events-chosen">
        <h3 className="text-base font-semibold">
          {chosen.length === 1 ? '1 event, in order' : `${chosen.length} events, in order`}
        </h3>
        {chosen.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {chosen.map((event) => (
              <li key={event.id}>
                {event.name}
                <span className="text-muted-foreground">
                  {' · '}<DateDisplay className="text-muted-foreground" value={event.startDate} />
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Choose at least one event.</p>
        )}
        {removedCount > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="contest-events-removal-note">
            Picks already made for a removed event are deleted.
          </p>
        ) : null}
      </div>
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
  const contestsQuery = useLeagueContestsQuery(league?.id ?? '');
  const contest = contestsQuery.data?.find((candidate) => candidate.id === contestId) ?? null;
  const firstEventQuery = useQuery(sportEventQueryOptions((contest ? firstContestEvent(contest)?.sportEventId : undefined) ?? ''));
  const firstEvent = firstEventQuery.data;
  const sportLeagueId = firstEvent?.sportLeagueId ?? null;
  const leagueEventsQuery = useQuery({
    queryKey: QueryKeys.sportEvents.bySportLeague(sportLeagueId),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sportLeagueId: sportLeagueId ?? undefined } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }
      return response.data.events;
    },
    enabled: sportLeagueId !== null,
    retry: false,
  });
  const contestPath = buildLeagueAdminContestPath(leagueCode, contestId);

  if (!league) {
    return null;
  }
  if (contestsQuery.isLoading || firstEventQuery.isLoading || leagueEventsQuery.isLoading) {
    return <LoadingState body="Loading events..." testId="contest-events-loading" />;
  }
  // A missing contest, a final one, one that covers a single event (a draw, a bracket), or a read that failed goes back to the contest
  // page, which says why.
  if (
    !contest
    || !firstEvent
    || !leagueEventsQuery.data
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
      leagueEvents={leagueEventsQuery.data}
      leagueId={league.id}
    />
  );
}

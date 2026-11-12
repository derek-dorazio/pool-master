import {
  SUPPORTED_SPORTS,
  SelectionType,
  type Sport,
  type SportDefinition,
  countParticipants,
  getSportDefinition,
  pluralize,
} from '@poolmaster/shared/domain';
import { Link } from 'react-router';
import type { SportEventDto } from '@/lib/api';
import { buildLeagueAdminPlanPath } from '@/features/leagues/league-routing';
import {
  Chip,
  ChoiceCard,
  ErrorState,
  FormSection,
  LoadingState,
  Notice,
  SegmentedControl,
  Text,
  formatCount,
  formatDateTimeDisplay,
  formatNumber,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { formatStartsIn } from '../contest-readiness';
import { SquaresGamePicker } from '../squares-game-picker';
import type { useSquaresGameChoices } from '../use-squares-game-choices';

/** How the events on offer are chosen and when entries close, by format: behind the (?). */
function eventSectionHelp(selectionType: SelectionType, sport: SportDefinition) {
  const { event, eventStart } = sport.vocabulary;
  if (selectionType === SelectionType.BRACKET) {
    return `Released events that haven't started, and ${event.many} under way for a second-chance bracket. Entries close at the ${eventStart}, or at a second-chance bracket's first game.`;
  }
  if (selectionType === SelectionType.PICK_EM || selectionType === SelectionType.SURVIVOR) {
    return 'Released weeks that haven\'t started. Choose the first week of the contest; you add the rest of the season from its Events page. Each week closes at its first kickoff.';
  }
  if (selectionType === SelectionType.SQUARES) {
    return `Released ${event.many} with a game still to kick off. Choose the game the grid is played on; boxes close at its kickoff.`;
  }
  return `Released events that haven't started. Entries close at the ${eventStart}.`;
}

/**
 * The sport a contest is for, one choice per supported sport, named by its definition. Only
 * shown when there is more than one to choose from.
 */
function SportPicker({ onChange, value }: { onChange: (sport: Sport) => void; value: Sport }) {
  if (SUPPORTED_SPORTS.length < 2) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="contest-sport">
      <Text variant="meta">Sport</Text>
      <SegmentedControl
        aria-label="Sport"
        onChange={(next) => {
          const sport = SUPPORTED_SPORTS.find((candidate) => candidate === next);
          if (sport) {
            onChange(sport);
          }
        }}
        options={SUPPORTED_SPORTS.map((sport) => ({
          label: getSportDefinition(sport).name,
          testId: `contest-sport-${sport}`,
          value: sport,
        }))}
        value={value}
      />
    </div>
  );
}

/**
 * The events of the chosen sport a contest can be created on, soonest first, one card each. A
 * knockout under way, offered for a second-chance bracket, says so in place of when it starts.
 */
function EventChoices({
  events,
  lockedEventIds,
  onSelect,
  selectedEventId,
  sport,
}: {
  events: readonly SportEventDto[];
  /** Events the league's plan does not let it start a contest on (#947), shown but not chosen. */
  lockedEventIds: readonly string[];
  onSelect: (eventId: string) => void;
  selectedEventId: string;
  sport: SportDefinition;
}) {
  const displayPreferences = useDisplayPreferences();
  return (
    <div aria-label="Event" className="grid gap-2" role="radiogroup">
      {events.map((event) => {
        const isLocked = lockedEventIds.includes(event.id);
        return (
          <ChoiceCard
            isDisabled={isLocked}
            isSelected={event.id === selectedEventId}
            key={event.id}
            onSelect={() => onSelect(event.id)}
            testId={`contest-event-${event.id}`}
          >
            <span className="min-w-0 flex-1">
              <Text size="inherit" tone="inherit" weight="semibold">{event.name}</Text>
              {event.venue ? <Text variant="caption">{` · ${event.venue}`}</Text> : null}
              <Text className="block" variant="caption">
                {event.contestEligible ? 'Starts' : 'Started'} {formatDateTimeDisplay(event.startDate, displayPreferences)}
                {' · '}
                {countParticipants(event.participantCount ?? 0, sport.vocabulary.participant)}
                {' · '}
                {pluralize(event.tierCount, 'tier')}
              </Text>
            </span>
            <Chip>{isLocked ? 'Not in your plan' : event.contestEligible ? formatStartsIn(event.startDate) : 'Under way'}</Chip>
          </ChoiceCard>
        );
      })}
    </div>
  );
}

/**
 * Create contest, step 1: the sport and the event the contest runs on, the plan's sports
 * leagues a year when it caps them, and a squares contest's game.
 */
export function CreateContestEventSection({
  contestEvents,
  eventsQuery,
  leagueCode,
  lockedEventIds,
  onChooseEvent,
  onSelectSport,
  onSquaresGameChange,
  selectedEvent,
  selectionType,
  sport,
  sportDefinition,
  sportEventId,
  sportEventMatchId,
  sportLeagueCap,
  sportLeaguesUsedThisYear,
  squaresGames,
}: {
  contestEvents: readonly SportEventDto[];
  eventsQuery: { isError: boolean; isLoading: boolean; refetch: () => unknown };
  leagueCode: string;
  lockedEventIds: readonly string[];
  onChooseEvent: (eventId: string) => void;
  onSelectSport: (sport: Sport) => void;
  onSquaresGameChange: (sportEventMatchId: string) => void;
  selectedEvent: SportEventDto | null;
  selectionType: SelectionType;
  sport: Sport;
  sportDefinition: SportDefinition;
  sportEventId: string;
  sportEventMatchId: string;
  /** The plan's sports leagues a year (#947), or null when it has no cap. */
  sportLeagueCap: number | null;
  /** How many of them the chosen event's year already uses. */
  sportLeaguesUsedThisYear: number;
  squaresGames: ReturnType<typeof useSquaresGameChoices>;
}) {
  const { locale } = useDisplayPreferences();
  return (
    <FormSection help={eventSectionHelp(selectionType, sportDefinition)} step={1} testId="create-contest-event" title="Event">
      <SportPicker onChange={onSelectSport} value={sport} />
      {eventsQuery.isLoading ? (
        <LoadingState body="Loading events..." rows={3} testId="create-contest-events-loading" />
      ) : eventsQuery.isError ? (
        <ErrorState
          body={`We couldn't load ${sportDefinition.name.toLowerCase()} events.`}
          onRetry={() => void eventsQuery.refetch()}
          testId="create-contest-events-error"
        />
      ) : !contestEvents.length ? (
        // No released, unstarted event with a field: nothing to build a contest on yet (#431).
        <Notice
          data-testid="create-contest-no-events"
          title={`No ${sportDefinition.name.toLowerCase()} events are currently available for contest setup.`}
          tone="warning"
        >
          An event appears here once an admin releases it for contests, until it starts. Check back when
          the next {sportDefinition.vocabulary.event.one} is released.
        </Notice>
      ) : (
        <EventChoices
          events={contestEvents}
          lockedEventIds={lockedEventIds}
          onSelect={onChooseEvent}
          selectedEventId={sportEventId}
          sport={sportDefinition}
        />
      )}
      {sportLeagueCap !== null && selectedEvent ? (
        <Text as="p" data-testid="create-contest-sport-leagues-used" variant="meta">
          {`Sports leagues in ${selectedEvent.eventYear}: ${formatNumber(sportLeaguesUsedThisYear, locale)} of ${formatNumber(sportLeagueCap, locale)}.`}
        </Text>
      ) : null}
      {sportLeagueCap !== null && lockedEventIds.length ? (
        <Notice data-testid="create-contest-sport-leagues-locked">
          Your plan allows {formatCount(sportLeagueCap, 'sports league', locale)} a year, so events in other sports
          leagues are locked for a year whose contests already use {sportLeagueCap === 1 ? 'it' : 'them all'}.
          {' '}
          <Link className="underline" data-testid="create-contest-plan-link" to={buildLeagueAdminPlanPath(leagueCode)}>
            Change plan
          </Link>
        </Notice>
      ) : null}
      {selectionType === SelectionType.SQUARES && selectedEvent ? (
        <SquaresGamePicker
          choices={squaresGames}
          event={selectedEvent}
          onChange={onSquaresGameChange}
          value={sportEventMatchId}
        />
      ) : null}
    </FormSection>
  );
}

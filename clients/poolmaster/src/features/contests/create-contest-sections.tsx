import { SUPPORTED_SPORTS, getSportDefinition, type Sport, type SportDefinition } from '@poolmaster/shared/domain';
import type { ReactNode } from 'react';
import type { SportEventDto } from '@/lib/api';
import { Alert, ChoiceCard, Chip, formatDateTimeDisplay, SegmentedControl } from '@/features/shared/ui';
import { formatStartsIn } from './contest-readiness';
import { countParticipants, pluralize } from './contest-rules';

/** One numbered part of the form: 1 Event, 2 Format, 3 Rules, 4 Name. */
export function SetupSection({
  children,
  lead,
  step,
  testId,
  title,
}: {
  children: ReactNode;
  lead?: string;
  step: number;
  testId: string;
  title: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0"
      data-testid={testId}
    >
      <div>
        <h3 className="flex items-baseline gap-2 text-base font-semibold" id={`${testId}-title`}>
          <span className="font-display text-sm text-muted-foreground">{step}</span>
          {title}
        </h3>
        {lead ? <p className="mt-0.5 text-sm text-muted-foreground">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The sport a contest is for, one choice per supported sport, named by its definition. Only
 * shown when there is more than one to choose from.
 */
export function SportPicker({ onChange, value }: { onChange: (sport: Sport) => void; value: Sport }) {
  if (SUPPORTED_SPORTS.length < 2) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="contest-sport">
      <span className="text-sm text-muted-foreground">Sport</span>
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

/** No released, unstarted event with a field: nothing to build a contest on yet (#431). */
export function NoEligibleEventsAlert({ sport }: { sport: SportDefinition }) {
  const { event } = sport.vocabulary;
  return (
    <Alert
      data-testid="create-contest-no-events"
      title={`No ${sport.name.toLowerCase()} events are currently available for contest setup.`}
      tone="warning"
    >
      <p>
        An event appears here once an admin releases it for contests, until it starts. Check back
        when the next {event.one} is released.
      </p>
    </Alert>
  );
}

/**
 * The events of the chosen sport a contest can be created on, soonest first, one card each. A
 * knockout under way, offered for a second-chance bracket, says so in place of when it starts.
 */
export function EventChoices({
  events,
  onSelect,
  selectedEventId,
  sport,
}: {
  events: readonly SportEventDto[];
  onSelect: (eventId: string) => void;
  selectedEventId: string;
  sport: SportDefinition;
}) {
  return (
    <div aria-label="Event" className="grid gap-2" role="radiogroup">
      {events.map((event) => (
        <ChoiceCard
          isSelected={event.id === selectedEventId}
          key={event.id}
          onSelect={() => onSelect(event.id)}
          testId={`contest-event-${event.id}`}
        >
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{event.name}</span>
            {event.venue ? <span className="text-xs text-muted-foreground"> · {event.venue}</span> : null}
            <span className="block text-xs text-muted-foreground">
              {event.contestEligible ? 'Starts' : 'Started'} {formatDateTimeDisplay(event.startDate)}
              {' · '}
              {countParticipants(event.participantCount ?? 0, sport.vocabulary.participant)}
              {' · '}
              {pluralize(event.tierCount, 'tier')}
            </span>
          </span>
          <Chip>{event.contestEligible ? formatStartsIn(event.startDate) : 'Under way'}</Chip>
        </ChoiceCard>
      ))}
    </div>
  );
}

/**
 * A contest as its emails describe it (#845): its events, its rules in a sentence, its entry
 * limit and when picks close. The rules sentence is the one the web app shows, from
 * `formatContestRules`, so an email never words a contest differently from its page.
 */

import type {
  ContestConfigurationRepository,
  SportEventMatchRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import {
  SelectionType,
  eventRoundLabel,
  formatContestRules,
  formatEntriesPerTeamSentence,
  eventSportDefinition,
  pluralize,
  type Contest,
  type ContestSelectionConfig,
  type RoundName,
  type SportEvent,
  type SportLeague,
} from '@poolmaster/shared/domain';
import { ContestCutoffKind, contestCutoff, cutoffTiming } from '../contests/entry-window';
import { readEventMatchesOnce, readEventsOnce, readOncePerKey } from '../events/event-reads';
import type { SportEventTierService } from '../events/sport-event-tier-service';

export interface ContestSummaryDeps {
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  /** The first event's sport league: its name, and a bracket's round names for a second-chance bracket's starting round. */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent' | 'findBySportEvents'>;
  tiers: Pick<SportEventTierService, 'getEffectiveTiersForSportEvent'>;
}

export interface ContestSummary {
  /** The contest's events, in sequence order. */
  sportEvents: SportEvent[];
  firstEvent: SportEvent;
  /** The first event's sport league's name; '' when it is gone. */
  sportLeagueName: string;
  /** "Pick 1 golfer from each of 6 tiers. The best 4 scores count." */
  rules: string;
  /** "1 entry per member", or "No limit on entries per member". */
  entriesPerMember: string;
  /** When the first event's picks close: its start, a second-chance bracket's round or a squares game's kickoff. */
  closesAt: Date;
}

/**
 * The summary's event reads, each made once however many contests a fan-out summarizes (#1199):
 * the events (`known` ones are not read at all), their matches, sport leagues and tiers. Build it
 * before the fan-out's loop and summarize each contest with it.
 */
export function shareSummaryReads(
  deps: ContestSummaryDeps,
  known: readonly SportEvent[] = [],
): ContestSummaryDeps {
  return {
    configurations: deps.configurations,
    sportEvents: readEventsOnce(deps.sportEvents, known),
    sportLeagues: { findById: readOncePerKey((id) => deps.sportLeagues.findById(id)) },
    matches: readEventMatchesOnce(deps.matches),
    tiers: { getEffectiveTiersForSportEvent: readOncePerKey((id) => deps.tiers.getEffectiveTiersForSportEvent(id)) },
  };
}

/** The contest's summary, or null when its configuration or events are gone. */
export async function summarizeContest(deps: ContestSummaryDeps, contest: Contest): Promise<ContestSummary | null> {
  const [configuration, found] = await Promise.all([
    deps.configurations.findByContest(contest.id),
    deps.sportEvents.findByIds(contest.sportEventIds),
  ]);
  const byId = new Map(found.map((sportEvent) => [sportEvent.id, sportEvent]));
  const sportEvents = contest.sportEventIds
    .map((id) => byId.get(id))
    .filter((sportEvent): sportEvent is SportEvent => sportEvent !== undefined);
  const first = sportEvents.at(0);
  const rules = configuration?.configJson;
  if (!first || !rules) return null;

  const [closesAt, sportLeague] = await Promise.all([
    contestClosesAt(deps, contest, rules, first),
    deps.sportLeagues.findById(first.sportLeagueId),
  ]);
  return {
    sportEvents,
    firstEvent: first,
    sportLeagueName: sportLeague?.name ?? '',
    rules: formatContestRules(
      rules,
      rules.selectionType === SelectionType.TIERED ? (await deps.tiers.getEffectiveTiersForSportEvent(first.id)).length : 0,
      eventSportDefinition(first).vocabulary.participant,
      rules.selectionType === SelectionType.BUDGET_PICK ? rules.salaryCap : null,
      rules.selectionType === SelectionType.BRACKET ? roundNameOf(sportLeague, first) : undefined,
    ),
    entriesPerMember: formatEntriesPerTeamSentence(configuration.maxEntriesPerSquad),
    closesAt,
  };
}

/**
 * When the contest's picks close on its first event: the event's start, a second-chance
 * bracket's starting round or a squares game's kickoff. Never before the event starts.
 */
export async function contestClosesAt(
  deps: { matches: Pick<SportEventMatchRepository, 'findBySportEvent'> },
  contest: Contest,
  rules: ContestSelectionConfig,
  first: SportEvent,
): Promise<Date> {
  const cutoff = contestCutoff(rules, contest.squaresGameMatchId);
  const window = cutoff.kind === ContestCutoffKind.EVENT_START
    ? first
    : cutoffTiming(cutoff, first, await deps.matches.findBySportEvent(first.id));
  return window.startDate;
}

/** A knockout's rounds by name, in its sport league's words where it has them ("Sweet 16"). */
function roundNameOf(sportLeague: SportLeague | null, sportEvent: SportEvent): RoundName {
  const roundNames = sportLeague?.roundNames ?? [];
  const roundCount = sportEvent.rounds ?? eventSportDefinition(sportEvent).defaultRounds;
  return (roundNumber) => eventRoundLabel(sportEvent, roundNames, roundNumber, roundCount);
}

/** How the event plays, as E1 lists it: "16 games" or "4 rounds"; null when neither is known. */
export async function describeEventFormat(
  deps: { matches: Pick<SportEventMatchRepository, 'findBySportEvent'> },
  sportEvent: SportEvent,
): Promise<string | null> {
  const games = await deps.matches.findBySportEvent(sportEvent.id);
  if (games.length > 0) return pluralize(games.length, 'game');
  return sportEvent.rounds === undefined ? null : pluralize(sportEvent.rounds, 'round');
}

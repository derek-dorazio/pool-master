/**
 * A contest as its emails describe it (#845): its events, its rules in a sentence, its entry
 * limit and when picks close. The rules sentence is the one the web app shows, from
 * `formatContestRules`, so an email never words a contest differently from its page.
 */

import type {
  ContestConfigurationRepository,
  SportEventRoundMatchRepository,
  SportEventRepository,
  SportLeagueRepository,
} from '@poolmaster/shared/db';
import {
  type Contest,
  type ContestRules,
  contestRoundCoverage,
  eventSportDefinition,
  formatContestRules,
  formatEntriesPerTeamSentence,
  pluralize,
  SelectionType,
  type SportEvent,
  type SportEventRoundMatch,
  sportVocabulary,
} from '@poolmaster/shared/domain';
import { ContestCutoffKind, contestCutoff, cutoffTiming } from '../contests/entry-window';
import { readEventMatchesOnce, readEventsOnce, readOncePerKey, readTiersOnce } from '../events/event-reads';
import type { SportEventTierService } from '../events/sport-event-tier-service';

export interface ContestSummaryDeps {
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  /** The first event's sport league, for its name. */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent' | 'findBySportEvents'>;
  tiers: Pick<SportEventTierService, 'getEffectiveTiersForSportEvent' | 'salaryCaps'>;
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
  /** When the first event's picks close: its start or a squares game's kickoff. */
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
    tiers: readTiersOnce(deps.tiers),
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
      rules.selectionType === SelectionType.TIERED
        // The set the contest picks from: the first slot it covers holding one (#2044).
        ? (await deps.tiers.getEffectiveTiersForSportEvent(first.id, { coveredSlotDefinitionIds: contestRoundCoverage(contest).slotDefinitionIds })).length
        : 0,
      sportVocabulary(eventSportDefinition(first)).participant,
      // A budget contest's cap is its first covered slot's pricing (#2050), never its rules'.
      rules.selectionType === SelectionType.BUDGET_PICK
        ? (await deps.tiers.salaryCaps([first.id], { coveredSlotDefinitionIds: contestRoundCoverage(contest).slotDefinitionIds })).get(first.id) ?? null
        : null,
    ),
    entriesPerMember: formatEntriesPerTeamSentence(configuration.maxEntriesPerSquad),
    closesAt,
  };
}

/**
 * When the contest's picks close on its first event: the event's start or a squares game's
 * kickoff. Never before the event starts.
 */
export async function contestClosesAt(
  deps: { matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent'> },
  contest: Contest,
  rules: ContestRules,
  first: SportEvent,
): Promise<Date> {
  return contestClosesAtGiven(contest, rules, first, closesOnAGame(contest, rules) ? await deps.matches.findBySportEvent(first.id) : []);
}

/** Whether the contest's picks close at one of its first event's games, so its close needs the event's games. */
export function closesOnAGame(contest: Contest, rules: ContestRules): boolean {
  return contestCutoff(rules, contest.squaresGame).kind !== ContestCutoffKind.EVENT_START;
}

/** `contestClosesAt` with the first event's games already read, for a sweep that reads every contest's at once. */
export function contestClosesAtGiven(
  contest: Contest,
  rules: ContestRules,
  first: SportEvent,
  games: readonly SportEventRoundMatch[],
): Date {
  const cutoff = contestCutoff(rules, contest.squaresGame);
  return (cutoff.kind === ContestCutoffKind.EVENT_START ? first : cutoffTiming(cutoff, first, games)).startDate;
}

/** How the event plays, as E1 lists it: "16 games" or "4 rounds"; null when neither is known. */
export async function describeEventFormat(
  deps: { matches: Pick<SportEventRoundMatchRepository, 'findBySportEvent'> },
  sportEvent: SportEvent,
): Promise<string | null> {
  const games = await deps.matches.findBySportEvent(sportEvent.id);
  if (games.length > 0) return pluralize(games.length, 'game');
  return sportEvent.roundCount === 0 ? null : pluralize(sportEvent.roundCount, 'round');
}

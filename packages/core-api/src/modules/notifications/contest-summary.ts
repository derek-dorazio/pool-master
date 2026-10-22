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
  getSportDefinition,
  pluralize,
  type Contest,
  type RoundName,
  type SportEvent,
} from '@poolmaster/shared/domain';
import { ContestCutoffKind, contestCutoff, cutoffTiming } from '../contests/entry-window';
import type { SportEventTierService } from '../events/sport-event-tier-service';

export interface ContestSummaryDeps {
  configurations: Pick<ContestConfigurationRepository, 'findByContest'>;
  sportEvents: Pick<SportEventRepository, 'findByIds'>;
  /** A bracket's round names, for a second-chance bracket's starting round. */
  sportLeagues: Pick<SportLeagueRepository, 'findById'>;
  matches: Pick<SportEventMatchRepository, 'findBySportEvent'>;
  tiers: Pick<SportEventTierService, 'getEffectiveTiersForSportEvent'>;
}

export interface ContestSummary {
  /** The contest's events, in sequence order. */
  sportEvents: SportEvent[];
  /** "Pick 1 golfer from each of 6 tiers. The best 4 scores count." */
  rules: string;
  /** "1 entry per member", or "No limit on entries per member". */
  entriesPerMember: string;
  /** When the first event's picks close: its start, a second-chance bracket's round or a squares game's kickoff. */
  closesAt: Date;
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

  const cutoff = contestCutoff(rules, contest.squaresGameMatchId);
  const window = cutoff.kind === ContestCutoffKind.EVENT_START
    ? first
    : cutoffTiming(cutoff, first, await deps.matches.findBySportEvent(first.id));
  return {
    sportEvents,
    rules: formatContestRules(
      rules,
      rules.selectionType === SelectionType.TIERED ? (await deps.tiers.getEffectiveTiersForSportEvent(first.id)).length : 0,
      getSportDefinition(first.sport).vocabulary.participant,
      rules.selectionType === SelectionType.BUDGET_PICK ? rules.salaryCap : null,
      rules.selectionType === SelectionType.BRACKET ? await roundNameOf(deps, first) : undefined,
    ),
    entriesPerMember: formatEntriesPerTeamSentence(configuration.maxEntriesPerSquad),
    closesAt: window.startDate,
  };
}

/** A knockout's rounds by name, in its sport league's words where it has them ("Sweet 16"). */
async function roundNameOf(deps: Pick<ContestSummaryDeps, 'sportLeagues'>, sportEvent: SportEvent): Promise<RoundName> {
  const roundNames = (await deps.sportLeagues.findById(sportEvent.sportLeagueId))?.roundNames ?? [];
  const roundCount = sportEvent.rounds ?? getSportDefinition(sportEvent.sport).defaultRounds;
  return (roundNumber) => eventRoundLabel(sportEvent.sport, roundNames, roundNumber, roundCount);
}

/** How the event plays, as E1 lists it: "16 games" or "4 rounds"; null when neither is known. */
export async function describeEventFormat(
  deps: Pick<ContestSummaryDeps, 'matches'>,
  sportEvent: SportEvent,
): Promise<string | null> {
  const games = await deps.matches.findBySportEvent(sportEvent.id);
  if (games.length > 0) return pluralize(games.length, 'game');
  return sportEvent.rounds === undefined ? null : pluralize(sportEvent.rounds, 'round');
}

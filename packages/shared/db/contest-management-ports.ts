import type {
  ContestConfigTemplate,
  ContestConfiguration,
  ContestEntryPick,
  ContestTemplateEventType,
  ParticipantContestScoringRule,
  ParticipantContestScoringRuleCreate,
  ParticipantInactiveReason,
} from '../domain';

export interface ContestConfigurationRepository {
  findByContest(contestId: string): Promise<ContestConfiguration | null>;
  /** Several contests' configurations in one read; a contest with none is left out. */
  findByContests(contestIds: readonly string[]): Promise<ContestConfiguration[]>;
  create(
    configuration: Omit<ContestConfiguration, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestConfiguration>;
  update(
    id: string,
    updates: Partial<ContestConfiguration>,
  ): Promise<ContestConfiguration>;
}

export interface ContestConfigTemplateRepository {
  findById(id: string): Promise<ContestConfigTemplate | null>;
  /**
   * Ordered by sport, format, sort order, name. `eventType` narrows to that type's templates
   * plus the ones for any event type; `sportLeagueId` narrows to that league's templates plus the
   * sport-wide ones (never another league's); every filter is optional.
   */
  list(input?: {
    sport?: ContestConfigTemplate['sport'];
    sportLeagueId?: string;
    eventType?: ContestTemplateEventType | null;
    active?: boolean;
  }): Promise<ContestConfigTemplate[]>;
  update(
    id: string,
    updates: Partial<ContestConfigTemplate>,
  ): Promise<ContestConfigTemplate>;
}

export interface ParticipantContestScoringRuleRepository {
  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ParticipantContestScoringRule[]>;
  create(
    rule: ParticipantContestScoringRuleCreate,
  ): Promise<ParticipantContestScoringRule>;
  /** Removes every rule of one configuration in one statement, before its scoring is replaced. */
  deleteByContestConfiguration(contestConfigurationId: string): Promise<void>;
}

/** The participant a pick points at, as a contest entry shows it. */
export interface ContestEntryPickParticipant {
  participantId: string;
  participantName: string;
  isActive: boolean;
  inactiveReason: ParticipantInactiveReason | null;
  role: string | null;
  teamAffiliation: string | null;
}

/** A pick with the event its field row belongs to (#1162). */
export interface ContestEntryEventPick extends ContestEntryPick {
  sportEventId: string;
}

export interface ContestEntryPickWithParticipant extends ContestEntryPick {
  /** The event the picked field row belongs to: which of the contest's events the pick is in (#713). */
  sportEventId: string;
  participant: ContestEntryPickParticipant;
}

/**
 * Reads of `ContestEntryPick`. **Read-only by design (#247).** A pick has one insert path,
 * `ContestEntryPickService.createPick`: it reads the parent contest's `contestFormat` inside
 * the insert's transaction and writes it onto the pick, which the per-format partial unique
 * indexes depend on (plans/117 §7.1, "no insert path bypasses this"). A `create` here would be
 * a second way in that every adapter and fake would have to implement; leaving it off the port
 * means none can. Every order is pick time, then id.
 */
export interface ContestEntryPickRepository {
  /**
   * The entries' picks in the events asked for alone (#1162), each with its event: a leaderboard
   * reads only the events it scores, not every pick the entries made across the contest.
   */
  findByEntriesAndEvents(entryIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestEntryEventPick[]>;
  /**
   * The entries' picks with their field rows. With a `sportEventId`, only the picks in that one
   * event, filtered in the query (#1196): a lineup is one event's picks (#713), and a season
   * contest holds every week's.
   */
  findByEntriesWithParticipant(
    entryIds: readonly string[],
    options?: { sportEventId?: string },
  ): Promise<ContestEntryPickWithParticipant[]>;
  /** Picks per entry; an entry with none is absent from the map. */
  countByEntries(entryIds: readonly string[]): Promise<Map<string, number>>;
  /** How many picks the whole contest holds — the source of a pick's contest-wide pick number. */
  countByContest(contestId: string): Promise<number>;
}

/** A settled entry standing, with the total its position was ranked from. */
export interface ContestEntryStandingResult {
  id: string;
  contestId: string;
  contestEntryId: string;
  position: number | null;
  displayPosition: string | null;
  countingPickLimit: number;
  scoredPickCount: number;
  asOf: Date | null;
  settledAt: Date;
  /** The entry's settled total in the contest's scoring-definition unit (golf's to-par, a race's points); null while unscored. */
  totalScore: number | null;
}

export type ContestEntryStandingWrite = Omit<ContestEntryStandingResult, 'id'>;

/** The frozen contest-entry standing (#246): written by settlement, read by a settled contest. */
export interface ContestEntryStandingRepository {
  findByContest(contestId: string): Promise<ContestEntryStandingResult[]>;
  /** One per entry: creates or overwrites the entry's standing. */
  upsert(write: ContestEntryStandingWrite): Promise<void>;
}

/** An entry's settled result in one event of its contest (#713): the contest standing, narrowed to the event. */
export interface ContestEntryEventStandingResult extends ContestEntryStandingResult {
  sportEventId: string;
}

export type ContestEntryEventStandingWrite = Omit<ContestEntryEventStandingResult, 'id'>;

/** The frozen per-event entry standing (#713): written by settlement when the event completes. */
export interface ContestEntryEventStandingRepository {
  /** Every event's standings of the contest, best first within each event. */
  findByContest(contestId: string): Promise<ContestEntryEventStandingResult[]>;
  /** One per entry and event: creates or overwrites it. */
  upsert(write: ContestEntryEventStandingWrite): Promise<void>;
}

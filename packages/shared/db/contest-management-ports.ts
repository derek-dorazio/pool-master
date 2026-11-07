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
  /** Every rule of each configuration, in one read (#1315), in sort order within each. */
  findByContestConfigurations(
    contestConfigurationIds: readonly string[],
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
 * `ContestEntryPickService` (`changeEntryPick`, or `recordDraw` for a draw): it reads the parent contest's `contestFormat` inside
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

/** An entry that finished first in its contest, named as the contest's standings name it. */
export interface ContestWinner {
  contestId: string;
  entryName: string;
}

/** The frozen contest-entry standing (#246): written by settlement, read by a settled contest. */
export interface ContestEntryStandingRepository {
  findByContest(contestId: string): Promise<ContestEntryStandingResult[]>;
  /**
   * The entries in first place in each of several contests, in one read (#1336): by contest, in
   * the order the contest's final standings list them, entry number then name.
   */
  findWinnersByContests(contestIds: readonly string[]): Promise<ContestWinner[]>;
  /**
   * The contest's standings, one per entry, written all or none (#1172): an entry's standing is
   * created, or updated in place when it differs from the stored one, and an unchanged one is
   * not written. Every write is of `contestId`.
   */
  upsertMany(contestId: string, writes: readonly ContestEntryStandingWrite[]): Promise<void>;
}

/**
 * A contest's leaderboard as last computed (#1435): one per contest and shown event, overwritten
 * in place. `Board` is the board as the API answers it.
 */
export interface ContestLeaderboardSnapshot<Board> {
  contestId: string;
  /** The shown event's id, or '' for the board of a read naming none (the latest event whose picks are revealed). */
  shownEvent: string;
  /** Up by one on every write. */
  version: number;
  /** When the rebuild that wrote it began reading. */
  computedFrom: Date;
  /** The contest's `updatedAt` it was computed under. */
  contestUpdatedAt: Date;
  /** When an event not yet revealed in it starts; null when every event is revealed. */
  validUntil: Date | null;
  board: Board;
}

export type ContestLeaderboardSnapshotWrite<Board> = Omit<ContestLeaderboardSnapshot<Board>, 'version'>;

export interface ContestLeaderboardSnapshotKey {
  contestId: string;
  shownEvent: string;
}

export interface ContestLeaderboardSnapshotRepository<Board> {
  /** The snapshot of this contest and shown event, by its primary key; null when none is stored. */
  find(contestId: string, shownEvent: string): Promise<ContestLeaderboardSnapshot<Board> | null>;
  /** Several contests' snapshots of one shown event in one read (#1315), in no set order. */
  findByContests(contestIds: readonly string[], shownEvent: string): Promise<ContestLeaderboardSnapshot<Board>[]>;
  /**
   * Which snapshots are stored, without their boards, of these contests and of every contest on
   * these events: one read, so a write whose contests no one has viewed costs nothing more.
   */
  findKeysByContestsOrEvents(contestIds: readonly string[], sportEventIds: readonly string[]): Promise<ContestLeaderboardSnapshotKey[]>;
  /**
   * Stores the snapshot unless the one stored began computing at the same moment or later, so an
   * older rebuild never overwrites a newer board. Answers the snapshot as stored, or null when the
   * one stored was kept; each store moves `version` up by one.
   */
  save(write: ContestLeaderboardSnapshotWrite<Board>): Promise<ContestLeaderboardSnapshot<Board> | null>;
  /** Drops the snapshot, so the next read computes the board again. */
  delete(key: ContestLeaderboardSnapshotKey): Promise<void>;
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
  /** `findByContest` for several contests in one read (#1315): by contest, then in its order. */
  findByContests(contestIds: readonly string[]): Promise<ContestEntryEventStandingResult[]>;
  /** Which of the contests already hold standings for the event, in one read (#1172): their event settled. */
  findContestsSettledFor(sportEventId: string, contestIds: readonly string[]): Promise<Set<string>>;
  /**
   * The contest's event standings, one per entry and event, written all or none (#1172), as
   * `ContestEntryStandingRepository.upsertMany` writes.
   */
  upsertMany(contestId: string, writes: readonly ContestEntryEventStandingWrite[]): Promise<void>;
}

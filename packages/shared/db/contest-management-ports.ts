import type {
  ContestConfigTemplate,
  ContestConfiguration,
  ContestEntryPick,
  ContestPrizeDefinition,
  ParticipantContestScoringRule,
  ParticipantInactiveReason,
} from '../domain';

export interface ContestConfigurationRepository {
  findById(id: string): Promise<ContestConfiguration | null>;
  findByContest(contestId: string): Promise<ContestConfiguration | null>;
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
   * plus the ones for any event type; every filter is optional.
   */
  list(input?: {
    sport?: ContestConfigTemplate['sport'];
    contestFormat?: ContestConfigTemplate['contestFormat'];
    eventType?: string | null;
    active?: boolean;
  }): Promise<ContestConfigTemplate[]>;
  update(
    id: string,
    updates: Partial<ContestConfigTemplate>,
  ): Promise<ContestConfigTemplate>;
}

export interface ParticipantContestScoringRuleRepository {
  findById(id: string): Promise<ParticipantContestScoringRule | null>;
  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ParticipantContestScoringRule[]>;
  create(
    rule: Omit<ParticipantContestScoringRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ParticipantContestScoringRule>;
  update(
    id: string,
    updates: Partial<ParticipantContestScoringRule>,
  ): Promise<ParticipantContestScoringRule>;
  delete(id: string): Promise<void>;
}

export interface ContestPrizeDefinitionRepository {
  findById(id: string): Promise<ContestPrizeDefinition | null>;
  findByContestConfiguration(
    contestConfigurationId: string,
  ): Promise<ContestPrizeDefinition[]>;
  create(
    definition: Omit<ContestPrizeDefinition, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ContestPrizeDefinition>;
  update(
    id: string,
    updates: Partial<ContestPrizeDefinition>,
  ): Promise<ContestPrizeDefinition>;
  delete(id: string): Promise<void>;
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

export interface ContestEntryPickWithParticipant extends ContestEntryPick {
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
  findByEntries(entryIds: readonly string[]): Promise<ContestEntryPick[]>;
  findByEntriesWithParticipant(entryIds: readonly string[]): Promise<ContestEntryPickWithParticipant[]>;
  /** Picks per entry; an entry with none is absent from the map. */
  countByEntries(entryIds: readonly string[]): Promise<Map<string, number>>;
}

/** A settled entry standing: the core row and its golf extension, when it has one. */
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
  golf: { totalScoreToPar: number | null } | null;
}

export type ContestEntryStandingWrite = Omit<ContestEntryStandingResult, 'id'>;

/** The frozen contest-entry standing (#246): written by settlement, read by a settled contest. */
export interface ContestEntryStandingRepository {
  findByContest(contestId: string): Promise<ContestEntryStandingResult[]>;
  /** One per entry: creates or overwrites the entry's standing, core and golf extension together. */
  upsert(write: ContestEntryStandingWrite): Promise<void>;
}

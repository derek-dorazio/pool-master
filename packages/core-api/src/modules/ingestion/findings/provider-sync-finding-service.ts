/**
 * Sync findings (#1999, league model 2): the one list of problems the sync found. The sync raises
 * them here; the root admin's Findings list reads them and resolves, waives, reopens or fixes
 * each. A finding that opens as an ERROR is logged with `ingestion.syncFinding.errorOpened`, which
 * a CloudWatch metric filter counts and alarms on (`infrastructure/terraform/monitoring.tf`).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { ProviderSyncFindingRepository, SlotNamePatternChoice, SlotNamePatternChoices, SlotNamePatternRepository } from '@poolmaster/shared/db';
import {
  PROVIDER_SYNC_FINDING_STATUS_ACTIONS,
  ProviderSyncFindingAction,
  ProviderSyncFindingKind,
  ProviderSyncFindingSeverity,
  ProviderSyncFindingStatus,
  ProviderSyncRunStatus,
  providerCodeOfSourceId,
  providerSyncFindingActions,
  type ProviderSettings,
  type ProviderSyncFinding,
  type ProviderSyncFindingRaise,
  type ProviderSyncFindingStatusAction,
  type ProviderSyncRun,
  type SportLeague,
} from '@poolmaster/shared/domain';
import type { ApiErrorCode } from '@poolmaster/shared/dto';
import type { ParticipantService } from '../../participants/service';
import { providerByCode } from '../provider-settings-store';
import type { ResolveMappedParticipantFindingsJobPayload } from './mapped-participant-findings-job';

export class ProviderSyncFindingError extends Error {
  constructor(message: string, readonly code: ApiErrorCode, readonly statusCode: number) {
    super(message);
    this.name = 'ProviderSyncFindingError';
  }
}

/** The outcomes a sync run ends in: the ones `checkRunOutcome` reads. */
export type SyncRunOutcome = typeof ProviderSyncRunStatus.FAILED | typeof ProviderSyncRunStatus.COMPLETED;

/** A participant id the feed sent that no participant of the league is mapped to. */
export interface UnmappedFeedParticipant {
  externalId: string;
  /** The feed's name for them, when it sent one. */
  name: string | null;
}

export interface ProviderSyncFindingServiceDeps {
  repository: ProviderSyncFindingRepository;
  /** The Provider rows, in memory (ProviderSettingsStore). */
  providers: { all(): readonly ProviderSettings[] };
  /** Mapping a participant from a finding goes through the participants' own bind. */
  participants: Pick<ParticipantService, 'findById' | 'bindProviderMapping'>;
  /** "Link to existing" reads and adds a league's NAME_PATTERN mappings (#2011). */
  slotNamePatterns: SlotNamePatternRepository;
  now?: () => Date;
  logger?: FastifyBaseLogger;
}

export class ProviderSyncFindingService {
  constructor(private readonly deps: ProviderSyncFindingServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Raises the sync's findings, deduplicated per kind and subject; an ERROR that opens is logged for the alarm. */
  async raise(raises: readonly ProviderSyncFindingRaise[]): Promise<void> {
    if (raises.length === 0) return;
    const opened = await this.deps.repository.raise(raises, this.now());
    for (const finding of opened) {
      if (finding.severity === ProviderSyncFindingSeverity.ERROR) {
        this.deps.logger?.error(
          { action: 'ingestion.syncFinding.errorOpened', findingId: finding.id, kind: finding.kind, sportLeagueId: finding.sportLeagueId },
          'A sync finding opened as an error',
        );
      }
    }
    this.deps.logger?.info(
      { action: 'ingestion.syncFinding.raised', raised: raises.length, opened: opened.length },
      'Raised sync findings',
    );
  }

  /**
   * Findings a sync raises knowing its provider by its source id (the feed's `providerId`, as a
   * league's selected provider mapping carries it): each is raised against that Provider's row. A
   * feed with no Provider row (the QA mock feed, until #2039) raises none, and says so.
   */
  async raiseOfSource(providerSourceId: string, raises: ReadonlyArray<Omit<ProviderSyncFindingRaise, 'providerId'>>): Promise<void> {
    if (raises.length === 0) return;
    const provider = this.providerOfSourceId(providerSourceId);
    if (provider === undefined) {
      this.deps.logger?.warn(
        { action: 'ingestion.syncFinding.withoutProvider', providerId: providerSourceId, kinds: [...new Set(raises.map((raise) => raise.kind))], count: raises.length },
        'A sync found something to raise, but its feed has no Provider row to raise it for',
      );
      return;
    }
    await this.raise(raises.map((raise) => ({ ...raise, providerId: provider.id })));
  }

  /**
   * The feed's participant ids that no participant of the league is mapped to: one WARNING per
   * league, Provider and id, whatever event it came up in. A feed with no Provider row (the QA
   * mock feed, until #2039) raises none, since there is nothing to map it from.
   */
  async raiseUnmappedParticipants(input: {
    sportLeagueId: string;
    providerSourceId: string;
    participants: readonly UnmappedFeedParticipant[];
  }): Promise<void> {
    if (input.participants.length === 0) return;
    const provider = this.providerOfSourceId(input.providerSourceId);
    if (provider === undefined) {
      this.deps.logger?.warn(
        { action: 'ingestion.syncFinding.unmappedWithoutProvider', providerId: input.providerSourceId, sportLeagueId: input.sportLeagueId, count: input.participants.length },
        'Feed participants are unmapped, but their feed has no Provider row to raise a finding for',
      );
      return;
    }
    await this.raise(input.participants.map((participant) => ({
      kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT,
      severity: ProviderSyncFindingSeverity.WARNING,
      sportLeagueId: input.sportLeagueId,
      sportEventId: null,
      providerId: provider.id,
      providerValue: participant.externalId,
      providerValueName: participant.name,
    })));
  }

  /**
   * One event's check from a sync (#1999): a WARNING on the event when `found`, else its open
   * finding of the kind resolves, since the sync that would raise it no longer does.
   */
  async checkEvent(input: {
    kind: ProviderSyncFindingKind;
    sportLeagueId: string;
    sportEventId: string;
    /** The Provider row (`providers.id`). */
    providerId: string;
    found: boolean;
  }): Promise<void> {
    if (input.found) {
      await this.raise([{
        kind: input.kind,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId: input.sportLeagueId,
        sportEventId: input.sportEventId,
        providerId: input.providerId,
        providerValue: null,
        providerValueName: null,
      }]);
      return;
    }
    await this.deps.repository.resolveOpen({
      kind: input.kind,
      sportLeagueId: input.sportLeagueId,
      sportEventId: input.sportEventId,
      providerId: input.providerId,
    }, this.now());
  }

  /**
   * A sync run's outcome, once recorded (#2092): a FAILED run raises SYNC_FAILED, an ERROR on its
   * league, event (none for a league's events sync), Provider and sync kind, naming the run; a
   * COMPLETED run resolves that finding. A run with no league of ours checks nothing. The run's
   * outcome is already written, so a findings write that fails is logged, never thrown: it cannot
   * fail a run that succeeded, nor hide why one failed.
   */
  async checkRunOutcome(
    run: Pick<ProviderSyncRun, 'id' | 'kind' | 'providerId' | 'sportLeagueId' | 'sportEventId'>,
    outcome: SyncRunOutcome,
  ): Promise<void> {
    if (run.sportLeagueId === null) return;
    const subject = {
      kind: ProviderSyncFindingKind.SYNC_FAILED,
      sportLeagueId: run.sportLeagueId,
      sportEventId: run.sportEventId,
      providerId: run.providerId,
      syncKind: run.kind,
    };
    try {
      if (outcome === ProviderSyncRunStatus.FAILED) {
        await this.raise([{ ...subject, severity: ProviderSyncFindingSeverity.ERROR, providerValue: null, providerValueName: null, syncRunId: run.id }]);
        return;
      }
      await this.deps.repository.resolveOpen(subject, this.now());
    } catch (error) {
      this.deps.logger?.error(
        { action: 'ingestion.syncFinding.checkFailed', data: { syncRunId: run.id, kind: ProviderSyncFindingKind.SYNC_FAILED, outcome }, err: error },
        'Could not check the sync run\'s outcome for findings',
      );
    }
  }

  /**
   * `checkEvent` for a check that knows its provider by its source id (the feed's `providerId`).
   * A feed with no Provider row (the QA mock feed, until #2039) checks nothing.
   */
  async checkEventOfSource(input: Omit<Parameters<ProviderSyncFindingService['checkEvent']>[0], 'providerId'> & { providerSourceId: string }): Promise<void> {
    const { providerSourceId, ...check } = input;
    const provider = this.providerOfSourceId(providerSourceId);
    if (provider === undefined) return;
    await this.checkEvent({ ...check, providerId: provider.id });
  }

  /**
   * One event's check, from a sync, of the feed's participants it finds something of (#2223): a
   * WARNING per participant found, named by its feed id and name, and every other open finding of
   * the kind on the event resolves, since the sync no longer finds it. A feed with no Provider row
   * (the QA mock feed, until #2039) checks nothing.
   */
  async checkEventParticipantsOfSource(input: {
    kind: ProviderSyncFindingKind;
    sportLeagueId: string;
    sportEventId: string;
    providerSourceId: string;
    found: ReadonlyArray<{ externalId: string; name: string | null }>;
  }): Promise<void> {
    const provider = this.providerOfSourceId(input.providerSourceId);
    if (provider === undefined) return;
    const subject = { kind: input.kind, sportLeagueId: input.sportLeagueId, sportEventId: input.sportEventId, providerId: provider.id };
    await this.deps.repository.resolveOpen({ ...subject, exceptProviderValues: input.found.map((participant) => participant.externalId) }, this.now());
    await this.raise(input.found.map((participant) => ({
      ...subject,
      severity: ProviderSyncFindingSeverity.WARNING,
      providerValue: participant.externalId,
      providerValueName: participant.name,
    })));
  }

  /**
   * A Provider whose webhooks are switched on while its signing secret is not set: an ERROR on
   * each league it syncs. Once its secret is set, or its webhooks are off, its findings resolve;
   * while it is still missing, a league the Provider no longer syncs has its finding resolved
   * (#2070). Checked when a worker task starts, since the secret is read from its environment.
   * One statement per Provider, whatever the number of leagues.
   */
  async checkWebhookSecrets(input: {
    syncedLeagues: readonly Pick<SportLeague, 'id' | 'selectedProviderMapping'>[];
    isMissingSecret: (provider: ProviderSettings) => boolean;
  }): Promise<void> {
    const now = this.now();
    const raises: ProviderSyncFindingRaise[] = [];
    for (const provider of this.deps.providers.all()) {
      if (!input.isMissingSecret(provider)) {
        // poolmaster-allow-query-in-loop: once per Provider row, a handful
        await this.deps.repository.resolveOpen({ kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, providerId: provider.id }, now);
        continue;
      }
      const syncedIds = input.syncedLeagues.filter((league) => league.selectedProviderMapping?.providerCode === provider.code).map((league) => league.id);
      // poolmaster-allow-query-in-loop: once per Provider row, a handful
      await this.deps.repository.resolveOpen({ kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING, providerId: provider.id, exceptSportLeagueIds: syncedIds }, now);
      for (const league of input.syncedLeagues) {
        if (league.selectedProviderMapping?.providerCode !== provider.code) continue;
        raises.push({
          kind: ProviderSyncFindingKind.WEBHOOK_SECRET_MISSING,
          severity: ProviderSyncFindingSeverity.ERROR,
          sportLeagueId: league.id,
          sportEventId: null,
          providerId: provider.id,
          providerValue: null,
          providerValueName: null,
        });
      }
    }
    await this.raise(raises);
  }

  /**
   * A Provider that keeps rate limiting (league model 1c): one finding per league it syncs, at the
   * severity the streak has reached there. The rate-limit watch raises only on a change, so each
   * ERROR here, newly open or escalated from a WARNING, is logged once for the alarm.
   */
  async raiseProviderRateLimited(input: {
    providerId: string;
    leagues: readonly { sportLeagueId: string; severity: ProviderSyncFindingSeverity }[];
  }): Promise<void> {
    if (input.leagues.length === 0) return;
    const opened = await this.deps.repository.raise(input.leagues.map((league) => ({
      kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED,
      severity: league.severity,
      sportLeagueId: league.sportLeagueId,
      sportEventId: null,
      providerId: input.providerId,
      providerValue: null,
      providerValueName: null,
    })), this.now());
    const openedLeagues = new Set(opened.map((finding) => finding.sportLeagueId));
    for (const league of input.leagues) {
      if (league.severity !== ProviderSyncFindingSeverity.ERROR) continue;
      this.deps.logger?.error(
        {
          action: 'ingestion.syncFinding.errorOpened',
          kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED,
          sportLeagueId: league.sportLeagueId,
          providerId: input.providerId,
          escalated: !openedLeagues.has(league.sportLeagueId),
        },
        'A sync finding opened as an error',
      );
    }
    this.deps.logger?.warn(
      { action: 'ingestion.syncFinding.providerRateLimited', providerId: input.providerId, leagues: input.leagues },
      'A provider has rate limited every call for a while',
    );
  }

  /**
   * A league's sync against a Provider (named by its source id) succeeded: that league's OPEN
   * findings of the kind resolve, only those with one of `providerValues` when given, in one
   * statement. Returns how many did.
   */
  async resolveOfSource(providerSourceId: string, input: { kind: ProviderSyncFindingKind; sportLeagueId: string; providerValues?: readonly string[] }): Promise<number> {
    const provider = this.providerOfSourceId(providerSourceId);
    if (provider === undefined) return 0;
    return this.deps.repository.resolveOpen({
      kind: input.kind,
      sportLeagueId: input.sportLeagueId,
      providerId: provider.id,
      ...(input.providerValues !== undefined && { providerValues: input.providerValues }),
    }, this.now());
  }

  /** The Provider answered again: its rate-limit findings resolve. Returns how many did. */
  async resolveProviderRateLimited(providerId: string): Promise<number> {
    return this.deps.repository.resolveOpen({ kind: ProviderSyncFindingKind.PROVIDER_RATE_LIMITED, providerId }, this.now());
  }

  /**
   * Feed ids were mapped to participants (#2069), by any path: their OPEN unmapped participant
   * findings in the league resolve, in one statement. Returns how many did.
   */
  async resolveMappedParticipants(payload: ResolveMappedParticipantFindingsJobPayload): Promise<number> {
    const resolved = await this.deps.repository.resolveOpen({
      kind: ProviderSyncFindingKind.UNMAPPED_PARTICIPANT,
      sportLeagueId: payload.sportLeagueId,
      providerId: payload.providerId,
      providerValues: payload.externalIds,
    }, this.now());
    this.deps.logger?.info(
      { action: 'ingestion.syncFinding.mappedParticipantsResolved', sportLeagueId: payload.sportLeagueId, providerId: payload.providerId, mapped: payload.externalIds.length, resolved },
      'Resolved the unmapped participant findings of newly mapped feed ids',
    );
    return resolved;
  }

  /** Every finding kept, most recently seen first. Nothing pages it: resolved ones are cleared after 90 days. */
  async list(): Promise<ProviderSyncFinding[]> {
    return this.deps.repository.findAll();
  }

  async get(findingId: string): Promise<ProviderSyncFinding> {
    const finding = await this.deps.repository.findById(findingId);
    if (finding === null) throw notFound(findingId);
    return finding;
  }

  /**
   * A root admin resolving, waiving or reopening a finding. 404 SYNC_FINDING_NOT_FOUND; 409
   * SYNC_FINDING_ACTION_NOT_OFFERED when the finding does not offer the action now; 422
   * SYNC_FINDING_WAIVE_NOTE_REQUIRED for a waive with no note.
   */
  async changeStatus(findingId: string, input: { action: ProviderSyncFindingStatusAction; waiveNote: string | null; userId: string }): Promise<ProviderSyncFinding> {
    const finding = await this.get(findingId);
    this.assertOffered(finding, input.action);
    const status = PROVIDER_SYNC_FINDING_STATUS_ACTIONS[input.action];
    const waiveNote = input.waiveNote?.trim() ?? '';
    if (status === ProviderSyncFindingStatus.WAIVED && waiveNote === '') {
      throw new ProviderSyncFindingError('Say why the finding is waived.', 'SYNC_FINDING_WAIVE_NOTE_REQUIRED', 422);
    }
    const saved = await this.deps.repository.setStatus(findingId, {
      status,
      waiveNote: status === ProviderSyncFindingStatus.WAIVED ? waiveNote : null,
      changedByUserId: input.userId,
      changedAt: this.now(),
    });
    if (saved === null) throw notFound(findingId);
    this.deps.logger?.info(
      { action: 'ingestion.syncFinding.statusChanged', findingId, kind: saved.kind, status, userId: input.userId },
      'A root admin changed a sync finding\'s status',
    );
    return saved;
  }

  /**
   * An unmapped participant's fix: maps the feed's id to a participant of the finding's league,
   * through the participants' own bind, and resolves the finding. 404 SYNC_FINDING_NOT_FOUND or
   * PARTICIPANT_NOT_FOUND; 409 SYNC_FINDING_ACTION_NOT_OFFERED; 422
   * SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE for a participant of another league.
   */
  async mapParticipant(findingId: string, input: { participantId: string; userId: string }): Promise<ProviderSyncFinding> {
    const finding = await this.get(findingId);
    this.assertOffered(finding, ProviderSyncFindingAction.MAP_PARTICIPANT);
    const participant = await this.deps.participants.findById(input.participantId);
    if (participant === null) {
      throw new ProviderSyncFindingError(`Participant ${input.participantId} was not found.`, 'PARTICIPANT_NOT_FOUND', 404);
    }
    if (participant.sportLeagueId !== finding.sportLeague.id) {
      throw new ProviderSyncFindingError(`${participant.name} is not in ${finding.sportLeague.name}.`, 'SYNC_FINDING_PARTICIPANT_OTHER_LEAGUE', 422);
    }
    const source = this.mappingSourceOf(finding);
    await this.deps.participants.bindProviderMapping(participant.id, source.providerId, source.externalId);
    const saved = await this.deps.repository.setStatus(findingId, {
      status: ProviderSyncFindingStatus.RESOLVED,
      waiveNote: null,
      changedByUserId: input.userId,
      changedAt: this.now(),
    });
    if (saved === null) throw notFound(findingId);
    this.deps.logger?.info(
      { action: 'ingestion.syncFinding.participantMapped', findingId, participantId: participant.id, userId: input.userId },
      'A root admin mapped a sync finding\'s feed participant',
    );
    return saved;
  }

  /**
   * The slot definitions an OPEN SLOT_NAME_UNMATCHED finding's tournament can be linked to (#2011):
   * those its league matches tournaments to by name through its mapping to the finding's Provider,
   * each with the names that already place tournaments on it. 404 SYNC_FINDING_NOT_FOUND; 409
   * SYNC_FINDING_ACTION_NOT_OFFERED.
   */
  async slotLinkChoices(findingId: string): Promise<SlotNamePatternChoice[]> {
    const finding = await this.get(findingId);
    this.assertOffered(finding, ProviderSyncFindingAction.LINK_SLOT);
    return (await this.patternChoicesOf(finding))?.slots ?? [];
  }

  /**
   * "Link to existing" on an OPEN SLOT_NAME_UNMATCHED finding (#2011): adds the tournament's
   * normalized name as a NAME_PATTERN mapping of the chosen slot definition and resolves the
   * finding, so the next events sync links the tournament there. 404 SYNC_FINDING_NOT_FOUND or
   * SLOT_DEFINITION_NOT_FOUND (not one of the definitions offered); 409
   * SYNC_FINDING_ACTION_NOT_OFFERED, or SLOT_NAME_PATTERN_TAKEN when the name already places a
   * tournament.
   */
  async linkSlot(findingId: string, input: { slotDefinitionId: string; userId: string }): Promise<ProviderSyncFinding> {
    const finding = await this.get(findingId);
    this.assertOffered(finding, ProviderSyncFindingAction.LINK_SLOT);
    const choices = await this.patternChoicesOf(finding);
    if (choices === null || !choices.slots.some((slot) => slot.slotDefinitionId === input.slotDefinitionId)) {
      throw new ProviderSyncFindingError(`Slot ${input.slotDefinitionId} is not one ${finding.sportLeague.name} matches tournaments to by name.`, 'SLOT_DEFINITION_NOT_FOUND', 404);
    }
    const pattern = this.mappingSourceOf(finding).externalId;
    const added = await this.deps.slotNamePatterns.addPattern({
      sportLeagueId: finding.sportLeague.id,
      sportLeagueProviderMappingId: choices.sportLeagueProviderMappingId,
      slotDefinitionId: input.slotDefinitionId,
      pattern,
    });
    if (added === 'TAKEN') {
      throw new ProviderSyncFindingError(`"${pattern}" already places a tournament on a slot of ${finding.sportLeague.name}.`, 'SLOT_NAME_PATTERN_TAKEN', 409);
    }
    const saved = await this.deps.repository.setStatus(findingId, {
      status: ProviderSyncFindingStatus.RESOLVED,
      waiveNote: null,
      changedByUserId: input.userId,
      changedAt: this.now(),
    });
    if (saved === null) throw notFound(findingId);
    this.deps.logger?.info(
      { action: 'ingestion.syncFinding.slotLinked', findingId, slotDefinitionId: input.slotDefinitionId, pattern, userId: input.userId },
      'A root admin linked a sync finding\'s tournament name to a slot',
    );
    return saved;
  }

  /** The league's NAME_PATTERN definitions through its mapping to the finding's Provider; null without one. */
  private async patternChoicesOf(finding: ProviderSyncFinding): Promise<SlotNamePatternChoices | null> {
    return finding.provider === null ? null : this.deps.slotNamePatterns.findChoices(finding.sportLeague.id, finding.provider.id);
  }

  private assertOffered(finding: ProviderSyncFinding, action: ProviderSyncFindingAction): void {
    if (!providerSyncFindingActions(finding).includes(action)) {
      throw new ProviderSyncFindingError(
        `A ${finding.status} ${finding.kind} finding does not offer ${action}.`,
        'SYNC_FINDING_ACTION_NOT_OFFERED',
        409,
      );
    }
  }

  /**
   * The Provider row a mapping names (#2040), and the value the feed sent. An UNMAPPED_PARTICIPANT
   * or SLOT_NAME_UNMATCHED finding always has both.
   */
  private mappingSourceOf(finding: ProviderSyncFinding): { providerId: string; externalId: string } {
    if (finding.provider === null || finding.providerValue === null) {
      throw new Error(`Finding ${finding.id} names no Provider row or feed value to map from`);
    }
    return { providerId: finding.provider.id, externalId: finding.providerValue };
  }

  private providerOfSourceId(providerSourceId: string): ProviderSettings | undefined {
    const code = providerCodeOfSourceId(providerSourceId);
    return code === undefined ? undefined : providerByCode(this.deps.providers.all(), code);
  }
}

function notFound(findingId: string): ProviderSyncFindingError {
  return new ProviderSyncFindingError(`Sync finding ${findingId} was not found.`, 'SYNC_FINDING_NOT_FOUND', 404);
}

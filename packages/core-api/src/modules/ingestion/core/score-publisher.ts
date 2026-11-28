/**
 * Score Publisher — the entry point for live-score updates from provider
 * adapters. Per plans/117 §10.3:
 *
 *   1. Validate the typed `LiveScoreResult` with Zod (malformed adapter
 *      payloads fail here, not inside the persistence path).
 *   2. Resolve provider-side `participantExternalId` to internal
 *      `SportEventParticipant.id` UUIDs.
 *   3. Skip the update unless the event is scheduled or in progress, and
 *      unless the event's scoring family accepts the batch's live-score
 *      category.
 *   4. Persist the batch through the event's scoring family, which writes
 *      its own result rows (stroke play: `StrokePlayResultService`).
 *
 * It used to emit a `live_score.persisted` event as a fourth step. Nothing
 * ever subscribed, so #261 removed the event bus with it: the persisted rows
 * are the outcome, and callers read those.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import {
  LiveScoreResultSchema,
  type LiveScoreResult,
} from '@poolmaster/shared/dto';
import { JobErrorType, type ProviderSyncFindingKind, ProviderSyncFindingSeverity, providerCodeOfSourceId, SportEventStatus } from '@poolmaster/shared/domain';
import type { SyncWriteDiagnostics } from './sync-write-diagnostics';
import { emptySyncWriteDiagnostics } from './sync-write-diagnostics';
import type { DomainEvents } from '../../domain-events';
import type { LiveScoreTargetEvent, LiveScoreWriteDeps, LiveScoreWriter, ScoringFamilyEvent, ScoringFamilyModule } from '../../scoring-families';
import { countLiveScoreUpdates } from './live-score-count';

/** The event statuses a live score is written in: scheduled, since the feed's first score starts the event (#2013), and in progress. */
const LIVE_SCORE_EVENT_STATUSES: readonly SportEventStatus[] = [SportEventStatus.SCHEDULED, SportEventStatus.IN_PROGRESS];
import type { ProviderSyncFindingService } from '../findings/provider-sync-finding-service';
import type { EventFieldCache } from '../../events/event-field-cache';
import type { EventLifecycleService } from '../../events/event-lifecycle-service';

export class LiveScoreValidationError extends Error {
  /** Activity's Error column (#1861). */
  readonly jobErrorType = JobErrorType.BAD_DATA;

  constructor(reason: string, public readonly issues: unknown) {
    super(`LiveScoreResult failed Zod validation: ${reason}`);
    this.name = 'LiveScoreValidationError';
  }
}

export interface LiveScorePublisherDeps {
  prisma: PrismaClient;
  providerId: string;
  /** What follows the changes a family's writer makes (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  logger?: FastifyBaseLogger;
  /** Which scoring family scores an event, by its sport league's definition: the composition root passes the registry's. */
  scoringFamilyForEvent: (event: ScoringFamilyEvent) => ScoringFamilyModule;
  /** The event fields this container read lately: an event's is forgotten once its scores are written (#1163). */
  fieldCache?: Pick<EventFieldCache, 'forget'>;
  /** The app's event lifecycle, which a result passing a contest's cutoff puts it live through (#1954). */
  contestActivation: Pick<EventLifecycleService, 'activateContestsPastCutoff'>;
  /** Where a feed participant no participant is mapped to is raised as a finding (#1999). */
  findings: Pick<ProviderSyncFindingService, 'raiseUnmappedParticipants' | 'raiseOfSource'>;
}

export interface LiveScorePersistenceResult {
  updatesReturned: number;
  updatesPersisted: number;
  updatesSkipped: number;
  writeDiagnostics: SyncWriteDiagnostics;
  /**
   * The feed's participant ids the write skipped because no participant is mapped to them
   * (#1999). The publisher raises an UNMAPPED_PARTICIPANT finding for each.
   */
  unmappedExternalIds?: readonly string[];
  /**
   * What the write found about the provider's own game ids (#2007): a re-issued id or a game moved
   * to this event. The publisher raises a finding of the kind on the event for each.
   */
  gameFindings?: readonly LiveScoreGameFinding[];
}

/** A provider game id the write raises a finding about, with its kind. */
export interface LiveScoreGameFinding {
  kind: typeof ProviderSyncFindingKind.GAME_ID_REISSUED | typeof ProviderSyncFindingKind.GAME_MOVED;
  /** The provider's game id. */
  providerValue: string;
}

/**
 * Validate and persist. Returns event-side persistence diagnostics for
 * normalized round and standing rows; skipped provider rows are counted in
 * stats but are not written as fake diagnostic entities.
 */
export async function publishLiveScoreUpdate(
  result: LiveScoreResult,
  deps: LiveScorePublisherDeps,
): Promise<LiveScorePersistenceResult> {
  // 1. Validate before anything is persisted.
  const parsed = LiveScoreResultSchema.safeParse(result);
  if (!parsed.success) {
    deps.logger?.error(
      {
        action: 'liveScore.publish.validationFailed',
        data: { providerId: deps.providerId, issues: parsed.error.issues },
      },
      'Rejected LiveScoreResult that failed schema validation',
    );
    throw new LiveScoreValidationError('schema mismatch', parsed.error.issues);
  }
  const validated = parsed.data;
  const updatesReturned = countLiveScoreUpdates(validated);

  // 2/3. Resolve external → internal SportEvent so persistence is scoped
  // to one event, then dispatch to the per-category persistence path.
  // The event the provider knows by this id (#2004), and its league, and sport, through its Season.
  const providerCode = providerCodeOfSourceId(deps.providerId);
  const sportEvent = providerCode === undefined ? null : (await deps.prisma.sportEventProviderMapping.findFirst({
    where: { provider: { code: providerCode }, externalId: validated.externalEventId },
    select: {
      sportEvent: {
        select: {
          id: true, status: true,
          sportLeagueSeason: { select: { sportLeague: { select: { id: true, scoringFamily: true, sport: { select: { sport: true } } } } } },
        },
      },
    },
  }))?.sportEvent ?? null;
  if (!sportEvent) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.unknownSportEvent',
        data: { providerId: deps.providerId, externalEventId: validated.externalEventId, category: validated.category },
      },
      'Skipping live-score persistence — no internal SportEvent matches (providerId, externalEventId)',
    );
    // The WARN above is the diagnostic record.
    return {
      updatesReturned,
      updatesPersisted: 0,
      updatesSkipped: updatesReturned,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }

  // A live score is accepted while its event is scheduled or in progress (#2013): the feed's first
  // score is what starts a Match, its slot and then the event, so a scheduled event takes it. A
  // draft is not released, and a finished one is settled.
  if (!LIVE_SCORE_EVENT_STATUSES.includes(sportEvent.status)) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.eventNotInProgress',
        data: { providerId: deps.providerId, externalEventId: validated.externalEventId, sportEventId: sportEvent.id, status: sportEvent.status },
      },
      'Skipping live-score persistence — the event is not scheduled or in progress',
    );
    return {
      updatesReturned,
      updatesPersisted: 0,
      updatesSkipped: updatesReturned,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }

  // The event's scoring family writes the batch into its own result rows (#606), and only a
  // batch of the one category it accepts: a family entered by an admin accepts none.
  const writer = deps.scoringFamilyForEvent({
    sport: sportEvent.sportLeagueSeason.sportLeague.sport.sport,
    scoringFamily: sportEvent.sportLeagueSeason.sportLeague.scoringFamily,
  }).liveScores;
  const acceptedCategory = writer?.category ?? null;
  const target: LiveScoreTargetEvent = { id: sportEvent.id };
  const write = writer === null ? null : writeFor(writer, deps, target, validated);
  if (write === null) {
    deps.logger?.warn(
      {
        action: 'liveScore.publish.categoryNotAccepted',
        data: {
          providerId: deps.providerId,
          externalEventId: validated.externalEventId,
          sportEventId: sportEvent.id,
          sport: sportEvent.sportLeagueSeason.sportLeague.sport.sport,
          category: validated.category,
          acceptedCategory,
        },
      },
      'Skipping live-score persistence — the event\'s scoring family does not accept this live-score category',
    );
    return {
      updatesReturned,
      updatesPersisted: 0,
      updatesSkipped: updatesReturned,
      writeDiagnostics: emptySyncWriteDiagnostics(),
    };
  }
  try {
    const written = await write();
    // The scores are saved: a finding that fails to raise is logged and the write's result stands,
    // so the sync run is not failed or retried for a side record. The next sync raises it again.
    try {
      await deps.findings.raiseUnmappedParticipants({
        sportLeagueId: sportEvent.sportLeagueSeason.sportLeague.id,
        providerSourceId: deps.providerId,
        participants: (written.unmappedExternalIds ?? []).map((externalId) => ({ externalId, name: null })),
      });
      await deps.findings.raiseOfSource(deps.providerId, (written.gameFindings ?? []).map((finding) => ({
        ...finding,
        severity: ProviderSyncFindingSeverity.WARNING,
        sportLeagueId: sportEvent.sportLeagueSeason.sportLeague.id,
        sportEventId: sportEvent.id,
        providerValueName: null,
      })));
    } catch (err) {
      deps.logger?.error(
        { action: 'ingestion.syncFinding.raiseFailed', err, sportEventId: sportEvent.id, providerId: deps.providerId },
        'Raising unmapped participant findings failed; the scores were written',
      );
    }
    return written;
  } finally {
    deps.fieldCache?.forget(sportEvent.id);
  }
}

/**
 * The family writer's write of this batch, or null when the writer takes another category. Each
 * pair is narrowed together, so a writer is only ever handed the result it is typed for.
 */
function writeFor(
  writer: LiveScoreWriter,
  deps: LiveScoreWriteDeps,
  event: LiveScoreTargetEvent,
  result: LiveScoreResult,
): (() => Promise<LiveScorePersistenceResult>) | null {
  if (writer.category === 'GOLF' && result.category === 'GOLF') return () => writer.persist(deps, event, result);
  if (writer.category === 'GAME' && result.category === 'GAME') return () => writer.persist(deps, event, result);
  if (writer.category === 'RACE' && result.category === 'RACE') return () => writer.persist(deps, event, result);
  return null;
}



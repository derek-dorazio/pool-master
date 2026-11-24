/**
 * The SYNC_EVENT_GAMES_AND_TIERS job's runner (#1952): the provider's games, then the field's tiers
 * and prices. Its payload and the request that builds it are in `synced-field-follow-up-job.ts`;
 * this file is outside that builder so the follow-ups lint rule reads it.
 */

import type { SportEventRepository } from '@poolmaster/shared/db';
import { ProviderSyncFindingKind } from '@poolmaster/shared/domain';
import type { ProviderSyncFindingService } from '../ingestion/findings/provider-sync-finding-service';
import { DISCARD_BACKGROUND_JOB, type BackgroundJobAnswer } from '../background-jobs/background-job-outcome';
import type { ProviderGameSlateOutcome, ProviderGameSlateService } from './provider-game-slate';
import type { SyncEventGamesAndTiersJobPayload } from './synced-field-follow-up-job';
import { fieldValuationReport, type FieldValuationOutcome, type SyncedFieldValuationService } from './synced-field-valuation';

const dateOrNull = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

/** How many of the event's games one slate sync loaded or changed. */
function gamesChanged(slate: ProviderGameSlateOutcome | null): number {
  if (slate?.outcome === 'LOADED') return slate.matchCount;
  if (slate?.outcome === 'MATCHES_UPDATED') return slate.matchNumbers.length;
  return 0;
}

/** The tiers made and the participants priced by one valuation of the field. */
function valuedCount(valuation: FieldValuationOutcome): number {
  if (valuation.outcome !== 'VALUED') return 0;
  return (valuation.tiers.result === 'MADE' ? valuation.tiers.tierCount : 0)
    + (valuation.prices.result === 'MADE' ? valuation.prices.pricedCount : 0);
}

export interface SyncedFieldFollowUpsDeps {
  providerGames: Pick<ProviderGameSlateService, 'afterFieldLoad'>;
  valuation: Pick<SyncedFieldValuationService, 'afterFieldLoad'>;
  /** The event's sport league, for its GAMES_NOT_SYNCED finding. */
  sportEvents: Pick<SportEventRepository, 'findById'>;
  findings: Pick<ProviderSyncFindingService, 'checkEventOfSource'>;
}

/**
 * The SYNC_EVENT_GAMES_AND_TIERS job's handler: the provider's games first, so a draft's tiers and
 * prices come from a field whose games are in, then the tiers and prices. Each step reads the
 * event as it stands when the job runs and writes only what differs, so a retry or a repeat
 * changes nothing more. A step that fails is logged, not thrown: the field is written, and the
 * next field sync tries again. Games the provider listed that were not synced are a
 * GAMES_NOT_SYNCED finding on the event (#1999), resolved once a later run syncs them; the tier
 * and price warnings stay in the job's result. A run that changed nothing and has nothing to
 * report leaves no Activity row (#1865).
 */
export class SyncedFieldFollowUps {
  constructor(private readonly deps: SyncedFieldFollowUpsDeps) {}

  async run(payload: SyncEventGamesAndTiersJobPayload): Promise<BackgroundJobAnswer> {
    const ref = { providerId: payload.providerId, externalId: payload.externalId };
    const slate = await this.deps.providerGames.afterFieldLoad({
      ...ref,
      ...(payload.games !== undefined && { games: payload.games.map((game) => ({ ...game, scheduledAt: dateOrNull(game.scheduledAt) })) }),
      ...(payload.bracket !== undefined && { bracket: payload.bracket.map((match) => ({ ...match, scheduledAt: dateOrNull(match.scheduledAt) })) }),
    });
    const valuation = await this.deps.valuation.afterFieldLoad(ref);
    const { stats, warnings: valuationWarnings } = fieldValuationReport(valuation);
    // The slate answers null both for no games listed and for a sync that failed (it logs and
    // swallows the error), so whether the provider listed any tells the two apart.
    const listed = payload.games !== undefined || payload.bracket !== undefined;
    const gamesFailed = listed && slate === null;
    if (listed) await this.checkGames(payload, gamesFailed);
    const changedCount = gamesChanged(slate) + valuedCount(valuation);
    if (changedCount === 0 && !gamesFailed && valuationWarnings.length === 0) return DISCARD_BACKGROUND_JOB;
    return {
      changedCount,
      result: { games: slate ?? { outcome: gamesFailed ? 'FAILED' : 'NO_GAMES_LISTED' }, stats, warnings: valuationWarnings },
    };
  }

  /** The event's GAMES_NOT_SYNCED finding: raised when the listed games failed to sync, resolved when they synced. */
  private async checkGames(payload: SyncEventGamesAndTiersJobPayload, gamesFailed: boolean): Promise<void> {
    const event = await this.deps.sportEvents.findById(payload.sportEventId);
    if (event === null) return;
    await this.deps.findings.checkEventOfSource({
      kind: ProviderSyncFindingKind.GAMES_NOT_SYNCED,
      sportLeagueId: event.sportLeagueId,
      sportEventId: event.id,
      providerSourceId: payload.providerId,
      found: gamesFailed,
    });
  }
}

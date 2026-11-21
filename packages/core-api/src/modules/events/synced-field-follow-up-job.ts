/**
 * What follows a provider's field sync of an event (#1952): its games from the provider (ADR 0011,
 * #1728), then its tiers and prices from the field just written (#1822), in that order, as one
 * background job. The field sync writes the job with the field, so a task that stops between the
 * field and its follow-ups loses neither; until #1952 both ran inline after the write.
 *
 * The provider's games and bracket are the job's payload: they come with the field's detail and are
 * stored nowhere else. Its handler is `SyncedFieldFollowUps.run`.
 */

import { z } from 'zod';
import {
  BackgroundJobType,
  MatchSide,
  isSportEventStatusFinished,
  type BackgroundJobRequest,
} from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { DISCARD_BACKGROUND_JOB, type BackgroundJobAnswer } from '../background-jobs/background-job-outcome';
import type { DomainEventType, SportEventFieldSynced } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';
import type { ProviderGameSlateOutcome, ProviderGameSlateService } from './provider-game-slate';
import { fieldValuationReport, type FieldValuationOutcome, type SyncedFieldValuationService } from './synced-field-valuation';

const ProviderScheduledGameSchema = z.object({
  externalGameId: z.string().min(1),
  roundNumber: z.number().int(),
  homeTeamExternalId: z.string().min(1),
  awayTeamExternalId: z.string().min(1),
  scheduledAt: z.iso.datetime().nullable(),
  isNeutralSite: z.boolean(),
});

const ProviderBracketMatchSchema = z.object({
  matchNumber: z.number().int(),
  roundNumber: z.number().int(),
  homeTeamExternalId: z.string().min(1).nullable(),
  awayTeamExternalId: z.string().min(1).nullable(),
  isNeutralSite: z.boolean(),
  scheduledAt: z.iso.datetime().nullable(),
  advancesTo: z.object({ matchNumber: z.number().int(), side: z.enum(MatchSide) }).nullable(),
  regionLabel: z.string().nullable(),
});

export const SyncEventGamesAndTiersJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
  /** The provider and its event id the field came from, which the games are matched by. */
  providerId: z.string().min(1),
  externalId: z.string().min(1),
  /** The provider's games of the event, when it listed any. */
  games: z.array(ProviderScheduledGameSchema).optional(),
  /** A fixed-shape playoff's whole bracket, when the provider gave one. */
  bracket: z.array(ProviderBracketMatchSchema).optional(),
});
export type SyncEventGamesAndTiersJobPayload = z.infer<typeof SyncEventGamesAndTiersJobPayloadSchema>;

const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());
const dateOrNull = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));

/**
 * The job for one event whose field a sync just wrote. Its dedupe key holds one such job per event
 * waiting for its first try: a second sync of the event before it runs queues nothing more, and the
 * waiting job syncs the games the first one brought. The next sync after it is claimed queues a
 * fresh job, so games a provider changed in between are taken then.
 */
export function syncEventGamesAndTiersJob(jobs: Pick<BackgroundJobQueue, 'request'>, synced: Omit<SportEventFieldSynced, 'type'>): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS, {
    sportEventId: synced.sportEvent.id,
    providerId: synced.providerId,
    externalId: synced.externalId,
    ...(synced.games !== undefined && { games: synced.games.map((game) => ({ ...game, scheduledAt: isoOrNull(game.scheduledAt) })) }),
    ...(synced.bracket !== undefined && { bracket: synced.bracket.map((match) => ({ ...match, scheduledAt: isoOrNull(match.scheduledAt) })) }),
  }, {
    dedupeKey: `${BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS}:${synced.sportEvent.id}`,
  });
}

/**
 * A field sync of an event still to be played takes the provider's games, then tiers and prices
 * the field (#1952). A finished or cancelled event takes neither: its games are played and its
 * tiers and prices locked since its release.
 */
export const syncGamesThenTierFieldHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_FIELD_SYNCED> = {
  key: 'sync-games-then-tier-field',
  queues: [BackgroundJobType.SYNC_EVENT_GAMES_AND_TIERS],
  when: (event) => !isSportEventStatusFinished(event.sportEvent.status),
  jobs: (event, { queue }) => [syncEventGamesAndTiersJob(queue, event)],
};

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
}

/**
 * The SYNC_EVENT_GAMES_AND_TIERS job's handler: the provider's games first, so a draft's tiers and
 * prices come from a field whose games are in, then the tiers and prices. Each step reads the
 * event as it stands when the job runs and writes only what differs, so a retry or a repeat
 * changes nothing more. A step that fails is logged and reported as a warning in the job's result, not
 * thrown, as it was on the field sync's run: the field is written, and the next field sync tries
 * again. A run that changed nothing and has nothing to report leaves no Activity row (#1865).
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
    const warnings = [
      ...(gamesFailed ? [{ code: 'GAMES_NOT_SYNCED', message: 'The provider\'s games were not synced to the event; the next field sync tries again.' }] : []),
      ...valuationWarnings,
    ];
    const changedCount = gamesChanged(slate) + valuedCount(valuation);
    if (changedCount === 0 && warnings.length === 0) return DISCARD_BACKGROUND_JOB;
    return {
      changedCount,
      result: { games: slate ?? { outcome: gamesFailed ? 'FAILED' : 'NO_GAMES_LISTED' }, stats, warnings },
    };
  }
}

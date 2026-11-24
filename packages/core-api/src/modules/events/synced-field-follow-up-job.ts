/**
 * What follows a provider's field sync of an event (#1952): its games from the provider (ADR 0011,
 * #1728), then its tiers and prices from the field just written (#1822), in that order, as one
 * background job. The field sync writes the job with the field, so a task that stops between the
 * field and its follow-ups loses neither; until #1952 both ran inline after the write.
 *
 * The provider's games and bracket are the job's payload: they come with the field's detail and are
 * stored nowhere else. Its handler is `SyncedFieldFollowUps.run` (`synced-field-follow-ups.ts`).
 */

import { z } from 'zod';
import {
  BackgroundJobType,
  MatchSide,
  isSportEventStatusFinished,
  type BackgroundJobRequest,
} from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { DomainEventType, SportEventFieldSynced } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

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

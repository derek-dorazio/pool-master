/**
 * Provider webhook DTOs (#1498): the notification BALLDONTLIE posts to core-api when something
 * happens in a game or tournament. It only says what happened and where; core-api then reads the
 * current scores over REST, so nothing in it is written anywhere.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';

const VendorIdSchema = z.number().int().min(1);

export const BalldontlieWebhookNotificationSchema = z.object({
  event_type: z.string().min(1).max(100).optional().describe('What happened, as `<league>.<subject>.<event>`, such as `nfl.game.ended` or `pga.tournament.round_started`. The vendor\'s dashboard test event carries none, and is acknowledged and dropped.'),
  game: z.object({
    id: VendorIdSchema.describe('The vendor\'s game id.'),
  }).loose().optional().describe('The game it happened in, for a game\'s event.'),
  tournament: z.object({
    id: VendorIdSchema.describe('The vendor\'s tournament id.'),
  }).loose().optional().describe('The tournament it happened in, for a golf event.'),
}).loose().describe('A BALLDONTLIE webhook notification. Other fields the vendor sends (the play, the player, a best-effort score) are accepted and ignored.');
export type BalldontlieWebhookNotification = z.infer<typeof BalldontlieWebhookNotificationSchema>;

registerSchema('BalldontlieWebhookNotification', BalldontlieWebhookNotificationSchema);

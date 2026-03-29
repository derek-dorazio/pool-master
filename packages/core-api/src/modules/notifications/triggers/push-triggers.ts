/**
 * Push notification trigger definitions and EventBus wiring.
 *
 * Each trigger maps a domain event type to a push notification template
 * with title, body (with {{mustache}} placeholders), sound, category,
 * and priority. The `registerPushTriggers` function subscribes to the
 * EventBus so that incoming domain events automatically dispatch push
 * notifications through the NotificationDispatcher.
 */

import { eventBus } from '@poolmaster/shared/events';
import type { NotificationDispatcher } from '../core/dispatcher';
import crypto from 'node:crypto';

// --- Trigger Definitions ---

export interface PushTriggerTemplate {
  title: string;
  body: string;
  sound: string;
  category: string;
  priority: 'high' | 'normal';
}

export const PUSH_TRIGGERS: Record<string, PushTriggerTemplate> = {
  'draft.on_the_clock': {
    title: 'Your Turn to Pick!',
    body: "It's your turn in {{draftName}}. You have {{timeRemaining}} to make your pick.",
    sound: 'default',
    category: 'DRAFT_PICK',
    priority: 'high',
  },
  'draft.starting_soon': {
    title: 'Draft Starting Soon',
    body: '{{contestName}} draft starts in {{time}}.',
    sound: 'default',
    category: 'DRAFT_REMINDER',
    priority: 'normal',
  },
  'draft.clock_warning': {
    title: 'Pick Clock Running Out!',
    body: 'You have {{timeRemaining}} left to make your pick in {{draftName}}.',
    sound: 'urgent.caf',
    category: 'DRAFT_PICK',
    priority: 'high',
  },
  'draft.auto_picked': {
    title: 'Auto-Pick Made',
    body: '{{playerName}} was auto-picked for you in {{draftName}}.',
    sound: 'default',
    category: 'DRAFT_PICK',
    priority: 'normal',
  },
  'draft.completed': {
    title: 'Draft Complete',
    body: 'The draft for {{contestName}} is finished. Check your roster!',
    sound: 'default',
    category: 'DRAFT_RESULT',
    priority: 'normal',
  },
  'scoring.taken_the_lead': {
    title: 'You Took the Lead!',
    body: "You're now #1 in {{contestName}} with {{score}} points!",
    sound: 'cheer.caf',
    category: 'SCORE_UPDATE',
    priority: 'normal',
  },
  'scoring.overtaken': {
    title: 'You Dropped a Spot',
    body: '{{leaderName}} passed you in {{contestName}}. You are now #{{position}}.',
    sound: 'default',
    category: 'SCORE_UPDATE',
    priority: 'normal',
  },
  'scoring.event_started': {
    title: 'Event Started',
    body: '{{eventName}} is underway! Follow your picks in {{contestName}}.',
    sound: 'default',
    category: 'SCORE_UPDATE',
    priority: 'normal',
  },
  'contest.completed': {
    title: 'Contest Complete',
    body: '{{contestName}} is finished! {{winnerName}} wins with {{score}} points.',
    sound: 'default',
    category: 'CONTEST_RESULT',
    priority: 'normal',
  },
  'contest.you_won': {
    title: 'Congratulations!',
    body: 'You won {{contestName}} with {{score}} points!',
    sound: 'cheer.caf',
    category: 'CONTEST_RESULT',
    priority: 'high',
  },
  'contest.lock_approaching': {
    title: 'Contest Locking Soon',
    body: '{{contestName}} locks in {{timeRemaining}}. Make sure your picks are set!',
    sound: 'default',
    category: 'CONTEST_REMINDER',
    priority: 'high',
  },
  'league.member_joined': {
    title: 'New Member',
    body: '{{memberName}} joined {{leagueName}}.',
    sound: 'default',
    category: 'LEAGUE_UPDATE',
    priority: 'normal',
  },
  'league.invitation_received': {
    title: 'League Invitation',
    body: "You've been invited to join {{leagueName}}.",
    sound: 'default',
    category: 'LEAGUE_UPDATE',
    priority: 'normal',
  },
  'league.announcement': {
    title: 'League Announcement',
    body: '{{title}}',
    sound: 'default',
    category: 'LEAGUE_UPDATE',
    priority: 'high',
  },
};

// --- Template Rendering ---

/**
 * Renders a template string by replacing {{placeholder}} tokens with values
 * from the data object. Unresolved placeholders are left as-is.
 */
export function renderTriggerTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : `{{${key}}}`;
  });
}

// --- EventBus Registration ---

export interface PushTriggerEvent {
  type: string;
  tenantId: string;
  leagueId?: string;
  contestId?: string;
  recipientUserIds?: string[];
  recipientScope?: 'ALL_LEAGUE' | 'ALL_CONTEST' | 'COMMISSIONERS' | 'SPECIFIC';
  data: Record<string, unknown>;
}

/**
 * Subscribes to all push trigger event types on the EventBus.
 * When a matching event is published, it dispatches a PUSH notification
 * through the standard notification dispatcher pipeline.
 */
export function registerPushTriggers(dispatcher: NotificationDispatcher): void {
  for (const [eventType, trigger] of Object.entries(PUSH_TRIGGERS)) {
    eventBus.subscribe<PushTriggerEvent>(eventType, async (event) => {
      const title = renderTriggerTemplate(trigger.title, event.data);
      const body = renderTriggerTemplate(trigger.body, event.data);

      await dispatcher.dispatch({
        id: crypto.randomUUID(),
        type: event.type,
        sourceService: 'push-trigger',
        timestamp: new Date().toISOString(),
        tenantId: event.tenantId,
        leagueId: event.leagueId,
        contestId: event.contestId,
        recipientUserIds: event.recipientUserIds,
        recipientScope: event.recipientScope,
        data: {
          ...event.data,
          // Override with rendered title/body so the dispatcher can use them
          _pushTitle: title,
          _pushBody: body,
          _pushSound: trigger.sound,
          _pushCategory: trigger.category,
          _pushPriority: trigger.priority,
        },
        priority: trigger.priority === 'high' ? 'HIGH' : 'NORMAL',
        channels: ['PUSH'],
        action: {
          type: 'NAVIGATE',
          screen: resolveScreen(event.type, event),
          params: resolveParams(event),
        },
      });
    });
  }
}

/** Determines the deep-link screen based on event type. */
function resolveScreen(eventType: string, event: PushTriggerEvent): string {
  if (eventType.startsWith('draft.')) return 'draft_room';
  if (eventType.startsWith('scoring.')) return 'contest_leaderboard';
  if (eventType.startsWith('contest.')) return 'contest_detail';
  if (eventType.startsWith('league.')) return 'league_feed';
  return 'home';
}

/** Extracts deep-link params from the event context. */
function resolveParams(event: PushTriggerEvent): Record<string, string> {
  const params: Record<string, string> = {};
  if (event.contestId) params.contestId = event.contestId;
  if (event.leagueId) params.leagueId = event.leagueId;
  return params;
}

/**
 * PushTriggerConfigService — in-memory management of push trigger
 * configurations (enabled state, priority, sounds).
 *
 * Seeded from the PUSH_TRIGGERS constant in the notification-service.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushTriggerConfig {
  eventType: string;
  enabled: boolean;
  title: string;
  body: string;
  sound: string;
  priority: 'high' | 'normal';
  category: string;
}

export interface UpdatePushTriggerInput {
  enabled?: boolean;
  title?: string;
  body?: string;
  sound?: string;
  priority?: 'high' | 'normal';
  category?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PushTriggerNotFoundError extends Error {
  constructor(eventType: string) {
    super(`Push trigger not found: ${eventType}`);
    this.name = 'PushTriggerNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Seed data — mirrors notification-service/src/triggers/push-triggers.ts
// ---------------------------------------------------------------------------

interface TriggerSeed {
  eventType: string;
  title: string;
  body: string;
  sound: string;
  category: string;
  priority: 'high' | 'normal';
}

const DEFAULT_TRIGGERS: TriggerSeed[] = [
  { eventType: 'draft.on_the_clock', title: 'Your Turn to Pick!', body: "It's your turn in {{draftName}}. You have {{timeRemaining}} to make your pick.", sound: 'default', category: 'DRAFT_PICK', priority: 'high' },
  { eventType: 'draft.starting_soon', title: 'Draft Starting Soon', body: '{{contestName}} draft starts in {{time}}.', sound: 'default', category: 'DRAFT_REMINDER', priority: 'normal' },
  { eventType: 'draft.clock_warning', title: 'Pick Clock Running Out!', body: 'You have {{timeRemaining}} left to make your pick in {{draftName}}.', sound: 'urgent.caf', category: 'DRAFT_PICK', priority: 'high' },
  { eventType: 'draft.auto_picked', title: 'Auto-Pick Made', body: '{{playerName}} was auto-picked for you in {{draftName}}.', sound: 'default', category: 'DRAFT_PICK', priority: 'normal' },
  { eventType: 'draft.completed', title: 'Draft Complete', body: 'The draft for {{contestName}} is finished. Check your roster!', sound: 'default', category: 'DRAFT_RESULT', priority: 'normal' },
  { eventType: 'scoring.taken_the_lead', title: 'You Took the Lead!', body: "You're now #1 in {{contestName}} with {{score}} points!", sound: 'cheer.caf', category: 'SCORE_UPDATE', priority: 'normal' },
  { eventType: 'scoring.overtaken', title: 'You Dropped a Spot', body: '{{leaderName}} passed you in {{contestName}}. You are now #{{position}}.', sound: 'default', category: 'SCORE_UPDATE', priority: 'normal' },
  { eventType: 'scoring.event_started', title: 'Event Started', body: '{{eventName}} is underway! Follow your picks in {{contestName}}.', sound: 'default', category: 'SCORE_UPDATE', priority: 'normal' },
  { eventType: 'contest.completed', title: 'Contest Complete', body: '{{contestName}} is finished! {{winnerName}} wins with {{score}} points.', sound: 'default', category: 'CONTEST_RESULT', priority: 'normal' },
  { eventType: 'contest.you_won', title: 'Congratulations!', body: 'You won {{contestName}} with {{score}} points!', sound: 'cheer.caf', category: 'CONTEST_RESULT', priority: 'high' },
  { eventType: 'contest.lock_approaching', title: 'Contest Locking Soon', body: '{{contestName}} locks in {{timeRemaining}}. Make sure your picks are set!', sound: 'default', category: 'CONTEST_REMINDER', priority: 'high' },
  { eventType: 'league.member_joined', title: 'New Member', body: '{{memberName}} joined {{leagueName}}.', sound: 'default', category: 'LEAGUE_UPDATE', priority: 'normal' },
  { eventType: 'league.invitation_received', title: 'League Invitation', body: "You've been invited to join {{leagueName}}.", sound: 'default', category: 'LEAGUE_UPDATE', priority: 'normal' },
  { eventType: 'league.announcement', title: 'League Announcement', body: '{{title}}', sound: 'default', category: 'LEAGUE_UPDATE', priority: 'high' },
];

function buildDefaultConfigs(): Map<string, PushTriggerConfig> {
  const configs = new Map<string, PushTriggerConfig>();
  for (const seed of DEFAULT_TRIGGERS) {
    configs.set(seed.eventType, { ...seed, enabled: true });
  }
  return configs;
}

function buildDefaultsLookup(): Map<string, TriggerSeed> {
  const lookup = new Map<string, TriggerSeed>();
  for (const seed of DEFAULT_TRIGGERS) {
    lookup.set(seed.eventType, { ...seed });
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PushTriggerConfigService {
  private triggers: Map<string, PushTriggerConfig> = buildDefaultConfigs();
  private readonly defaults: Map<string, TriggerSeed> = buildDefaultsLookup();

  async listTriggers(): Promise<PushTriggerConfig[]> {
    return Array.from(this.triggers.values());
  }

  async updateTrigger(
    eventType: string,
    updates: UpdatePushTriggerInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<PushTriggerConfig> {
    const trigger = this.triggers.get(eventType);
    if (!trigger) {
      throw new PushTriggerNotFoundError(eventType);
    }

    const beforeState = { ...trigger };

    if (updates.enabled !== undefined) trigger.enabled = updates.enabled;
    if (updates.title !== undefined) trigger.title = updates.title;
    if (updates.body !== undefined) trigger.body = updates.body;
    if (updates.sound !== undefined) trigger.sound = updates.sound;
    if (updates.priority !== undefined) trigger.priority = updates.priority;
    if (updates.category !== undefined) trigger.category = updates.category;

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.push_trigger.update',
      resourceType: 'PUSH_TRIGGER',
      resourceId: eventType,
      description: `Updated push trigger config for "${eventType}"`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: trigger as unknown as Record<string, unknown>,
    });

    return trigger;
  }

  async enableTrigger(
    eventType: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<PushTriggerConfig> {
    return this.setEnabled(eventType, true, adminUserId, adminUserEmail);
  }

  async disableTrigger(
    eventType: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<PushTriggerConfig> {
    return this.setEnabled(eventType, false, adminUserId, adminUserEmail);
  }

  async resetAll(
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<PushTriggerConfig[]> {
    const beforeState = Array.from(this.triggers.values());

    this.triggers = buildDefaultConfigs();

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.push_trigger.reset_all',
      resourceType: 'PUSH_TRIGGER',
      resourceId: '*',
      description: 'Reset all push trigger configs to defaults',
      beforeState: { triggers: beforeState } as unknown as Record<string, unknown>,
      afterState: { triggers: Array.from(this.triggers.values()) } as unknown as Record<string, unknown>,
    });

    return Array.from(this.triggers.values());
  }

  // --- Private helpers ---

  private async setEnabled(
    eventType: string,
    enabled: boolean,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<PushTriggerConfig> {
    const trigger = this.triggers.get(eventType);
    if (!trigger) {
      throw new PushTriggerNotFoundError(eventType);
    }

    const beforeState = { ...trigger };
    trigger.enabled = enabled;

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: enabled ? 'config.push_trigger.enable' : 'config.push_trigger.disable',
      resourceType: 'PUSH_TRIGGER',
      resourceId: eventType,
      description: `${enabled ? 'Enabled' : 'Disabled'} push trigger "${eventType}"`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: trigger as unknown as Record<string, unknown>,
    });

    return trigger;
  }
}

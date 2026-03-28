/**
 * NotificationConfigService — in-memory CRUD for notification templates.
 *
 * Manages push title/body, email subject/body, and in-app title/body
 * per event type. Seeded from the notification-service seed templates.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationTemplateEntry {
  eventType: string;
  category: string;
  pushTitle?: string;
  pushBody?: string;
  emailSubject?: string;
  emailText?: string;
  inAppTitle?: string;
  inAppBody?: string;
  inAppIcon?: string;
  smsBody?: string;
  updatedAt: Date;
}

export interface UpdateNotificationTemplateInput {
  pushTitle?: string;
  pushBody?: string;
  emailSubject?: string;
  emailText?: string;
  inAppTitle?: string;
  inAppBody?: string;
  inAppIcon?: string;
  smsBody?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NotificationTemplateNotFoundError extends Error {
  constructor(eventType: string) {
    super(`Notification template not found: ${eventType}`);
    this.name = 'NotificationTemplateNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Seed data — mirrors notification-service/src/templates/seed-templates.ts
// ---------------------------------------------------------------------------

interface TemplateSeed {
  eventType: string;
  category: string;
  pushTitle?: string;
  pushBody?: string;
  emailSubject?: string;
  emailText?: string;
  inAppTitle?: string;
  inAppBody?: string;
  inAppIcon?: string;
  smsBody?: string;
}

const SEED_TEMPLATES: TemplateSeed[] = [
  {
    eventType: 'draft.starting_soon',
    category: 'DRAFT',
    pushTitle: 'Draft starting soon',
    pushBody: '{{contest_name}} draft starts in {{time_until}}',
    emailSubject: 'Draft starting soon — {{contest_name}}',
    emailText: 'The draft for {{contest_name}} starts in {{time_until}}. Make sure you\'re ready!',
    inAppTitle: 'Draft starting soon',
    inAppBody: '{{contest_name}} draft starts in {{time_until}}',
    inAppIcon: 'draft',
  },
  {
    eventType: 'draft.on_the_clock',
    category: 'DRAFT',
    pushTitle: 'You\'re on the clock!',
    pushBody: '{{team_name}}, it\'s your pick in {{contest_name}}. {{time_remaining}} remaining.',
    emailSubject: 'It\'s your turn to pick — {{contest_name}}',
    emailText: '{{team_name}}, you\'re on the clock in {{contest_name}}! Pick {{pick_number}} of {{total_picks}}. {{time_remaining}} remaining.',
    inAppTitle: 'Your pick — {{contest_name}}',
    inAppBody: 'You\'re on the clock! Pick {{pick_number}} of {{total_picks}}. {{time_remaining}} remaining.',
    inAppIcon: 'draft',
    smsBody: 'PoolMaster: Your pick in {{contest_name}}! {{time_remaining}} left.',
  },
  {
    eventType: 'draft.auto_picked',
    category: 'DRAFT',
    pushTitle: 'Auto-pick activated',
    pushBody: '{{participant_name}} was auto-picked for {{team_name}} in {{contest_name}}',
    inAppTitle: 'Auto-pick — {{contest_name}}',
    inAppBody: '{{participant_name}} was auto-picked for you. You missed your pick window.',
    inAppIcon: 'draft',
  },
  {
    eventType: 'draft.completed',
    category: 'DRAFT',
    pushTitle: 'Draft complete!',
    pushBody: '{{contest_name}} draft is done. View your roster.',
    emailSubject: 'Draft complete — {{contest_name}}',
    emailText: 'The draft for {{contest_name}} is complete! View your final roster and get ready for the contest.',
    inAppTitle: 'Draft complete — {{contest_name}}',
    inAppBody: 'The draft is done! View your roster.',
    inAppIcon: 'draft',
  },
  {
    eventType: 'scoring.taken_the_lead',
    category: 'SCORING',
    pushTitle: 'You\'re in the lead!',
    pushBody: '{{team_name}} has moved to 1st in {{contest_name}} with {{score}} points',
    inAppTitle: 'You took the lead!',
    inAppBody: '{{team_name}} is now 1st in {{contest_name}} with {{score}} points.',
    inAppIcon: 'trophy',
  },
  {
    eventType: 'scoring.event_completed',
    category: 'SCORING',
    pushTitle: 'Event completed',
    pushBody: '{{event_name}} has ended. Check final scores in {{contest_name}}.',
    inAppTitle: '{{event_name}} — Final',
    inAppBody: 'The event has ended. Final standings are in.',
    inAppIcon: 'score',
  },
  {
    eventType: 'contest.created',
    category: 'CONTEST',
    pushTitle: 'New contest',
    pushBody: '{{contest_name}} is now open in {{league_name}}',
    emailSubject: 'New contest — {{contest_name}}',
    emailText: 'A new contest "{{contest_name}}" has been created in {{league_name}}. Join now!',
    inAppTitle: 'New contest — {{contest_name}}',
    inAppBody: '{{contest_name}} is open in {{league_name}}.',
    inAppIcon: 'contest',
  },
  {
    eventType: 'contest.lock_approaching',
    category: 'CONTEST',
    pushTitle: 'Picks lock soon',
    pushBody: '{{contest_name}} locks in {{time_until}}. Make your picks!',
    emailSubject: 'Picks lock soon — {{contest_name}}',
    emailText: '{{contest_name}} picks lock in {{time_until}}. Don\'t forget to submit!',
    inAppTitle: 'Lock approaching — {{contest_name}}',
    inAppBody: 'Picks lock in {{time_until}}.',
    inAppIcon: 'clock',
  },
  {
    eventType: 'contest.you_won',
    category: 'CONTEST',
    pushTitle: 'You won {{contest_name}}!',
    pushBody: 'Congratulations! Final score: {{score}} points. Prize: {{prize_amount}}.',
    emailSubject: 'You won {{contest_name}}!',
    emailText: 'Congratulations! You won {{contest_name}} with {{score}} points. Prize: {{prize_amount}}.',
    inAppTitle: 'Winner — {{contest_name}}',
    inAppBody: 'Congratulations! You finished 1st with {{score}} points.',
    inAppIcon: 'trophy',
  },
  {
    eventType: 'contest.completed',
    category: 'CONTEST',
    pushTitle: '{{contest_name}} is final',
    pushBody: 'Final results are in. You finished #{{rank}}.',
    emailSubject: '{{contest_name}} — Final Results',
    emailText: '{{contest_name}} is complete. You finished #{{rank}} with {{score}} points.',
    inAppTitle: '{{contest_name}} — Final',
    inAppBody: 'You finished #{{rank}} with {{score}} points.',
    inAppIcon: 'contest',
  },
  {
    eventType: 'league.invitation_received',
    category: 'LEAGUE',
    pushTitle: 'League invitation',
    pushBody: 'You\'ve been invited to join {{league_name}}',
    emailSubject: 'You\'re invited to {{league_name}}',
    emailText: 'You\'ve been invited to join {{league_name}} on PoolMaster. Click to accept!',
    inAppTitle: 'League invitation',
    inAppBody: 'You\'ve been invited to {{league_name}}.',
    inAppIcon: 'league',
  },
  {
    eventType: 'league.announcement',
    category: 'LEAGUE',
    pushTitle: '{{league_name}} announcement',
    pushBody: '{{title}}',
    emailSubject: '{{league_name}} — {{title}}',
    emailText: '{{body}}',
    inAppTitle: '{{title}}',
    inAppBody: '{{body}}',
    inAppIcon: 'announcement',
  },
  {
    eventType: 'account.welcome',
    category: 'ACCOUNT',
    emailSubject: 'Welcome to PoolMaster!',
    emailText: 'Welcome to PoolMaster, {{display_name}}! Get started by creating or joining a league.',
    inAppTitle: 'Welcome to PoolMaster!',
    inAppBody: 'Get started by creating or joining a league.',
    inAppIcon: 'welcome',
  },
];

function buildDefaultTemplates(): Map<string, NotificationTemplateEntry> {
  const templates = new Map<string, NotificationTemplateEntry>();
  const now = new Date();

  for (const seed of SEED_TEMPLATES) {
    templates.set(seed.eventType, {
      ...seed,
      updatedAt: now,
    });
  }

  return templates;
}

// Keep a pristine copy for reset
function buildDefaultsLookup(): Map<string, TemplateSeed> {
  const lookup = new Map<string, TemplateSeed>();
  for (const seed of SEED_TEMPLATES) {
    lookup.set(seed.eventType, { ...seed });
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NotificationConfigService {
  private templates: Map<string, NotificationTemplateEntry> = buildDefaultTemplates();
  private readonly defaults: Map<string, TemplateSeed> = buildDefaultsLookup();

  async listTemplates(): Promise<NotificationTemplateEntry[]> {
    return Array.from(this.templates.values());
  }

  async getTemplate(eventType: string): Promise<NotificationTemplateEntry> {
    const template = this.templates.get(eventType);
    if (!template) {
      throw new NotificationTemplateNotFoundError(eventType);
    }
    return template;
  }

  async updateTemplate(
    eventType: string,
    updates: UpdateNotificationTemplateInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<NotificationTemplateEntry> {
    const template = this.templates.get(eventType);
    if (!template) {
      throw new NotificationTemplateNotFoundError(eventType);
    }

    const beforeState = { ...template };

    if (updates.pushTitle !== undefined) template.pushTitle = updates.pushTitle;
    if (updates.pushBody !== undefined) template.pushBody = updates.pushBody;
    if (updates.emailSubject !== undefined) template.emailSubject = updates.emailSubject;
    if (updates.emailText !== undefined) template.emailText = updates.emailText;
    if (updates.inAppTitle !== undefined) template.inAppTitle = updates.inAppTitle;
    if (updates.inAppBody !== undefined) template.inAppBody = updates.inAppBody;
    if (updates.inAppIcon !== undefined) template.inAppIcon = updates.inAppIcon;
    if (updates.smsBody !== undefined) template.smsBody = updates.smsBody;
    template.updatedAt = new Date();

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.notification_template.update',
      resourceType: 'NOTIFICATION_TEMPLATE',
      resourceId: eventType,
      description: `Updated notification template for "${eventType}"`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: template as unknown as Record<string, unknown>,
    });

    return template;
  }

  async resetTemplate(
    eventType: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<NotificationTemplateEntry> {
    const defaultSeed = this.defaults.get(eventType);
    if (!defaultSeed) {
      throw new NotificationTemplateNotFoundError(eventType);
    }

    const existing = this.templates.get(eventType);
    const beforeState = existing ? { ...existing } : undefined;

    const now = new Date();
    const restored: NotificationTemplateEntry = {
      ...defaultSeed,
      updatedAt: now,
    };

    this.templates.set(eventType, restored);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'config.notification_template.reset',
      resourceType: 'NOTIFICATION_TEMPLATE',
      resourceId: eventType,
      description: `Reset notification template for "${eventType}" to defaults`,
      beforeState: beforeState as unknown as Record<string, unknown>,
      afterState: restored as unknown as Record<string, unknown>,
    });

    return restored;
  }
}

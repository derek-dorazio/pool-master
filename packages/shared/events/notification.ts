/**
 * Notification events — emitted by services, consumed by Notification Service.
 */

import type { DomainEvent } from './base';

export type NotificationCategory =
  | 'DRAFT'
  | 'SCORING'
  | 'CONTEST'
  | 'LEAGUE'
  | 'SOCIAL'
  | 'ACCOUNT';

export type NotificationPriority = 'HIGH' | 'NORMAL' | 'LOW';

export type NotificationChannel = 'PUSH' | 'IN_APP' | 'EMAIL' | 'SMS';

export interface NotificationEvent extends DomainEvent {
  type: string;
  sourceService: string;

  // Targeting
  leagueId?: string;
  contestId?: string;
  recipientUserIds?: string[];
  recipientScope?: 'ALL_LEAGUE' | 'ALL_CONTEST' | 'COMMISSIONERS' | 'SPECIFIC';

  // Template data
  data: Record<string, unknown>;

  // Routing
  priority: NotificationPriority;
  channels?: NotificationChannel[];
  ttlSeconds?: number;
  collapseKey?: string;

  // Deep linking
  action: {
    type: 'NAVIGATE';
    screen: string;
    params: Record<string, string>;
  };
}

/** Well-known notification event types. */
export const NotificationEventType = {
  // Draft
  DRAFT_STARTING_SOON: 'draft.starting_soon',
  DRAFT_ON_THE_CLOCK: 'draft.on_the_clock',
  DRAFT_CLOCK_WARNING: 'draft.clock_warning',
  DRAFT_PICK_MADE: 'draft.pick_made',
  DRAFT_YOUR_PICK_CONFIRMED: 'draft.your_pick_confirmed',
  DRAFT_AUTO_PICKED: 'draft.auto_picked',
  DRAFT_COMPLETED: 'draft.completed',
  DRAFT_PAUSED: 'draft.paused',
  DRAFT_RESUMED: 'draft.resumed',

  // Scoring
  SCORING_TAKEN_THE_LEAD: 'scoring.taken_the_lead',
  SCORING_OVERTAKEN: 'scoring.overtaken',
  SCORING_POSITION_CHANGE: 'scoring.position_change',
  SCORING_EVENT_STARTED: 'scoring.event_started',
  SCORING_EVENT_COMPLETED: 'scoring.event_completed',
  SCORING_CORRECTION_APPLIED: 'scoring.correction_applied',

  // Contest
  CONTEST_CREATED: 'contest.created',
  CONTEST_LOCK_APPROACHING: 'contest.lock_approaching',
  CONTEST_LOCKED: 'contest.locked',
  CONTEST_COMPLETED: 'contest.completed',
  CONTEST_YOU_WON: 'contest.you_won',
  CONTEST_PAYOUT_CONFIRMED: 'contest.payout_confirmed',
  CONTEST_INTERMEDIATE_PRIZE: 'contest.intermediate_prize',

  // League
  LEAGUE_MEMBER_JOINED: 'league.member_joined',
  LEAGUE_MEMBER_LEFT: 'league.member_left',
  LEAGUE_INVITATION_RECEIVED: 'league.invitation_received',
  LEAGUE_ANNOUNCEMENT: 'league.announcement',
  LEAGUE_WEEKLY_RECAP: 'league.weekly_recap',

  // Social
  SOCIAL_REPLY: 'social.reply_to_your_post',
  SOCIAL_REACTION: 'social.reaction_to_your_post',
  SOCIAL_MENTIONED: 'social.mentioned',
  SOCIAL_DIRECT_MESSAGE: 'social.direct_message',

  // Account
  ACCOUNT_WELCOME: 'account.welcome',
  ACCOUNT_PASSWORD_RESET: 'account.password_reset',
  ACCOUNT_EMAIL_CHANGED: 'account.email_changed',
  ACCOUNT_PAYMENT_FAILED: 'account.payment_failed',
  ACCOUNT_PLAN_CHANGED: 'account.plan_changed',
  ACCOUNT_TRIAL_ENDING: 'account.trial_ending',
} as const;

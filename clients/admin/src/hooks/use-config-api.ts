import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api-client';
import { Sport } from '@poolmaster/shared/domain';

// ── Scoring Templates ──────────────────────────────────────────────────────────

export interface ScoringTemplate {
  id: string;
  name: string;
  sport: string;
  type: string;
  description: string;
  lastModified: string;
}

const MOCK_SCORING_TEMPLATES: ScoringTemplate[] = [
  { id: 'st-1', name: 'NFL Standard', sport: Sport.NFL, type: 'Points', description: 'Standard NFL scoring with TDs, FGs, turnovers', lastModified: '2026-03-20' },
  { id: 'st-2', name: 'NFL PPR', sport: Sport.NFL, type: 'Points', description: 'Points per reception scoring variant', lastModified: '2026-03-18' },
  { id: 'st-3', name: 'NBA Fantasy', sport: Sport.NBA, type: 'Points', description: 'Category-based NBA scoring', lastModified: '2026-03-15' },
  { id: 'st-4', name: 'Soccer Goals Only', sport: Sport.SOCCER, type: 'Simple', description: 'Goals and assists only scoring', lastModified: '2026-03-22' },
  { id: 'st-5', name: 'Golf Stroke Play', sport: Sport.GOLF, type: 'Stroke', description: 'Under/over par scoring for stroke play', lastModified: '2026-03-24' },
  { id: 'st-6', name: 'NASCAR Points', sport: Sport.NASCAR, type: 'Position', description: 'Position-based points with stage bonuses', lastModified: '2026-03-10' },
  { id: 'st-7', name: 'NCAA Bracket', sport: Sport.NCAA_BASKETBALL, type: 'Bracket', description: 'Round-weighted bracket scoring', lastModified: '2026-03-25' },
  { id: 'st-8', name: 'Tennis Match', sport: Sport.TENNIS, type: 'Match', description: 'Sets and match-win scoring', lastModified: '2026-03-12' },
];

export function useScoringTemplates() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'scoring-templates'],
    queryFn: async () => {
      try {
        return await adminApi.get<ScoringTemplate[]>('/v1/admin/config/scoring-templates');
      } catch {
        return MOCK_SCORING_TEMPLATES;
      }
    },
  });

  return { data: data ?? MOCK_SCORING_TEMPLATES, isLoading };
}

// ── Selection Templates ────────────────────────────────────────────────────────

export interface SelectionTemplate {
  id: string;
  name: string;
  sport: string;
  type: string;
  description: string;
  lastModified: string;
}

const MOCK_SELECTION_TEMPLATES: SelectionTemplate[] = [
  { id: 'sel-1', name: 'NFL Pick\'em', sport: Sport.NFL, type: 'Pick', description: 'Weekly game pick selections', lastModified: '2026-03-20' },
  { id: 'sel-2', name: 'NFL Survivor', sport: Sport.NFL, type: 'Survivor', description: 'Single team weekly survivor pool', lastModified: '2026-03-18' },
  { id: 'sel-3', name: 'Golf DFS', sport: Sport.GOLF, type: 'Salary Cap', description: 'Daily fantasy salary cap selections', lastModified: '2026-03-22' },
  { id: 'sel-4', name: 'NASCAR Top 5', sport: Sport.NASCAR, type: 'Rank', description: 'Predict top 5 finishers', lastModified: '2026-03-15' },
  { id: 'sel-5', name: 'NCAA Bracket', sport: Sport.NCAA_BASKETBALL, type: 'Bracket', description: '64-team bracket selection', lastModified: '2026-03-25' },
  { id: 'sel-6', name: 'Soccer Prop', sport: Sport.SOCCER, type: 'Prop', description: 'Player prop bet selections', lastModified: '2026-03-14' },
];

export function useSelectionTemplates() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'selection-templates'],
    queryFn: async () => {
      try {
        return await adminApi.get<SelectionTemplate[]>('/v1/admin/config/selection-templates');
      } catch {
        return MOCK_SELECTION_TEMPLATES;
      }
    },
  });

  return { data: data ?? MOCK_SELECTION_TEMPLATES, isLoading };
}

// ── Push Triggers ──────────────────────────────────────────────────────────────

export type Priority = 'high' | 'normal' | 'low';

export interface PushTrigger {
  id: string;
  eventType: string;
  title: string;
  body: string;
  priority: Priority;
  sound: string;
  enabled: boolean;
}

const MOCK_PUSH_TRIGGERS: PushTrigger[] = [
  { id: 'pt-1', eventType: 'DRAFT_STARTED', title: 'Draft is Live!', body: 'Your draft has started. Make your picks now.', priority: 'high', sound: 'chime', enabled: true },
  { id: 'pt-2', eventType: 'DRAFT_PICK_TURN', title: 'Your Turn to Pick', body: 'It\'s your turn in the draft.', priority: 'high', sound: 'alert', enabled: true },
  { id: 'pt-3', eventType: 'DRAFT_COMPLETED', title: 'Draft Complete', body: 'The draft has ended. Review your roster.', priority: 'normal', sound: 'default', enabled: true },
  { id: 'pt-4', eventType: 'SCORING_UPDATE', title: 'Score Update', body: 'Scores have been updated for your contest.', priority: 'low', sound: 'default', enabled: true },
  { id: 'pt-5', eventType: 'CONTEST_STARTED', title: 'Contest Underway', body: 'Your contest has officially started.', priority: 'normal', sound: 'chime', enabled: true },
  { id: 'pt-6', eventType: 'CONTEST_ENDED', title: 'Contest Final', body: 'Your contest has ended. Check results.', priority: 'normal', sound: 'default', enabled: true },
  { id: 'pt-7', eventType: 'LEAGUE_INVITE', title: 'League Invitation', body: 'You\'ve been invited to join a league.', priority: 'normal', sound: 'chime', enabled: true },
  { id: 'pt-8', eventType: 'TRADE_PROPOSED', title: 'Trade Proposal', body: 'A new trade has been proposed.', priority: 'normal', sound: 'default', enabled: true },
  { id: 'pt-9', eventType: 'TRADE_ACCEPTED', title: 'Trade Accepted', body: 'Your trade has been accepted.', priority: 'normal', sound: 'chime', enabled: true },
  { id: 'pt-10', eventType: 'PAYMENT_SUCCESS', title: 'Payment Confirmed', body: 'Your payment has been processed.', priority: 'normal', sound: 'default', enabled: true },
  { id: 'pt-11', eventType: 'PAYMENT_FAILED', title: 'Payment Failed', body: 'Your payment could not be processed.', priority: 'high', sound: 'alert', enabled: true },
  { id: 'pt-12', eventType: 'PAYOUT_READY', title: 'Payout Available', body: 'You have a payout ready to claim.', priority: 'high', sound: 'chime', enabled: true },
  { id: 'pt-13', eventType: 'ANNOUNCEMENT', title: 'New Announcement', body: 'There is a new announcement from Ultimate Pool Manager.', priority: 'low', sound: 'default', enabled: false },
];

export function usePushTriggers() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'push-triggers'],
    queryFn: async () => {
      try {
        return await adminApi.get<PushTrigger[]>('/v1/admin/config/push-triggers');
      } catch {
        return MOCK_PUSH_TRIGGERS;
      }
    },
  });

  return { data: data ?? MOCK_PUSH_TRIGGERS, isLoading };
}

// ── Notification Templates ─────────────────────────────────────────────────────

export interface NotificationTemplate {
  id: string;
  eventType: string;
  pushTitle: string;
  pushBody: string;
  emailSubject: string;
  emailBodyPreview: string;
  inAppTitle: string;
  inAppBody: string;
}

const MOCK_NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  { id: 'nt-1', eventType: 'DRAFT_STARTED', pushTitle: 'Draft is Live!', pushBody: 'Your draft has started.', emailSubject: 'Your Draft Has Started', emailBodyPreview: 'Log in now to make your picks...', inAppTitle: 'Draft Started', inAppBody: 'Your draft is now live. Head to the draft room.' },
  { id: 'nt-2', eventType: 'CONTEST_ENDED', pushTitle: 'Contest Final', pushBody: 'Results are in.', emailSubject: 'Contest Results Are In', emailBodyPreview: 'Check your final standings...', inAppTitle: 'Contest Complete', inAppBody: 'Final results are available for your contest.' },
  { id: 'nt-3', eventType: 'PAYMENT_FAILED', pushTitle: 'Payment Issue', pushBody: 'Action needed.', emailSubject: 'Payment Failed - Action Required', emailBodyPreview: 'We could not process your payment...', inAppTitle: 'Payment Failed', inAppBody: 'Please update your payment method.' },
  { id: 'nt-4', eventType: 'LEAGUE_INVITE', pushTitle: 'You\'re Invited!', pushBody: 'Join a league.', emailSubject: 'You\'ve Been Invited to a League', emailBodyPreview: 'A friend invited you to join...', inAppTitle: 'League Invitation', inAppBody: 'You have a pending league invitation.' },
  { id: 'nt-5', eventType: 'PAYOUT_READY', pushTitle: 'Payout Ready', pushBody: 'Claim your winnings.', emailSubject: 'Your Payout Is Ready', emailBodyPreview: 'You have a payout available to claim...', inAppTitle: 'Payout Available', inAppBody: 'Your winnings are ready to be claimed.' },
];

export function useNotificationTemplates() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'notification-templates'],
    queryFn: async () => {
      try {
        return await adminApi.get<NotificationTemplate[]>('/v1/admin/config/notification-templates');
      } catch {
        return MOCK_NOTIFICATION_TEMPLATES;
      }
    },
  });

  return { data: data ?? MOCK_NOTIFICATION_TEMPLATES, isLoading };
}

// ── Channel Defaults ───────────────────────────────────────────────────────────

export type Channel = 'push' | 'email' | 'sms' | 'in_app';
export type NotificationCategory = 'DRAFT' | 'SCORING' | 'CONTEST' | 'LEAGUE' | 'SOCIAL' | 'ACCOUNT';

export interface ChannelDefault {
  category: NotificationCategory;
  channels: Channel[];
}

const MOCK_CHANNEL_DEFAULTS: ChannelDefault[] = [
  { category: 'DRAFT', channels: ['push', 'email', 'in_app'] },
  { category: 'SCORING', channels: ['push', 'in_app'] },
  { category: 'CONTEST', channels: ['push', 'email', 'in_app'] },
  { category: 'LEAGUE', channels: ['push', 'email', 'in_app', 'sms'] },
  { category: 'SOCIAL', channels: ['push', 'in_app'] },
  { category: 'ACCOUNT', channels: ['email', 'sms', 'in_app'] },
];

export function useChannelDefaults() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'channel-defaults'],
    queryFn: async () => {
      try {
        return await adminApi.get<ChannelDefault[]>('/v1/admin/config/channel-defaults');
      } catch {
        return MOCK_CHANNEL_DEFAULTS;
      }
    },
  });

  return { data: data ?? MOCK_CHANNEL_DEFAULTS, isLoading };
}

// ── Rate Limits ────────────────────────────────────────────────────────────────

export interface CollapseRule {
  eventType: string;
  maxPerHour: number;
  windowMinutes: number;
}

export interface RateLimitConfig {
  pushPerHour: number;
  emailPerDay: number;
  smsPerDay: number;
  dedupWindowSeconds: number;
  collapseRules: CollapseRule[];
}

const MOCK_RATE_LIMITS: RateLimitConfig = {
  pushPerHour: 10,
  emailPerDay: 20,
  smsPerDay: 5,
  dedupWindowSeconds: 60,
  collapseRules: [
    { eventType: 'SCORING_UPDATE', maxPerHour: 3, windowMinutes: 20 },
    { eventType: 'TRADE_PROPOSED', maxPerHour: 5, windowMinutes: 15 },
    { eventType: 'ANNOUNCEMENT', maxPerHour: 2, windowMinutes: 30 },
  ],
};

export function useRateLimits() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'config', 'rate-limits'],
    queryFn: async () => {
      try {
        return await adminApi.get<RateLimitConfig>('/v1/admin/config/rate-limits');
      } catch {
        return MOCK_RATE_LIMITS;
      }
    },
  });

  return { data: data ?? MOCK_RATE_LIMITS, isLoading };
}

// ── Poll Intervals ─────────────────────────────────────────────────────────────

export interface PollIntervalConfig {
  standings: number;
  draft: number;
  contestStatus: number;
  notifications: number;
  default: number;
}

const MOCK_POLL_INTERVALS: PollIntervalConfig = {
  standings: 10000,
  draft: 3000,
  contestStatus: 30000,
  notifications: 15000,
  default: 60000,
};

export function usePollIntervals() {
  return { data: MOCK_POLL_INTERVALS, isLoading: false };
}

// ── Ingestion Schedule ─────────────────────────────────────────────────────────

export interface SportOverride {
  sport: string;
  healthCheckMin: number;
  scheduleSyncHrs: number;
  participantSyncHrs: number;
  rankingSyncHrs: number;
  liveScorePollingSeconds: number;
}

export interface IngestionScheduleConfig {
  healthCheckMin: number;
  scheduleSyncHrs: number;
  participantSyncHrs: number;
  rankingSyncHrs: number;
  liveScorePollingSeconds: number;
  sportOverrides: SportOverride[];
}

const MOCK_INGESTION_SCHEDULE: IngestionScheduleConfig = {
  healthCheckMin: 5,
  scheduleSyncHrs: 6,
  participantSyncHrs: 12,
  rankingSyncHrs: 4,
  liveScorePollingSeconds: 30,
  sportOverrides: [
    { sport: Sport.NFL, healthCheckMin: 3, scheduleSyncHrs: 4, participantSyncHrs: 6, rankingSyncHrs: 2, liveScorePollingSeconds: 10 },
    { sport: Sport.NBA, healthCheckMin: 3, scheduleSyncHrs: 4, participantSyncHrs: 8, rankingSyncHrs: 3, liveScorePollingSeconds: 15 },
  ],
};

export function useIngestionSchedule() {
  return { data: MOCK_INGESTION_SCHEDULE, isLoading: false };
}

// ── Dunning Config ─────────────────────────────────────────────────────────────

export interface RetryAttempt {
  day: number;
  action: string;
}

export interface DunningConfig {
  retryAttempts: RetryAttempt[];
  gracePeriodDays: number;
  degradedPeriodDays: number;
  cancellationThresholdDays: number;
  notifyOnRetry: boolean;
  notifyOnGraceStart: boolean;
  notifyOnDegradation: boolean;
  notifyBeforeCancellation: boolean;
}

const MOCK_DUNNING_CONFIG: DunningConfig = {
  retryAttempts: [
    { day: 1, action: 'Retry payment' },
    { day: 3, action: 'Retry payment + email reminder' },
    { day: 5, action: 'Retry payment + push notification' },
    { day: 7, action: 'Final retry + urgent email' },
  ],
  gracePeriodDays: 7,
  degradedPeriodDays: 14,
  cancellationThresholdDays: 30,
  notifyOnRetry: true,
  notifyOnGraceStart: true,
  notifyOnDegradation: true,
  notifyBeforeCancellation: true,
};

export function useDunningConfig() {
  const data = useMemo(() => MOCK_DUNNING_CONFIG, []);
  return { data, isLoading: false };
}

// ── Retention Defaults ──────────────────────────────────────────────────────

export interface RetentionDefaultsConfig {
  contestResultRetentionSeasons: number;
  rosterHistoryRetentionSeasons: number;
  activityLogRetentionDays: number;
  payoutRecordRetentionSeasons: number;
  chatMessageRetentionDays: number;
  auditLogRetentionDays: number;
}

const MOCK_RETENTION_DEFAULTS: RetentionDefaultsConfig = {
  contestResultRetentionSeasons: -1,
  rosterHistoryRetentionSeasons: -1,
  activityLogRetentionDays: 365,
  payoutRecordRetentionSeasons: -1,
  chatMessageRetentionDays: 90,
  auditLogRetentionDays: -1,
};

export function useRetentionDefaults() {
  const data = useMemo(() => MOCK_RETENTION_DEFAULTS, []);
  return { data, isLoading: false };
}

// ── Digest Config ───────────────────────────────────────────────────────────

export type SendDay = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface DigestTemplateConfig {
  subjectTemplate: string;
  headerTemplate: string;
  footerTemplate: string;
  includeStandings: boolean;
  includeHighlights: boolean;
  includeUpcomingEvents: boolean;
  lookbackDays: number;
  sendDay: SendDay;
  sendHourUtc: number;
  enabled: boolean;
}

const MOCK_DIGEST_CONFIG: DigestTemplateConfig = {
  subjectTemplate: 'Weekly Recap — {{league_name}}',
  headerTemplate: "Here's what happened this week in {{league_name}}",
  footerTemplate: 'See you next week! — Ultimate Pool Manager',
  includeStandings: true,
  includeHighlights: true,
  includeUpcomingEvents: true,
  lookbackDays: 7,
  sendDay: 'MONDAY',
  sendHourUtc: 14,
  enabled: true,
};

export function useDigestConfig() {
  const data = useMemo(() => MOCK_DIGEST_CONFIG, []);
  return { data, isLoading: false };
}

const MOCK_DIGEST_PREVIEW = `Subject: Weekly Recap — Demo League

Here's what happened this week in Demo League

--- Standings ---
  NFL Pick'em Week 12:
    #1 The Underdogs — 87 pts
    #2 Gridiron Gurus — 82 pts
    #3 Sunday Funday — 79 pts

--- Highlights ---
  * The Underdogs clinched the weekly prize with 87 points
  * League record: 14 members submitted picks before the early deadline

--- Upcoming ---
  NFL Week 13 locks — Sunday 1:00 PM ET
  Trade deadline — Wednesday 11:59 PM ET

See you next week! — Ultimate Pool Manager`;

export function useDigestPreview() {
  return { data: MOCK_DIGEST_PREVIEW, isLoading: false };
}

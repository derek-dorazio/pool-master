import { useQuery } from '@tanstack/react-query';
import {
  client,
  adminListScoringTemplates,
  adminListSelectionTemplatesConfig,
  adminListPushTriggers,
  adminListNotificationTemplates,
  adminGetChannelConfig,
  adminGetRateLimitConfig,
  adminGetPollIntervals,
  adminGetIngestionSchedule,
  adminGetDunningConfig,
  adminGetRetentionDefaults,
  adminGetDigestConfig,
  adminPreviewDigest,
} from '@/lib/api';

// ── Scoring Templates ──────────────────────────────────────────────────────────

export interface ScoringTemplate {
  id: string;
  name: string;
  sport: string;
  type: string;
  description: string;
  lastModified: string;
}

export function useScoringTemplates() {
  return useQuery({
    queryKey: ['admin', 'config', 'scoring-templates'],
    queryFn: async () => {
      const { data } = await adminListScoringTemplates({ client });
      return data;
    },
  });
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

export function useSelectionTemplates() {
  return useQuery({
    queryKey: ['admin', 'config', 'selection-templates'],
    queryFn: async () => {
      const { data } = await adminListSelectionTemplatesConfig({ client });
      return data;
    },
  });
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

export function usePushTriggers() {
  return useQuery({
    queryKey: ['admin', 'config', 'push-triggers'],
    queryFn: async () => {
      const { data } = await adminListPushTriggers({ client });
      return data;
    },
  });
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

export function useNotificationTemplates() {
  return useQuery({
    queryKey: ['admin', 'config', 'notification-templates'],
    queryFn: async () => {
      const { data } = await adminListNotificationTemplates({ client });
      return data;
    },
  });
}

// ── Channel Defaults ───────────────────────────────────────────────────────────

export type Channel = 'push' | 'email' | 'sms' | 'in_app';
export type NotificationCategory = 'DRAFT' | 'SCORING' | 'CONTEST' | 'LEAGUE' | 'SOCIAL' | 'ACCOUNT';

export interface ChannelDefault {
  category: NotificationCategory;
  channels: Channel[];
}

export function useChannelDefaults() {
  return useQuery({
    queryKey: ['admin', 'config', 'channel-defaults'],
    queryFn: async () => {
      const { data } = await adminGetChannelConfig({ client });
      return data;
    },
  });
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

export function useRateLimits() {
  return useQuery({
    queryKey: ['admin', 'config', 'rate-limits'],
    queryFn: async () => {
      const { data } = await adminGetRateLimitConfig({ client });
      return data;
    },
  });
}

// ── Poll Intervals ─────────────────────────────────────────────────────────────

export interface PollIntervalConfig {
  standings: number;
  draft: number;
  contestStatus: number;
  notifications: number;
  default: number;
}

export function usePollIntervals() {
  return useQuery({
    queryKey: ['admin', 'config', 'poll-intervals'],
    queryFn: async () => {
      const { data } = await adminGetPollIntervals({ client });
      return data;
    },
  });
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

export function useIngestionSchedule() {
  return useQuery({
    queryKey: ['admin', 'config', 'ingestion-schedule'],
    queryFn: async () => {
      const { data } = await adminGetIngestionSchedule({ client });
      return data;
    },
  });
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

export function useDunningConfig() {
  return useQuery({
    queryKey: ['admin', 'config', 'dunning'],
    queryFn: async () => {
      const { data } = await adminGetDunningConfig({ client });
      return data;
    },
  });
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

export function useRetentionDefaults() {
  return useQuery({
    queryKey: ['admin', 'config', 'retention-defaults'],
    queryFn: async () => {
      const { data } = await adminGetRetentionDefaults({ client });
      return data;
    },
  });
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

export function useDigestConfig() {
  return useQuery({
    queryKey: ['admin', 'config', 'digest'],
    queryFn: async () => {
      const { data } = await adminGetDigestConfig({ client });
      return data;
    },
  });
}

export function useDigestPreview() {
  return useQuery({
    queryKey: ['admin', 'config', 'digest-preview'],
    queryFn: async () => {
      const { data } = await adminPreviewDigest({ client });
      return data;
    },
  });
}

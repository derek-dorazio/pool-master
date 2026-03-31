import { renderHook } from '@/test-utils';
import { waitFor } from '@testing-library/react';
import {
  useScoringTemplates,
  useSelectionTemplates,
  usePushTriggers,
  useNotificationTemplates,
  useChannelDefaults,
  useRateLimits,
  usePollIntervals,
  useIngestionSchedule,
  useDunningConfig,
  useRetentionDefaults,
  useDigestConfig,
  useDigestPreview,
} from './use-config-api';

describe('useScoringTemplates', () => {
  it('returns scoring templates array', async () => {
    const { result } = renderHook(() => useScoringTemplates());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data.length).toBeGreaterThan(0);
    const tmpl = result.current.data[0];
    expect(tmpl).toHaveProperty('id');
    expect(tmpl).toHaveProperty('name');
    expect(tmpl).toHaveProperty('sport');
    expect(tmpl).toHaveProperty('type');
  });
});

describe('useSelectionTemplates', () => {
  it('returns selection templates array', async () => {
    const { result } = renderHook(() => useSelectionTemplates());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data.length).toBeGreaterThan(0);
    const tmpl = result.current.data[0];
    expect(tmpl).toHaveProperty('id');
    expect(tmpl).toHaveProperty('name');
    expect(tmpl).toHaveProperty('sport');
    expect(tmpl).toHaveProperty('type');
  });
});

describe('usePushTriggers', () => {
  it('returns push triggers with expected fields', async () => {
    const { result } = renderHook(() => usePushTriggers());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data.length).toBeGreaterThan(0);
    const trigger = result.current.data[0];
    expect(trigger).toHaveProperty('id');
    expect(trigger).toHaveProperty('eventType');
    expect(trigger).toHaveProperty('title');
    expect(trigger).toHaveProperty('priority');
    expect(trigger).toHaveProperty('enabled');
  });
});

describe('useNotificationTemplates', () => {
  it('returns templates covering push, email, and in-app channels', async () => {
    const { result } = renderHook(() => useNotificationTemplates());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data.length).toBeGreaterThan(0);
    const tmpl = result.current.data[0];
    expect(tmpl).toHaveProperty('pushTitle');
    expect(tmpl).toHaveProperty('emailSubject');
    expect(tmpl).toHaveProperty('inAppTitle');
  });
});

describe('useChannelDefaults', () => {
  it('returns channel defaults per category', async () => {
    const { result } = renderHook(() => useChannelDefaults());

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(result.current.data.length).toBeGreaterThan(0);
    const def = result.current.data[0];
    expect(def).toHaveProperty('category');
    expect(def).toHaveProperty('channels');
    expect(Array.isArray(def.channels)).toBe(true);
  });
});

describe('useRateLimits', () => {
  it('returns rate limit config with collapse rules', async () => {
    const { result } = renderHook(() => useRateLimits());

    await waitFor(() => expect(result.current.data).toBeDefined());

    const data = result.current.data;
    expect(data).toHaveProperty('pushPerHour');
    expect(data).toHaveProperty('emailPerDay');
    expect(data).toHaveProperty('smsPerDay');
    expect(data).toHaveProperty('dedupWindowSeconds');
    expect(data.collapseRules).toBeInstanceOf(Array);
    expect(data.collapseRules.length).toBeGreaterThan(0);
  });
});

describe('usePollIntervals', () => {
  it('returns poll interval values', () => {
    const { result } = renderHook(() => usePollIntervals());

    const data = result.current.data;
    expect(data.standings).toBe(10000);
    expect(data.draft).toBe(3000);
    expect(data.contestStatus).toBe(30000);
    expect(data.notifications).toBe(15000);
    expect(data.default).toBe(60000);
  });
});

describe('useIngestionSchedule', () => {
  it('returns global schedule and sport overrides', () => {
    const { result } = renderHook(() => useIngestionSchedule());

    const data = result.current.data;
    expect(data.healthCheckMin).toBe(5);
    expect(data.liveScorePollingSeconds).toBe(30);
    expect(data.sportOverrides).toBeInstanceOf(Array);
    expect(data.sportOverrides.length).toBeGreaterThan(0);
    expect(data.sportOverrides[0]).toHaveProperty('sport');
  });
});

describe('useDunningConfig', () => {
  it('returns dunning retry attempts and thresholds', () => {
    const { result } = renderHook(() => useDunningConfig());

    const data = result.current.data;
    expect(data.retryAttempts).toBeInstanceOf(Array);
    expect(data.retryAttempts.length).toBeGreaterThan(0);
    expect(data.gracePeriodDays).toBe(7);
    expect(data.cancellationThresholdDays).toBe(30);
    expect(data.notifyOnRetry).toBe(true);
  });
});

describe('useRetentionDefaults', () => {
  it('returns retention periods', () => {
    const { result } = renderHook(() => useRetentionDefaults());

    const data = result.current.data;
    expect(data.contestResultRetentionSeasons).toBe(-1);
    expect(data.activityLogRetentionDays).toBe(365);
    expect(data.chatMessageRetentionDays).toBe(90);
    expect(data.auditLogRetentionDays).toBe(-1);
  });
});

describe('useDigestConfig', () => {
  it('returns digest template configuration', () => {
    const { result } = renderHook(() => useDigestConfig());

    const data = result.current.data;
    expect(data.subjectTemplate).toContain('{{league_name}}');
    expect(data.sendDay).toBe('MONDAY');
    expect(data.sendHourUtc).toBe(14);
    expect(data.enabled).toBe(true);
    expect(data.lookbackDays).toBe(7);
  });
});

describe('useDigestPreview', () => {
  it('returns preview string with standings and highlights', () => {
    const { result } = renderHook(() => useDigestPreview());

    const preview = result.current.data;
    expect(typeof preview).toBe('string');
    expect(preview).toContain('Standings');
    expect(preview).toContain('Highlights');
    expect(preview).toContain('Upcoming');
  });
});

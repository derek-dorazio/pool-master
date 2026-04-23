import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminGetIngestionSchedule,
  adminGetPollIntervals,
  adminPrepareSportSync,
  adminListContestConfigTemplates,
  adminListProviderSyncRuns,
  adminListProviders,
  adminResetIngestionSchedule,
  adminResetPollIntervals,
  adminResetSportIngestionOverride,
  adminSetSportIngestionOverride,
  adminSyncProviderEventData,
  adminUpdateContestConfigTemplate,
  adminUpdateIngestionSchedule,
  adminUpdatePollIntervals,
  type AdminGetIngestionScheduleResponses,
  type AdminGetPollIntervalsResponses,
  type AdminPrepareSportSyncResponses,
  type AdminListContestConfigTemplatesResponses,
  type AdminListProviderSyncRunsResponses,
  type AdminListProvidersResponses,
  type AdminUpdateContestConfigTemplateResponses,
  type AdminSyncProviderEventDataResponses,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';

type PollIntervalConfig = AdminGetPollIntervalsResponses[200];
type IngestionScheduleConfig = AdminGetIngestionScheduleResponses[200];
type ContestConfigTemplate = AdminListContestConfigTemplatesResponses[200]['templates'][number];
type ProviderSyncRun = AdminListProviderSyncRunsResponses[200]['items'][number];
type ProviderSummary = AdminListProvidersResponses[200]['items'][number];
type SportSyncPreparation = AdminPrepareSportSyncResponses[200];
type EventSyncResult = AdminSyncProviderEventDataResponses[200];
type ContestConfigTemplateUpdateResult = AdminUpdateContestConfigTemplateResponses[200]['template'];

const ALL_SYNC_SPORT_OPTIONS = [
  'GOLF',
  'NFL',
  'NBA',
  'F1',
  'NASCAR',
  'NCAA_BASKETBALL',
  'NCAA_HOCKEY',
  'NCAA_FOOTBALL',
  'TENNIS',
  'HORSE_RACING',
  'SOCCER',
  'NHL',
  'MLB',
  'UFC',
] as const;
type SyncSport = (typeof ALL_SYNC_SPORT_OPTIONS)[number];

const SYNC_STATUS_OPTIONS = ['RUNNING', 'COMPLETED', 'FAILED'] as const;

const SPORT_SYNC_PRESETS = [
  {
    id: 'PREPARE_EVENT_DATA',
    label: 'Prepare event data',
    feeds: ['EVENTSCHEDULE', 'EVENTPARTICIPANTS', 'PARTICIPANTRANKINGS'] as const,
  },
  {
    id: 'EVENTPARTICIPANTS_ONLY',
    label: 'Refresh participants only',
    feeds: ['EVENTPARTICIPANTS'] as const,
  },
  {
    id: 'EVENTSCHEDULE_ONLY',
    label: 'Refresh schedule only',
    feeds: ['EVENTSCHEDULE'] as const,
  },
  {
    id: 'PARTICIPANTRANKINGS_ONLY',
    label: 'Refresh rankings only',
    feeds: ['PARTICIPANTRANKINGS'] as const,
  },
] as const;
type SportSyncPresetId = (typeof SPORT_SYNC_PRESETS)[number]['id'];

const EVENT_SYNC_PRESETS = [
  {
    id: 'EVENTPARTICIPANTS',
    label: 'Refresh event participants',
    feeds: ['EVENTPARTICIPANTS'] as const,
  },
  {
    id: 'EVENTLIVESCORES',
    label: 'Refresh live scores',
    feeds: ['EVENTLIVESCORES'] as const,
  },
  {
    id: 'EVENTRESULTS',
    label: 'Refresh final results',
    feeds: ['EVENTRESULTS'] as const,
  },
] as const;
type EventSyncPresetId = (typeof EVENT_SYNC_PRESETS)[number]['id'];

const INGESTION_POLICY_FIELDS = [
  {
    key: 'healthCheck',
    label: 'Health checks',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
  {
    key: 'eventSchedule',
    label: 'Event schedule',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
    extraKey: 'lookaheadDays',
    extraLabel: 'Lookahead days',
  },
  {
    key: 'eventParticipants',
    label: 'Event participants',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
    extraKey: 'leadDaysBeforeStart',
    extraLabel: 'Lead days',
  },
  {
    key: 'participantRankings',
    label: 'Participant rankings',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
  {
    key: 'eventLiveScores',
    label: 'Event live scores',
    intervalLabel: 'Seconds',
    intervalKey: 'intervalSeconds',
  },
  {
    key: 'eventResults',
    label: 'Event results',
    intervalLabel: 'Minutes',
    intervalKey: 'intervalMinutes',
  },
] as const;
type IngestionPolicyField = (typeof INGESTION_POLICY_FIELDS)[number];
type IngestionPolicyKey = IngestionPolicyField['key'];

function extractErrorMessage(error: unknown, fallback = 'We could not load this admin data right now.') {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

function formatDateTimeDisplay(isoString: string | null | undefined) {
  if (!isoString) {
    return 'Unavailable';
  }

  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    return 'Unavailable';
  }

  return new Date(parsed).toLocaleString();
}

function formatEventValue(eventId: string | null | undefined) {
  if (!eventId || eventId.trim().length === 0) {
    return 'No event';
  }

  return eventId;
}

function getProviderName(
  providerId: string,
  providers: ProviderSummary[] | undefined,
) {
  return providers?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
}

function buildPayloadSummary(payload: Record<string, unknown>) {
  const primaryTextFields = ['detail', 'message', 'summary', 'runType'] as const;
  for (const key of primaryTextFields) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const metricPairs: Array<[string, string]> = [
    ['recordsProcessed', 'processed'],
    ['eventCount', 'events'],
    ['participantCount', 'participants'],
    ['errorCount', 'errors'],
    ['errors', 'errors'],
  ];

  const metrics = metricPairs.flatMap(([key, label]) => {
    const value = payload[key];
    if (typeof value === 'number') {
      return [`${value} ${label}`];
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return [`${label}: ${value}`];
    }

    return [];
  });

  if (metrics.length > 0) {
    return metrics.slice(0, 3).join(' · ');
  }

  const fallbackEntries = Object.entries(payload).flatMap(([key, value]) => {
    if (
      value === null
      || value === undefined
      || typeof value === 'object'
      || key.endsWith('At')
      || key === 'providerId'
      || key === 'eventId'
      || key === 'status'
    ) {
      return [];
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [`${key}: ${String(value)}`];
    }

    return [];
  });

  return fallbackEntries[0] ?? 'Payload captured for operational review.';
}

function getStatusClasses(status: ProviderSyncRun['status'] | ProviderSummary['status']) {
  switch (status) {
    case 'COMPLETED':
    case 'HEALTHY':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900';
    case 'RUNNING':
      return 'border-sky-300 bg-sky-50 text-sky-900';
    case 'FAILED':
    case 'DOWN':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case 'DEGRADED':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    default:
      return 'border-border bg-background text-foreground';
  }
}

function getSportSyncPreset(presetId: SportSyncPresetId) {
  return SPORT_SYNC_PRESETS.find((preset) => preset.id === presetId) ?? SPORT_SYNC_PRESETS[0];
}

function getEventSyncPreset(presetId: EventSyncPresetId) {
  return EVENT_SYNC_PRESETS.find((preset) => preset.id === presetId) ?? EVENT_SYNC_PRESETS[0];
}

function buildJobSummary(jobs: Array<{ status: string }>) {
  const failedJobs = jobs.filter((job) => job.status === 'FAILED').length;
  if (failedJobs > 0) {
    return `${jobs.length} feed jobs finished with ${failedJobs} failure${failedJobs === 1 ? '' : 's'}.`;
  }

  return `${jobs.length} feed job${jobs.length === 1 ? '' : 's'} completed.`;
}

function clonePollConfig(config: PollIntervalConfig): PollIntervalConfig {
  return { ...config };
}

function cloneIngestionConfig(
  config: IngestionScheduleConfig,
): IngestionScheduleConfig {
  return {
    ...config,
    healthCheck: { ...config.healthCheck },
    eventSchedule: { ...config.eventSchedule },
    eventParticipants: { ...config.eventParticipants },
    participantRankings: { ...config.participantRankings },
    eventLiveScores: { ...config.eventLiveScores },
    eventResults: { ...config.eventResults },
    perSportOverrides: Object.fromEntries(
      Object.entries(config.perSportOverrides ?? {}).map(([sport, override]) => [
        sport,
        {
          ...(override.healthCheck && { healthCheck: { ...override.healthCheck } }),
          ...(override.eventSchedule && { eventSchedule: { ...override.eventSchedule } }),
          ...(override.eventParticipants && { eventParticipants: { ...override.eventParticipants } }),
          ...(override.participantRankings && { participantRankings: { ...override.participantRankings } }),
          ...(override.eventLiveScores && { eventLiveScores: { ...override.eventLiveScores } }),
          ...(override.eventResults && { eventResults: { ...override.eventResults } }),
        },
      ]),
    ),
  };
}

function cloneContestTemplate(template: ContestConfigTemplate): ContestConfigTemplate {
  return {
    ...template,
    configuration: JSON.parse(JSON.stringify(template.configuration)) as ContestConfigTemplate['configuration'],
  };
}

function buildSportOverrideDraft(
  config: IngestionScheduleConfig,
  sport: SyncSport,
): Record<IngestionPolicyKey, boolean> {
  const override = config.perSportOverrides[sport];

  return Object.fromEntries(
    INGESTION_POLICY_FIELDS.map((field) => [
      field.key,
      override?.[field.key]?.enabled ?? config[field.key].enabled,
    ]),
  ) as Record<IngestionPolicyKey, boolean>;
}

function toPositiveNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

function buildTierLabel(index: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < alphabet.length) {
    return `Tier ${alphabet[index]}`;
  }
  return `Tier ${index + 1}`;
}

function buildTierDefinitions(tierCount: number, picksPerTier: number, tierSize: number) {
  return Array.from({ length: tierCount }, (_, index) => {
    const startPosition = index * tierSize + 1;
    const endPosition = startPosition + tierSize - 1;

    return {
      tierKey: index < 26 ? String.fromCharCode(65 + index) : `T${index + 1}`,
      label: buildTierLabel(index),
      pickCount: picksPerTier,
      startPosition,
      endPosition,
    };
  });
}

function getTierCount(template: ContestConfigTemplate) {
  if (template.configuration.mode !== 'GOLF_TIERED') {
    return 0;
  }

  return template.configuration.tiers.length;
}

function getPicksPerTier(template: ContestConfigTemplate) {
  if (template.configuration.mode !== 'GOLF_TIERED') {
    return 0;
  }

  return template.configuration.tiers[0]?.pickCount ?? 1;
}

export function RootAdminPage() {
  const logger = useLogger().child({
    feature: 'root-admin-page',
  });
  const queryClient = useQueryClient();
  const [providerFilter, setProviderFilter] = useState('ALL');
  const [sportFilter, setSportFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sportSyncSport, setSportSyncSport] = useState<SyncSport>('GOLF');
  const [sportSyncPresetId, setSportSyncPresetId] = useState<SportSyncPresetId>('PREPARE_EVENT_DATA');
  const [eventSyncSport, setEventSyncSport] = useState<SyncSport>('GOLF');
  const [eventSyncPresetId, setEventSyncPresetId] = useState<EventSyncPresetId>('EVENTLIVESCORES');
  const [eventSyncEventId, setEventSyncEventId] = useState('');
  const [overrideSport, setOverrideSport] = useState<SyncSport>('GOLF');
  const [pollDraft, setPollDraft] = useState<PollIntervalConfig | null>(null);
  const [ingestionDraft, setIngestionDraft] = useState<IngestionScheduleConfig | null>(null);
  const [sportOverrideDraft, setSportOverrideDraft] = useState<Record<IngestionPolicyKey, boolean> | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, ContestConfigTemplate>>({});

  const pollConfigQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'poll-config'],
    queryFn: async (): Promise<PollIntervalConfig> => {
      const response = await adminGetPollIntervals();
      if (!response.data) {
        throw response.error ?? new Error('Poll interval response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });

  const ingestionConfigQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'ingestion-config'],
    queryFn: async (): Promise<IngestionScheduleConfig> => {
      const response = await adminGetIngestionSchedule();
      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });

  const contestTemplatesQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'contest-config-templates'],
    queryFn: async (): Promise<ContestConfigTemplate[]> => {
      const response = await adminListContestConfigTemplates();
      if (!response.data?.templates) {
        throw response.error ?? new Error('Contest template response is missing data.');
      }
      return response.data.templates;
    },
    retry: false,
  });

  const providersQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'providers'],
    queryFn: async (): Promise<ProviderSummary[]> => {
      const response = await adminListProviders();
      if (!response.data?.items) {
        throw response.error ?? new Error('Provider list response is missing data.');
      }
      return response.data.items;
    },
    retry: false,
  });

  const syncRunsQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs', providerFilter, sportFilter, statusFilter],
    queryFn: async (): Promise<ProviderSyncRun[]> => {
      const response = await adminListProviderSyncRuns({
        query: {
          providerId: providerFilter === 'ALL' ? undefined : providerFilter,
          sport: sportFilter === 'ALL'
            ? undefined
            : sportFilter as SyncSport,
          status: statusFilter === 'ALL'
            ? undefined
            : statusFilter as (typeof SYNC_STATUS_OPTIONS)[number],
          limit: 25,
        },
      });

      if (!response.data?.items) {
        throw response.error ?? new Error('Provider sync run response is missing data.');
      }

      return response.data.items;
    },
    retry: false,
  });

  const recentRuns = syncRunsQuery.data ?? [];
  const providerOptions = useMemo(() => {
    const providerIdsFromRuns = recentRuns.map((run) => run.providerId);
    const providerIdsFromHealth = (providersQuery.data ?? []).map((provider) => provider.providerId);
    return Array.from(new Set([...providerIdsFromHealth, ...providerIdsFromRuns])).sort();
  }, [providersQuery.data, recentRuns]);

  const supportedSyncSports = useMemo(() => {
    const configuredSports = Array.from(new Set(
      (providersQuery.data ?? []).flatMap((provider) => provider.sportsCovered),
    )).filter((sport): sport is SyncSport => ALL_SYNC_SPORT_OPTIONS.includes(sport as SyncSport));

    if (configuredSports.length === 0) {
      return [...ALL_SYNC_SPORT_OPTIONS];
    }

    return ALL_SYNC_SPORT_OPTIONS.filter((sport) => configuredSports.includes(sport));
  }, [providersQuery.data]);

  const summary = useMemo(() => {
    const running = recentRuns.filter((run) => run.status === 'RUNNING').length;
    const failed = recentRuns.filter((run) => run.status === 'FAILED').length;
    const completed = recentRuns.filter((run) => run.status === 'COMPLETED').length;
    return {
      running,
      failed,
      completed,
      lastStartedAt: recentRuns[0]?.startedAt ?? recentRuns[0]?.createdAt ?? null,
    };
  }, [recentRuns]);

  const orderedContestTemplates = useMemo(
    () => Object.values(templateDrafts).sort((left, right) => left.sortOrder - right.sortOrder),
    [templateDrafts],
  );

  const pollConfigMutation = useMutation({
    mutationFn: async (draft: PollIntervalConfig) => {
      const response = await adminUpdatePollIntervals({
        body: draft,
      });

      if (!response.data) {
        throw response.error ?? new Error('Poll interval update response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      setPollDraft(clonePollConfig(data));
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'poll-config'] });
    },
  });

  const resetPollConfigMutation = useMutation({
    mutationFn: async () => {
      const response = await adminResetPollIntervals();
      if (!response.data) {
        throw response.error ?? new Error('Poll interval reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: async (data) => {
      setPollDraft(clonePollConfig(data));
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'poll-config'] });
    },
  });

  const ingestionConfigMutation = useMutation({
    mutationFn: async (draft: IngestionScheduleConfig) => {
      const response = await adminUpdateIngestionSchedule({
        body: {
          healthCheck: draft.healthCheck,
          eventSchedule: draft.eventSchedule,
          eventParticipants: draft.eventParticipants,
          participantRankings: draft.participantRankings,
          eventLiveScores: draft.eventLiveScores,
          eventResults: draft.eventResults,
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule update response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      setIngestionDraft(cloneIngestionConfig(data));
      setSportOverrideDraft(buildSportOverrideDraft(data, overrideSport));
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'ingestion-config'] });
    },
  });

  const resetIngestionConfigMutation = useMutation({
    mutationFn: async () => {
      const response = await adminResetIngestionSchedule();
      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: async (data) => {
      setIngestionDraft(cloneIngestionConfig(data));
      setSportOverrideDraft(buildSportOverrideDraft(data, overrideSport));
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'ingestion-config'] });
    },
  });

  const sportOverrideMutation = useMutation({
    mutationFn: async (input: { sport: SyncSport; draft: Record<IngestionPolicyKey, boolean> }) => {
      const response = await adminSetSportIngestionOverride({
        path: { sport: input.sport },
        body: {
          healthCheck: { enabled: input.draft.healthCheck },
          eventSchedule: { enabled: input.draft.eventSchedule },
          eventParticipants: { enabled: input.draft.eventParticipants },
          participantRankings: { enabled: input.draft.participantRankings },
          eventLiveScores: { enabled: input.draft.eventLiveScores },
          eventResults: { enabled: input.draft.eventResults },
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport override update response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      setIngestionDraft(cloneIngestionConfig(data));
      setSportOverrideDraft(buildSportOverrideDraft(data, overrideSport));
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'ingestion-config'] });
    },
  });

  const resetSportOverrideMutation = useMutation({
    mutationFn: async (sport: SyncSport) => {
      const response = await adminResetSportIngestionOverride({
        path: { sport },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport override reset response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      setIngestionDraft(cloneIngestionConfig(data));
      setSportOverrideDraft(buildSportOverrideDraft(data, overrideSport));
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'ingestion-config'] });
    },
  });

  const contestTemplateMutation = useMutation({
    mutationFn: async (input: {
      templateId: string;
      draft: ContestConfigTemplate;
    }): Promise<ContestConfigTemplateUpdateResult> => {
      const response = await adminUpdateContestConfigTemplate({
        path: { templateId: input.templateId },
        body: {
          name: input.draft.name,
          description: input.draft.description,
          sortOrder: input.draft.sortOrder,
          active: input.draft.active,
          isDefault: input.draft.isDefault,
          configuration: input.draft.configuration,
        },
      });

      if (!response.data?.template) {
        throw response.error ?? new Error('Contest template update response is missing data.');
      }

      return response.data.template;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'contest-config-templates'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      presetId: SportSyncPresetId;
    }): Promise<SportSyncPreparation> => {
      const preset = getSportSyncPreset(input.presetId);
      const response = await adminPrepareSportSync({
        path: { sport: input.sport },
        body: {
          feeds: [...preset.feeds],
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport sync response is missing the preparation payload.');
      }

      return response.data;
    },
    onMutate: (input) => {
      const preset = getSportSyncPreset(input.presetId);
      logger.debug(
        {
          action: 'rootAdmin.sync.started',
          data: {
            sport: input.sport,
            requestedFeeds: preset.feeds,
          },
        },
        'Starting manual provider sync preparation',
      );
    },
    onSuccess: async (preparation) => {
      logger.info(
        {
          action: 'rootAdmin.sync.succeeded',
          data: {
            sport: preparation.sport,
            requestedFeeds: preparation.requestedFeeds,
            jobCount: preparation.jobs.length,
          },
        },
        'Completed manual provider sport sync',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'providers'] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs'] }),
      ]);
    },
    onError: (error) => {
      if (error instanceof Error) {
        logger.error(
          {
            action: 'rootAdmin.sync.failed',
            data: {
              sport: sportSyncSport,
            },
            err: error,
          },
          'Manual provider sync preparation failed unexpectedly',
        );
        return;
      }

      logger.warn(
        {
          action: 'rootAdmin.sync.failed',
          data: {
            sport: sportSyncSport,
          },
        },
        'Manual provider sync preparation failed',
      );
    },
  });

  const eventSyncMutation = useMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      eventId: string;
      presetId: EventSyncPresetId;
    }): Promise<EventSyncResult> => {
      const preset = getEventSyncPreset(input.presetId);
      const response = await adminSyncProviderEventData({
        path: {
          sport: input.sport,
          eventId: input.eventId,
        },
        body: {
          feeds: [...preset.feeds],
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Event sync response is missing the result payload.');
      }

      return response.data;
    },
    onMutate: (input) => {
      const preset = getEventSyncPreset(input.presetId);
      logger.debug(
        {
          action: 'rootAdmin.eventSync.started',
          data: {
            sport: input.sport,
            eventId: input.eventId,
            requestedFeeds: preset.feeds,
          },
        },
        'Starting manual provider event sync',
      );
    },
    onSuccess: async (result) => {
      logger.info(
        {
          action: 'rootAdmin.eventSync.succeeded',
          data: {
            sport: result.sport,
            eventId: result.eventId,
            requestedFeeds: result.requestedFeeds,
            jobCount: result.jobs.length,
          },
        },
        'Completed manual provider event sync',
      );
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs'] });
    },
    onError: (error) => {
      if (error instanceof Error) {
        logger.error(
          {
            action: 'rootAdmin.eventSync.failed',
            data: {
              sport: eventSyncSport,
              eventId: eventSyncEventId.trim(),
            },
            err: error,
          },
          'Manual provider event sync failed unexpectedly',
        );
        return;
      }

      logger.warn(
        {
          action: 'rootAdmin.eventSync.failed',
          data: {
            sport: eventSyncSport,
            eventId: eventSyncEventId.trim(),
          },
        },
        'Manual provider event sync failed',
      );
    },
  });

  useEffect(() => {
    if (!supportedSyncSports.includes(sportSyncSport)) {
      const fallbackSport = supportedSyncSports[0];
      if (fallbackSport) {
        setSportSyncSport(fallbackSport);
      }
    }

    if (!supportedSyncSports.includes(eventSyncSport)) {
      const fallbackSport = supportedSyncSports[0];
      if (fallbackSport) {
        setEventSyncSport(fallbackSport);
      }
    }

    if (!supportedSyncSports.includes(overrideSport)) {
      const fallbackSport = supportedSyncSports[0];
      if (fallbackSport) {
        setOverrideSport(fallbackSport);
      }
    }
  }, [eventSyncSport, overrideSport, sportSyncSport, supportedSyncSports]);

  useEffect(() => {
    if (!pollConfigQuery.data) {
      return;
    }

    setPollDraft(clonePollConfig(pollConfigQuery.data));
  }, [pollConfigQuery.data]);

  useEffect(() => {
    if (!ingestionConfigQuery.data) {
      return;
    }

    setIngestionDraft(cloneIngestionConfig(ingestionConfigQuery.data));
    setSportOverrideDraft(buildSportOverrideDraft(ingestionConfigQuery.data, overrideSport));
  }, [ingestionConfigQuery.data, overrideSport]);

  useEffect(() => {
    if (!contestTemplatesQuery.data) {
      return;
    }

    setTemplateDrafts(
      Object.fromEntries(
        contestTemplatesQuery.data.map((template) => [template.id, cloneContestTemplate(template)]),
      ),
    );
  }, [contestTemplatesQuery.data]);

  useEffect(() => {
    if (!providersQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.providers.failed',
        err: providersQuery.error instanceof Error ? providersQuery.error : undefined,
      },
      'Provider health summary failed to load',
    );
  }, [logger, providersQuery.error, providersQuery.isError]);

  useEffect(() => {
    if (!syncRunsQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.syncRuns.failed',
        err: syncRunsQuery.error instanceof Error ? syncRunsQuery.error : undefined,
      },
      'Provider sync runs failed to load',
    );
  }, [logger, syncRunsQuery.error, syncRunsQuery.isError]);

  useEffect(() => {
    if (!pollConfigQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.pollConfig.failed',
        err: pollConfigQuery.error instanceof Error ? pollConfigQuery.error : undefined,
      },
      'Poll interval configuration failed to load',
    );
  }, [logger, pollConfigQuery.error, pollConfigQuery.isError]);

  useEffect(() => {
    if (!ingestionConfigQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.ingestionConfig.failed',
        err: ingestionConfigQuery.error instanceof Error ? ingestionConfigQuery.error : undefined,
      },
      'Ingestion schedule configuration failed to load',
    );
  }, [ingestionConfigQuery.error, ingestionConfigQuery.isError, logger]);

  useEffect(() => {
    if (!contestTemplatesQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.contestTemplates.failed',
        err: contestTemplatesQuery.error instanceof Error ? contestTemplatesQuery.error : undefined,
      },
      'Contest template configuration failed to load',
    );
  }, [contestTemplatesQuery.error, contestTemplatesQuery.isError, logger]);

  useEffect(() => {
    if (!providersQuery.data || !syncRunsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'rootAdmin.page.loaded',
        data: {
          providerCount: providersQuery.data.length,
          syncRunCount: syncRunsQuery.data.length,
        },
      },
      'Loaded root-admin sync visibility page',
    );
  }, [logger, providersQuery.data, syncRunsQuery.data]);

  function updatePollDraft(
    key: keyof PollIntervalConfig,
    value: string,
  ) {
    setPollDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [key]: toPositiveNumber(value),
      };
    });
  }

  function updateIngestionDraft(
    key: IngestionPolicyKey,
    field: 'enabled' | 'intervalMinutes' | 'intervalSeconds' | 'lookaheadDays' | 'leadDaysBeforeStart',
    value: boolean | string,
  ) {
    setIngestionDraft((current) => {
      if (!current) {
        return current;
      }

      const currentPolicy = current[key];
      const nextValue = typeof value === 'boolean' ? value : toPositiveNumber(value);

      return {
        ...current,
        [key]: {
          ...currentPolicy,
          [field]: nextValue,
        },
      };
    });
  }

  function updateTemplateDraft(
    templateId: string,
    updater: (current: ContestConfigTemplate) => ContestConfigTemplate,
  ) {
    setTemplateDrafts((current) => {
      const draft = current[templateId];
      if (!draft) {
        return current;
      }

      return {
        ...current,
        [templateId]: updater(draft),
      };
    });
  }

  function updateTieredTemplateConfiguration(
    templateId: string,
    updates: {
      tierCount?: number;
      picksPerTier?: number;
      countedScores?: number;
      tierSize?: number;
      cutScore?: number;
    },
  ) {
    updateTemplateDraft(templateId, (current) => {
      if (current.configuration.mode !== 'GOLF_TIERED') {
        return current;
      }

      const tierCount = updates.tierCount ?? getTierCount(current);
      const picksPerTier = updates.picksPerTier ?? getPicksPerTier(current);
      const tierSize = updates.tierSize ?? current.configuration.tierGeneration.defaultTierSize;
      const countedScores = updates.countedScores ?? current.configuration.countedScores;
      const cutScore = updates.cutScore ?? current.configuration.cutRule.fixedScore;

      return {
        ...current,
        configuration: {
          ...current.configuration,
          rosterSize: tierCount * picksPerTier,
          countedScores,
          tierGeneration: {
            ...current.configuration.tierGeneration,
            defaultTierSize: tierSize,
          },
          tiers: buildTierDefinitions(tierCount, picksPerTier, tierSize),
          cutRule: {
            ...current.configuration.cutRule,
            fixedScore: cutScore,
          },
        },
      };
    });
  }

  return (
    <div className="space-y-6" data-testid="root-admin-page">
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Root Admin
        </span>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">Provider sync visibility</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Thin operational visibility into provider sync activity. Root admins can manually start a sport sync
              when imported event or participant data has not loaded yet, then review the resulting sync history below.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Provider</span>
              <select
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                data-testid="root-admin-provider-filter"
                onChange={(event) => setProviderFilter(event.target.value)}
                value={providerFilter}
              >
                <option value="ALL">All providers</option>
                {providerOptions.map((providerId) => (
                  <option key={providerId} value={providerId}>
                    {getProviderName(providerId, providersQuery.data)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Sport</span>
              <select
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                data-testid="root-admin-sport-filter"
                onChange={(event) => setSportFilter(event.target.value)}
                value={sportFilter}
              >
                <option value="ALL">All sports</option>
                {ALL_SYNC_SPORT_OPTIONS.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Status</span>
              <select
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                data-testid="root-admin-status-filter"
                onChange={(event) => setStatusFilter(event.target.value)}
                value={statusFilter}
              >
                <option value="ALL">All statuses</option>
                {SYNC_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Recent runs</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{recentRuns.length}</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Completed</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.completed}</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Running</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.running}</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Latest start</p>
            <p className="mt-2 text-sm font-medium text-foreground">{formatDateTimeDisplay(summary.lastStartedAt)}</p>
          </div>
        </div>

        {providersQuery.data && providersQuery.data.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {providersQuery.data.map((provider) => (
              <div
                className="rounded-full border border-border bg-background px-4 py-2 text-xs text-muted-foreground"
                key={provider.providerId}
              >
                <span className="font-medium text-foreground">{provider.providerName}</span>
                <span className={`ml-2 inline-flex rounded-full border px-2 py-0.5 ${getStatusClasses(provider.status)}`}>
                  {provider.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {providersQuery.isError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Provider health context is temporarily unavailable, but sync runs are still shown below.
          </p>
        ) : null}
      </section>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">System configuration</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Durable platform settings for client polling and automated ingestion behavior.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Poll intervals</p>
                <p className="mt-1 text-sm text-muted-foreground">Client-facing refresh guidance, stored durably in runtime config.</p>
              </div>
              <button
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground"
                disabled={resetPollConfigMutation.isPending}
                onClick={() => resetPollConfigMutation.mutate()}
                type="button"
              >
                Reset
              </button>
            </div>

            {pollConfigQuery.isLoading || !pollDraft ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading poll interval configuration...</p>
            ) : pollConfigQuery.isError ? (
              <p className="mt-4 text-sm text-rose-700">
                {extractErrorMessage(pollConfigQuery.error, 'We could not load poll interval configuration right now.')}
              </p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {([
                    ['standings', 'Standings'],
                    ['draft', 'Draft'],
                    ['contestStatus', 'Contest status'],
                    ['notifications', 'Notifications'],
                    ['default', 'Default'],
                  ] as const).map(([key, label]) => (
                    <label className="text-sm text-muted-foreground" key={key}>
                      <span className="mb-2 block font-medium text-foreground">{label}</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                        data-testid={`root-admin-poll-${key}`}
                        onChange={(event) => updatePollDraft(key, event.target.value)}
                        type="number"
                        value={pollDraft[key]}
                      />
                    </label>
                  ))}
                </div>
                <button
                  className="mt-4 rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="root-admin-poll-save"
                  disabled={pollConfigMutation.isPending}
                  onClick={() => pollDraft && pollConfigMutation.mutate(pollDraft)}
                  type="button"
                >
                  {pollConfigMutation.isPending ? 'Saving...' : 'Save poll intervals'}
                </button>
              </>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sport overrides</p>
                <p className="mt-1 text-sm text-muted-foreground">Enable or disable automated feeds per sport without changing the global cadence.</p>
              </div>
              <button
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground"
                disabled={resetSportOverrideMutation.isPending}
                onClick={() => resetSportOverrideMutation.mutate(overrideSport)}
                type="button"
              >
                Reset sport
              </button>
            </div>

            <label className="mt-4 block text-sm text-muted-foreground">
              <span className="mb-2 block font-medium text-foreground">Sport</span>
              <select
                className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                data-testid="root-admin-ingestion-override-sport"
                onChange={(event) => setOverrideSport(event.target.value as SyncSport)}
                value={overrideSport}
              >
                {ALL_SYNC_SPORT_OPTIONS.map((sport) => (
                  <option key={sport} value={sport}>
                    {sport}
                  </option>
                ))}
              </select>
            </label>

            {ingestionConfigQuery.isLoading || !sportOverrideDraft || !ingestionDraft ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading sport override configuration...</p>
            ) : ingestionConfigQuery.isError ? (
              <p className="mt-4 text-sm text-rose-700">
                {extractErrorMessage(ingestionConfigQuery.error, 'We could not load ingestion schedule configuration right now.')}
              </p>
            ) : (
              <>
                <div className="mt-4 space-y-3">
                  {INGESTION_POLICY_FIELDS.map((field) => (
                    <label className="flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3 text-sm" key={field.key}>
                      <span className="font-medium text-foreground">{field.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          Global: {ingestionDraft[field.key].enabled ? 'On' : 'Off'}
                        </span>
                        <input
                          checked={sportOverrideDraft[field.key]}
                          data-testid={`root-admin-ingestion-override-${field.key}`}
                          onChange={(event) => {
                            setSportOverrideDraft((current) => current
                              ? {
                                  ...current,
                                  [field.key]: event.target.checked,
                                }
                              : current);
                          }}
                          type="checkbox"
                        />
                      </div>
                    </label>
                  ))}
                </div>
                <button
                  className="mt-4 rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="root-admin-ingestion-override-save"
                  disabled={sportOverrideMutation.isPending || !sportOverrideDraft}
                  onClick={() => sportOverrideDraft && sportOverrideMutation.mutate({
                    sport: overrideSport,
                    draft: sportOverrideDraft,
                  })}
                  type="button"
                >
                  {sportOverrideMutation.isPending ? 'Saving...' : 'Save sport override'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-[1.5rem] border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Global ingestion schedule</p>
              <p className="mt-1 text-sm text-muted-foreground">Control the default cadence and lifecycle windows that scheduled ingestion uses across sports.</p>
            </div>
            <button
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground"
              disabled={resetIngestionConfigMutation.isPending}
              onClick={() => resetIngestionConfigMutation.mutate()}
              type="button"
            >
              Reset
            </button>
          </div>

          {ingestionConfigQuery.isLoading || !ingestionDraft ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading ingestion schedule configuration...</p>
          ) : ingestionConfigQuery.isError ? (
            <p className="mt-4 text-sm text-rose-700">
              {extractErrorMessage(ingestionConfigQuery.error, 'We could not load ingestion schedule configuration right now.')}
            </p>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {INGESTION_POLICY_FIELDS.map((field) => (
                  <div className="rounded-2xl border border-border p-4" key={field.key}>
                    {(() => {
                      const extraKey = 'extraKey' in field ? field.extraKey : undefined;
                      const extraLabel = 'extraLabel' in field ? field.extraLabel : undefined;

                      return (
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="text-sm text-muted-foreground">
                        <span className="mb-2 block font-medium text-foreground">{field.label}</span>
                        <div className="flex h-[52px] items-center justify-between rounded-2xl border border-border bg-card px-4">
                          <span className="text-sm text-foreground">Enabled</span>
                          <input
                            checked={ingestionDraft[field.key].enabled}
                            data-testid={`root-admin-ingestion-${field.key}-enabled`}
                            onChange={(event) => updateIngestionDraft(field.key, 'enabled', event.target.checked)}
                            type="checkbox"
                          />
                        </div>
                      </label>
                      <label className="text-sm text-muted-foreground">
                        <span className="mb-2 block font-medium text-foreground">{field.intervalLabel}</span>
                        <input
                          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                          data-testid={`root-admin-ingestion-${field.key}-${field.intervalKey}`}
                          onChange={(event) => updateIngestionDraft(field.key, field.intervalKey, event.target.value)}
                          type="number"
                          value={ingestionDraft[field.key][field.intervalKey] ?? ''}
                        />
                      </label>
                      {extraKey ? (
                        <label className="text-sm text-muted-foreground">
                          <span className="mb-2 block font-medium text-foreground">{extraLabel}</span>
                          <input
                            className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                            data-testid={`root-admin-ingestion-${field.key}-${extraKey}`}
                            onChange={(event) => updateIngestionDraft(field.key, extraKey, event.target.value)}
                            type="number"
                            value={ingestionDraft[field.key][extraKey] ?? ''}
                          />
                        </label>
                      ) : (
                        <div />
                      )}
                    </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
              <button
                className="mt-4 rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="root-admin-ingestion-save"
                disabled={ingestionConfigMutation.isPending}
                onClick={() => ingestionDraft && ingestionConfigMutation.mutate(ingestionDraft)}
                type="button"
              >
                {ingestionConfigMutation.isPending ? 'Saving...' : 'Save ingestion schedule'}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Contest configuration defaults</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Root-admin control over the persisted contest templates used by future commissioner create flows.
            </p>
          </div>
        </div>

        {contestTemplatesQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Loading contest templates...</p>
        ) : contestTemplatesQuery.isError ? (
          <p className="mt-4 text-sm text-rose-700">
            {extractErrorMessage(contestTemplatesQuery.error, 'We could not load contest templates right now.')}
          </p>
        ) : (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {orderedContestTemplates.map((template) => (
              <div className="rounded-[1.5rem] border border-border bg-background p-4" key={template.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{template.templateKey}</p>
                    <h4 className="mt-2 text-lg font-semibold text-foreground">{template.name}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{template.sport} · {template.contestType} · {template.configMode}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${template.active ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-border bg-card text-muted-foreground'}`}>
                      {template.active ? 'Active' : 'Inactive'}
                    </span>
                    {template.isDefault ? (
                      <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                        Default
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Name</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      data-testid={`root-admin-template-name-${template.id}`}
                      onChange={(event) => updateTemplateDraft(template.id, (current) => ({ ...current, name: event.target.value }))}
                      value={template.name}
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    <span className="mb-2 block font-medium text-foreground">Sort order</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      onChange={(event) => updateTemplateDraft(template.id, (current) => ({ ...current, sortOrder: toPositiveNumber(event.target.value) }))}
                      type="number"
                      value={template.sortOrder}
                    />
                  </label>
                  <label className="text-sm text-muted-foreground md:col-span-2">
                    <span className="mb-2 block font-medium text-foreground">Description</span>
                    <textarea
                      className="min-h-[96px] w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                      onChange={(event) => updateTemplateDraft(template.id, (current) => ({ ...current, description: event.target.value }))}
                      value={template.description}
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <label className="flex items-center gap-2">
                    <input
                      checked={template.active}
                      onChange={(event) => updateTemplateDraft(template.id, (current) => ({ ...current, active: event.target.checked }))}
                      type="checkbox"
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={template.isDefault}
                      onChange={(event) => updateTemplateDraft(template.id, (current) => ({ ...current, isDefault: event.target.checked }))}
                      type="checkbox"
                    />
                    Default
                  </label>
                </div>

                {template.configuration.mode === 'GOLF_TIERED' ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-sm text-muted-foreground">
                      <span className="mb-2 block font-medium text-foreground">Tier count</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                        onChange={(event) => updateTieredTemplateConfiguration(template.id, {
                          tierCount: toPositiveNumber(event.target.value),
                        })}
                        type="number"
                        value={getTierCount(template)}
                      />
                    </label>
                    <label className="text-sm text-muted-foreground">
                      <span className="mb-2 block font-medium text-foreground">Picks per tier</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                        onChange={(event) => updateTieredTemplateConfiguration(template.id, {
                          picksPerTier: toPositiveNumber(event.target.value),
                        })}
                        type="number"
                        value={getPicksPerTier(template)}
                      />
                    </label>
                    <label className="text-sm text-muted-foreground">
                      <span className="mb-2 block font-medium text-foreground">Counted scores</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                        onChange={(event) => updateTieredTemplateConfiguration(template.id, {
                          countedScores: toPositiveNumber(event.target.value),
                        })}
                        type="number"
                        value={template.configuration.countedScores}
                      />
                    </label>
                    <label className="text-sm text-muted-foreground">
                      <span className="mb-2 block font-medium text-foreground">Tier size</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                        onChange={(event) => updateTieredTemplateConfiguration(template.id, {
                          tierSize: toPositiveNumber(event.target.value),
                        })}
                        type="number"
                        value={template.configuration.tierGeneration.defaultTierSize}
                      />
                    </label>
                    <label className="text-sm text-muted-foreground">
                      <span className="mb-2 block font-medium text-foreground">Cut score</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                        onChange={(event) => updateTieredTemplateConfiguration(template.id, {
                          cutScore: toPositiveNumber(event.target.value),
                        })}
                        type="number"
                        value={template.configuration.cutRule.fixedScore}
                      />
                    </label>
                    <div className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
                      <div>Roster size: {template.configuration.rosterSize}</div>
                      <div className="mt-1">Template tiers: {template.configuration.tiers.length}</div>
                    </div>
                  </div>
                ) : null}

                <button
                  className="mt-4 rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid={`root-admin-template-save-${template.id}`}
                  disabled={contestTemplateMutation.isPending}
                  onClick={() => contestTemplateMutation.mutate({
                    templateId: template.id,
                    draft: template,
                  })}
                  type="button"
                >
                  {contestTemplateMutation.isPending && contestTemplateMutation.variables?.templateId === template.id ? 'Saving...' : 'Save template'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Sync history</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Most recent runs are shown first. Use manual sync only when automatic ingestion has not populated contest-ready
              data yet or when operational troubleshooting is needed.
            </p>
            {syncRunsQuery.isError ? (
              <p className="mt-3 text-sm text-rose-700">
                {extractErrorMessage(syncRunsQuery.error, 'We could not load provider sync runs right now.')}
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 xl:min-w-[40rem] xl:grid-cols-2">
            <div className="rounded-[1.5rem] border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Manual sport sync</p>
              <div className="mt-3 space-y-3">
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Preset</span>
                  <select
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-sport-sync-preset"
                    disabled={syncMutation.isPending}
                    onChange={(event) => setSportSyncPresetId(event.target.value as SportSyncPresetId)}
                    value={sportSyncPresetId}
                  >
                    {SPORT_SYNC_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Sport</span>
                  <select
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-sport-sync-sport"
                    disabled={syncMutation.isPending}
                    onChange={(event) => setSportSyncSport(event.target.value as SyncSport)}
                    value={sportSyncSport}
                  >
                    {supportedSyncSports.map((sport) => (
                      <option key={sport} value={sport}>
                        {sport}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="root-admin-sport-sync-now"
                  disabled={syncMutation.isPending}
                  onClick={() => syncMutation.mutate({
                    sport: sportSyncSport,
                    presetId: sportSyncPresetId,
                  })}
                  type="button"
                >
                  {syncMutation.isPending ? 'Syncing...' : 'Run sport sync'}
                </button>
              </div>

              {syncMutation.isError ? (
                <p className="mt-3 text-sm text-rose-700">
                  {extractErrorMessage(syncMutation.error)}
                </p>
              ) : null}

              {syncMutation.isSuccess ? (
                <p className="mt-3 text-sm text-emerald-700" data-testid="root-admin-sport-sync-success">
                  Completed
                  {' '}
                  {getSportSyncPreset(sportSyncPresetId).label}
                  {' '}
                  for
                  {' '}
                  {syncMutation.data.sport}
                  .{' '}
                  {buildJobSummary(syncMutation.data.jobs)}
                </p>
              ) : null}
            </div>

            <div className="rounded-[1.5rem] border border-border bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Manual event sync</p>
              <div className="mt-3 space-y-3">
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Preset</span>
                  <select
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-event-sync-preset"
                    disabled={eventSyncMutation.isPending}
                    onChange={(event) => setEventSyncPresetId(event.target.value as EventSyncPresetId)}
                    value={eventSyncPresetId}
                  >
                    {EVENT_SYNC_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Sport</span>
                  <select
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-event-sync-sport"
                    disabled={eventSyncMutation.isPending}
                    onChange={(event) => setEventSyncSport(event.target.value as SyncSport)}
                    value={eventSyncSport}
                  >
                    {supportedSyncSports.map((sport) => (
                      <option key={sport} value={sport}>
                        {sport}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-muted-foreground">
                  <span className="mb-2 block font-medium text-foreground">Event ID</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                    data-testid="root-admin-event-sync-event-id"
                    disabled={eventSyncMutation.isPending}
                    onChange={(event) => setEventSyncEventId(event.target.value)}
                    placeholder="masters-2026"
                    value={eventSyncEventId}
                  />
                </label>
                <button
                  className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="root-admin-event-sync-now"
                  disabled={eventSyncMutation.isPending || eventSyncEventId.trim().length === 0}
                  onClick={() => eventSyncMutation.mutate({
                    sport: eventSyncSport,
                    eventId: eventSyncEventId.trim(),
                    presetId: eventSyncPresetId,
                  })}
                  type="button"
                >
                  {eventSyncMutation.isPending ? 'Syncing...' : 'Run event sync'}
                </button>
              </div>

              {eventSyncMutation.isError ? (
                <p className="mt-3 text-sm text-rose-700">
                  {extractErrorMessage(eventSyncMutation.error)}
                </p>
              ) : null}

              {eventSyncMutation.isSuccess ? (
                <p className="mt-3 text-sm text-emerald-700" data-testid="root-admin-event-sync-success">
                  Completed
                  {' '}
                  {getEventSyncPreset(eventSyncPresetId).label}
                  {' '}
                  for
                  {' '}
                  {eventSyncMutation.data.eventId}
                  .{' '}
                  {buildJobSummary(eventSyncMutation.data.jobs)}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {recentRuns.length === 0 ? (
          <div className="mt-5 rounded-[1.5rem] border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
            No sync runs matched the current filters.
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-border bg-background">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm" data-testid="root-admin-sync-history-table">
                <thead className="bg-card/70 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Completed</th>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Sport</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr
                      className="border-t border-border align-top"
                      data-testid={`root-admin-sync-run-${run.id}`}
                      key={run.id}
                    >
                      <td className="px-4 py-4 text-foreground">{formatDateTimeDisplay(run.startedAt ?? run.createdAt)}</td>
                      <td className="px-4 py-4 text-muted-foreground">{formatDateTimeDisplay(run.completedAt)}</td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground">{getProviderName(run.providerId, providersQuery.data)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{run.providerId}</div>
                      </td>
                      <td className="px-4 py-4 text-foreground">{run.sport}</td>
                      <td className="px-4 py-4 text-muted-foreground">{formatEventValue(run.eventId)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getStatusClasses(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{buildPayloadSummary(run.payload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  GetManagedContestResponses,
  GetLeagueByCodeResponses,
  ListManagedContestTemplatesResponses,
  ListEventsResponses,
} from '@/lib/api';
import type { CreateContestManagementRequest, UpdateContestRequest } from '@poolmaster/shared/dto';
import {
  createManagedContest,
  deleteContest,
  getLeagueByCode,
  getManagedContest,
  listManagedContestTemplates,
  listEvents,
  updateContest,
  updateManagedContestConfiguration,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { useLogger } from '@/lib/logger';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeaguePath,
  buildLeagueTeamPath,
} from '@/features/leagues/league-routing';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type SportEventSummary = ListEventsResponses[200]['events'][number];
type ManagedContest = GetManagedContestResponses[200]['contest'];
type ManagedContestTemplate = ListManagedContestTemplatesResponses[200]['templates'][number];
type ContestMode = 'GOLF_TIERED' | 'GOLF_CATEGORY_PICKS';
type TierSource = 'ODDS' | 'WORLD_RANK';
type LockPreset = 'FIVE_MINUTES' | 'ONE_HOUR' | 'CUSTOM';
type CategoryKey =
  | 'SENIOR'
  | 'ROOKIE'
  | 'PREVIOUS_WINNER'
  | 'US_PLAYER'
  | 'INTERNATIONAL_PLAYER';

type TierDefinition = {
  tierKey: string;
  label: string;
  pickCount: number;
  startPosition: number;
  endPosition: number | null;
};

type CategoryOption = {
  key: CategoryKey;
  label: string;
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  { key: 'SENIOR', label: 'Senior' },
  { key: 'ROOKIE', label: 'Rookie' },
  { key: 'PREVIOUS_WINNER', label: 'Previous Winner' },
  { key: 'US_PLAYER', label: 'US Player' },
  { key: 'INTERNATIONAL_PLAYER', label: 'International Player' },
];

const SUPPORTED_CREATE_MODES: ContestMode[] = ['GOLF_TIERED'];

const LOCK_PRESET_OPTIONS: Array<{
  value: LockPreset;
  label: string;
  minutes: number | null;
}> = [
  { value: 'FIVE_MINUTES', label: '5 minutes before start', minutes: 5 },
  { value: 'ONE_HOUR', label: '1 hour before start', minutes: 60 },
  { value: 'CUSTOM', label: 'Custom', minutes: null },
];

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not create that contest. Please try again.';
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

  return 'We could not create that contest. Please try again.';
}

function buildTierKey(index: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return alphabet[index] ?? `T${index + 1}`;
}

function buildSeededTiers(rosterSize: number, defaultTierSize: number): TierDefinition[] {
  return Array.from({ length: rosterSize }, (_, index) => ({
    tierKey: buildTierKey(index),
    label: `Tier ${buildTierKey(index)}`,
    pickCount: 1,
    startPosition: index * defaultTierSize + 1,
    endPosition: index === rosterSize - 1 ? null : (index + 1) * defaultTierSize,
  }));
}

function formatDateTimeDisplay(isoString: string | null) {
  if (!isoString) {
    return 'Unavailable';
  }

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'Unavailable';
  }

  return date.toLocaleString();
}

function formatReadinessLabel(event: SportEventSummary) {
  switch (event.readinessStatus) {
    case 'CONTEST_ELIGIBLE':
      return 'Contest ready';
    case 'PENDING_FIELD':
      return 'Waiting for field';
    case 'FIELD_LOCKED':
      return 'Field locked';
    case 'NOT_RELEASED':
    default:
      return 'Not released yet';
  }
}

function formatReadinessReasons(event: SportEventSummary) {
  if (!event.readinessReasons.length) {
    return 'This event is ready for contest setup.';
  }

  return event.readinessReasons
    .map((reason) => {
      switch (reason) {
        case 'EVENT_NOT_RELEASED':
          return 'not released yet';
        case 'FIELD_NOT_LOADED':
          return 'field not loaded';
        case 'FIELD_LOCKED':
          return 'field already locked';
        default:
          return 'readiness status unavailable';
      }
    })
    .join(', ');
}

function subtractMinutesFromIso(isoString: string, minutes: number) {
  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed - minutes * 60 * 1000).toISOString();
}

function resolveLockPresetFromMinutes(
  minutesBeforeStart: number,
): { preset: LockPreset; customHours: string; customMinutes: string } {
  if (minutesBeforeStart === 5) {
    return { preset: 'FIVE_MINUTES', customHours: '0', customMinutes: '5' };
  }

  if (minutesBeforeStart === 60) {
    return { preset: 'ONE_HOUR', customHours: '1', customMinutes: '0' };
  }

  if (minutesBeforeStart < 0) {
    return { preset: 'CUSTOM', customHours: '0', customMinutes: '0' };
  }

  return {
    preset: 'CUSTOM',
    customHours: String(Math.floor(minutesBeforeStart / 60)),
    customMinutes: String(minutesBeforeStart % 60),
  };
}

function getLockOffsetMinutes(
  lockPreset: LockPreset,
  customLockHours: string,
  customLockMinutes: string,
) {
  const preset = LOCK_PRESET_OPTIONS.find((option) => option.value === lockPreset);
  if (preset?.minutes != null) {
    return preset.minutes;
  }

  const hours = Math.max(0, Number(customLockHours) || 0);
  const minutes = Math.max(0, Number(customLockMinutes) || 0);
  return hours * 60 + minutes;
}

function deriveLockAtFromEvent(
  eventStartIso: string | null | undefined,
  lockPreset: LockPreset,
  customLockHours: string,
  customLockMinutes: string,
) {
  if (!eventStartIso) {
    return null;
  }

  return subtractMinutesFromIso(
    eventStartIso,
    getLockOffsetMinutes(lockPreset, customLockHours, customLockMinutes),
  );
}

function sortEventsForPicker(events: SportEventSummary[]) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.startDate);
    const rightTime = Date.parse(right.startDate);
    return leftTime - rightTime;
  });
}

function buildCategoryDefinitions(
  selectedCategories: CategoryKey[],
  categoryPickCounts: Record<CategoryKey, string>,
) {
  return selectedCategories.map((categoryKey) => ({
    categoryKey,
    label:
      CATEGORY_OPTIONS.find((category) => category.key === categoryKey)?.label
      ?? categoryKey,
    pickCount: Number(categoryPickCounts[categoryKey] || '1'),
  }));
}

export function CreateContestPage() {
  const logger = useLogger().child({
    feature: 'create-contest-page',
  });
  const { leagueCode = '', contestId } = useParams<{ leagueCode: string; contestId?: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(contestId);

  const [mode, setMode] = useState<ContestMode>('GOLF_TIERED');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [contestName, setContestName] = useState('');
  const [sportEventId, setSportEventId] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [lockPreset, setLockPreset] = useState<LockPreset>('FIVE_MINUTES');
  const [customLockHours, setCustomLockHours] = useState('0');
  const [customLockMinutes, setCustomLockMinutes] = useState('5');
  const [unlimitedEntries, setUnlimitedEntries] = useState(false);
  const [maxEntriesPerTeam, setMaxEntriesPerTeam] = useState('1');
  const [rosterSize, setRosterSize] = useState('6');
  const [countedScores, setCountedScores] = useState('4');
  const [tierSource, setTierSource] = useState<TierSource>('ODDS');
  const [defaultTierSize, setDefaultTierSize] = useState('10');
  const [tiers, setTiers] = useState<TierDefinition[]>(buildSeededTiers(6, 10));
  const [hasCustomTiers, setHasCustomTiers] = useState(false);
  const [tieredFallbackScore, setTieredFallbackScore] = useState('80');
  const [selectedCategories, setSelectedCategories] = useState<CategoryKey[]>([
    'SENIOR',
    'ROOKIE',
    'PREVIOUS_WINNER',
    'US_PLAYER',
    'INTERNATIONAL_PLAYER',
  ]);
  const [categoryPickCounts, setCategoryPickCounts] = useState<Record<CategoryKey, string>>({
    SENIOR: '1',
    ROOKIE: '1',
    PREVIOUS_WINNER: '1',
    US_PLAYER: '1',
    INTERNATIONAL_PLAYER: '1',
  });
  const [categoryFallbackScore, setCategoryFallbackScore] = useState('80');
  const [formError, setFormError] = useState<string | null>(null);
  const [isHydratedFromManagedContest, setIsHydratedFromManagedContest] = useState(false);

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'league', leagueCode],
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
      }

      return response.data.league;
    },
    enabled: Boolean(leagueCode),
    retry: false,
  });

  const eventsQuery = useQuery({
    queryKey: ['poolmaster', 'sport-events', 'GOLF'],
    queryFn: async (): Promise<SportEventSummary[]> => {
      const response = await listEvents({
        query: {
          sport: 'GOLF',
          limit: 100,
        },
      });

      if (!response.data?.events) {
        throw response.error ?? new Error('Sport event list response is missing data.');
      }

      return sortEventsForPicker(response.data.events);
    },
    enabled: Boolean(auth.isAuthenticated),
    retry: false,
  });

  const managedContestQuery = useQuery({
    queryKey: ['poolmaster', 'managed-contest', leagueQuery.data?.id, contestId],
    queryFn: async (): Promise<ManagedContest> => {
      const response = await getManagedContest({
        path: { id: leagueQuery.data!.id, contestId: contestId! },
      });

      if (!response.data?.contest) {
        throw response.error ?? new Error('Managed contest response is missing data.');
      }

      return response.data.contest;
    },
    enabled: Boolean(contestId && leagueQuery.data?.id),
    retry: false,
  });

  const templatesQuery = useQuery({
    queryKey: ['poolmaster', 'managed-contest-templates', leagueQuery.data?.id, 'GOLF'],
    queryFn: async (): Promise<ManagedContestTemplate[]> => {
      const response = await listManagedContestTemplates({
        path: { id: leagueQuery.data!.id },
        query: {
          sport: 'GOLF',
          contestType: 'SINGLE_EVENT',
        },
      });

      if (!response.data?.templates) {
        throw response.error ?? new Error('Contest template response is missing data.');
      }

      return response.data.templates;
    },
    enabled: Boolean(leagueQuery.data?.id),
    retry: false,
  });

  const selectedEvent = useMemo(
    () => eventsQuery.data?.find((event) => event.id === sportEventId) ?? null,
    [eventsQuery.data, sportEventId],
  );
  const eligibleEvents = useMemo(
    () => eventsQuery.data?.filter((event) => event.contestEligible) ?? [],
    [eventsQuery.data],
  );
  const unavailableEvents = useMemo(
    () => eventsQuery.data?.filter((event) => !event.contestEligible) ?? [],
    [eventsQuery.data],
  );
  const selectedTemplate = useMemo(
    () =>
      templatesQuery.data?.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templatesQuery.data],
  );
  const visibleTemplates = useMemo(
    () =>
      isEditMode
        ? (templatesQuery.data ?? [])
        : (templatesQuery.data ?? []).filter((template) =>
            SUPPORTED_CREATE_MODES.includes(template.configMode),
          ),
    [isEditMode, templatesQuery.data],
  );
  const derivedLockAt = useMemo(
    () =>
      deriveLockAtFromEvent(
        selectedEvent?.startDate ?? null,
        lockPreset,
        customLockHours,
        customLockMinutes,
      ),
    [customLockHours, customLockMinutes, lockPreset, selectedEvent?.startDate],
  );

  function applyTemplateConfiguration(
    configuration: ManagedContestTemplate['configuration'],
  ) {
    setMode(configuration.mode);
    setUnlimitedEntries(configuration.maxEntriesPerSquad == null);
    setMaxEntriesPerTeam(
      configuration.maxEntriesPerSquad == null
        ? '1'
        : String(configuration.maxEntriesPerSquad),
    );

    if (configuration.mode === 'GOLF_TIERED') {
      setRosterSize(String(configuration.rosterSize));
      setCountedScores(String(configuration.countedScores));
      setTierSource(configuration.tierSource);
      setDefaultTierSize(String(configuration.tierGeneration.defaultTierSize));
      setTiers(configuration.tiers);
      setHasCustomTiers(false);
      setTieredFallbackScore(String(configuration.cutRule.fixedScore));
      return;
    }

    setSelectedCategories(
      configuration.categories.map((category) => category.categoryKey as CategoryKey),
    );
    setCategoryPickCounts(
      configuration.categories.reduce<Record<CategoryKey, string>>(
        (accumulator, category) => {
          accumulator[category.categoryKey as CategoryKey] = String(
            category.pickCount,
          );
          return accumulator;
        },
        {
          SENIOR: '1',
          ROOKIE: '1',
          PREVIOUS_WINNER: '1',
          US_PLAYER: '1',
          INTERNATIONAL_PLAYER: '1',
        },
      ),
    );
    setCategoryFallbackScore(String(configuration.cutRule.fixedScore));
  }

  function selectTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templatesQuery.data?.find((entry) => entry.id === templateId);
    if (template) {
      applyTemplateConfiguration(template.configuration);
    }
  }

  function selectDefaultTemplateForMode(nextMode: ContestMode) {
    if (!isEditMode && !SUPPORTED_CREATE_MODES.includes(nextMode)) {
      return;
    }

    const template = templatesQuery.data?.find(
      (entry) => entry.configMode === nextMode && entry.isDefault,
    ) ?? templatesQuery.data?.find((entry) => entry.configMode === nextMode);

    if (template) {
      selectTemplate(template.id);
      return;
    }

    setMode(nextMode);
  }

  useEffect(() => {
    if (!managedContestQuery.data || isHydratedFromManagedContest) {
      return;
    }

    const contest = managedContestQuery.data;
    const configuration = contest.configuration;

    setContestName(contest.name);
    setSportEventId(contest.sportEventId);
    setSelectedTemplateId(contest.templateId ?? '');
    setUnlimitedEntries(configuration.maxEntriesPerSquad == null);
    setMaxEntriesPerTeam(
      configuration.maxEntriesPerSquad == null
        ? '1'
        : String(configuration.maxEntriesPerSquad),
    );
    setMode(configuration.mode);

    if (configuration.mode === 'GOLF_TIERED') {
      setRosterSize(String(configuration.rosterSize));
      setCountedScores(String(configuration.countedScores));
      setTierSource(configuration.tierSource);
      setDefaultTierSize(String(configuration.tierGeneration.defaultTierSize));
      setTiers(configuration.tiers);
      setHasCustomTiers(true);
      setTieredFallbackScore(String(configuration.cutRule.fixedScore));
    } else {
      setSelectedCategories(
        configuration.categories.map((category) => category.categoryKey),
      );
      setCategoryPickCounts(
        configuration.categories.reduce<Record<CategoryKey, string>>((accumulator, category) => {
          accumulator[category.categoryKey] = String(category.pickCount);
          return accumulator;
        }, {
          SENIOR: '1',
          ROOKIE: '1',
          PREVIOUS_WINNER: '1',
          US_PLAYER: '1',
          INTERNATIONAL_PLAYER: '1',
        }),
      );
      setCategoryFallbackScore(String(configuration.cutRule.fixedScore));
    }

    const eventStart = eventsQuery.data?.find((event) => event.id === contest.sportEventId)?.startDate;
    if (eventStart && configuration.locksAt) {
      const minutesBeforeStart = Math.max(
        0,
        Math.round((Date.parse(eventStart) - Date.parse(configuration.locksAt)) / 60000),
      );
      const resolvedLockPreset = resolveLockPresetFromMinutes(minutesBeforeStart);
      setLockPreset(resolvedLockPreset.preset);
      setCustomLockHours(resolvedLockPreset.customHours);
      setCustomLockMinutes(resolvedLockPreset.customMinutes);
    }

    setIsHydratedFromManagedContest(true);
  }, [eventsQuery.data, isHydratedFromManagedContest, managedContestQuery.data]);

  useEffect(() => {
    if (!hasCustomTiers) {
      const nextRosterSize = Math.max(1, Number(rosterSize) || 1);
      const nextDefaultTierSize = Math.max(1, Number(defaultTierSize) || 1);
      setTiers(buildSeededTiers(nextRosterSize, nextDefaultTierSize));
    }
  }, [defaultTierSize, hasCustomTiers, rosterSize]);

  useEffect(() => {
    if (!sportEventId && eligibleEvents.length) {
      setSportEventId(eligibleEvents[0].id);
    }
  }, [eligibleEvents, sportEventId]);

  useEffect(() => {
    if (sportEventId && eligibleEvents.some((event) => event.id === sportEventId)) {
      return;
    }

    if (eligibleEvents.length) {
      setSportEventId(eligibleEvents[0].id);
    }
  }, [eligibleEvents, sportEventId]);

  useEffect(() => {
    if (isEditMode || selectedTemplateId || !visibleTemplates.length) {
      return;
    }

    const defaultTemplate =
      visibleTemplates.find((template) => template.isDefault)
      ?? visibleTemplates[0];

    if (defaultTemplate) {
      selectTemplate(defaultTemplate.id);
    }
  }, [isEditMode, selectedTemplateId, visibleTemplates]);

  useEffect(() => {
    if (mode === 'GOLF_CATEGORY_PICKS') {
      setShowAdvanced(false);
    }
  }, [mode]);

  useEffect(() => {
    if (leagueQuery.isError) {
      logger.warn(
        {
          action: 'contestCreate.league.failed',
          data: {
            leagueCode,
            isEditMode,
          },
          err: leagueQuery.error,
        },
        'Contest create page failed to load league detail',
      );
    }
  }, [isEditMode, leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  useEffect(() => {
    if (eventsQuery.isError) {
      logger.warn(
        {
          action: 'contestCreate.events.failed',
          data: {
            leagueCode,
            isEditMode,
          },
          err: eventsQuery.error,
        },
        'Contest create page failed to load events',
      );
    }
  }, [eventsQuery.error, eventsQuery.isError, isEditMode, leagueCode, logger]);

  useEffect(() => {
    if (!leagueQuery.data || !eventsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestCreate.page.loaded',
        data: {
          leagueCode,
          leagueId: leagueQuery.data.id,
          eventCount: eventsQuery.data.length,
          templateCount: visibleTemplates.length,
          isEditMode,
        },
      },
      'Contest create page loaded',
    );
  }, [eventsQuery.data, isEditMode, leagueCode, leagueQuery.data, logger, visibleTemplates.length]);

  const saveContestMutation = useMutation({
    mutationFn: async () => {
      if (!leagueQuery.data?.id) {
        throw new Error('League detail is still loading.');
      }

      const trimmedName = contestName.trim();
      const parsedLockAt = derivedLockAt;
      const parsedMaxEntries = unlimitedEntries ? undefined : Number(maxEntriesPerTeam);

      if (!trimmedName) {
        throw new Error('Contest name is required.');
      }

      if (!sportEventId || !selectedEvent) {
        throw new Error('Select a golf event before creating the contest.');
      }

      if (!selectedEvent.contestEligible) {
        throw new Error('Select a contest-ready golf event before creating the contest.');
      }

      if (!parsedLockAt) {
        throw new Error('A valid event-relative lock time is required.');
      }

      if (
        !unlimitedEntries
        && (!Number.isInteger(parsedMaxEntries) || (parsedMaxEntries ?? 0) < 1)
      ) {
        throw new Error('Max entries per team must be a positive whole number.');
      }

      const commonConfiguration = {
        locksAt: parsedLockAt,
        ...(parsedMaxEntries !== undefined
          ? { maxEntriesPerSquad: parsedMaxEntries }
          : {}),
        playoffHandling: 'EXCLUDE_PLAYOFF_HOLES' as const,
        displayScoring: 'TO_PAR' as const,
        tiebreaker: {
          type: 'PREDICT_WINNING_SCORE' as const,
        },
      };

      const configuration =
        mode === 'GOLF_TIERED'
          ? (() => {
              const parsedRosterSize = Number(rosterSize);
              const parsedCountedScores = Number(countedScores);
              const parsedFallback = Number(tieredFallbackScore);
              const totalTierPickCount = tiers.reduce(
                (total, tier) => total + tier.pickCount,
                0,
              );

              if (!Number.isInteger(parsedRosterSize) || parsedRosterSize < 1) {
                throw new Error('Golfers picked must be a positive whole number.');
              }

              if (
                !Number.isInteger(parsedCountedScores)
                || parsedCountedScores < 1
                || parsedCountedScores > parsedRosterSize
              ) {
                throw new Error('Counted golfer scores must be between 1 and golfers picked.');
              }

              if (!Number.isInteger(parsedFallback) || parsedFallback < 0) {
                throw new Error('Missed-cut fallback score must be zero or greater.');
              }

              if (totalTierPickCount !== parsedRosterSize) {
                throw new Error('The sum of picks across all tiers must match golfers picked.');
              }

              if (
                tiers.some(
                  (tier) =>
                    tier.startPosition < 1
                    || (tier.endPosition !== null && tier.endPosition < tier.startPosition),
                )
              ) {
                throw new Error('Every tier must use valid start and end positions.');
              }

              return {
                mode: 'GOLF_TIERED' as const,
                rosterSize: parsedRosterSize,
                countedScores: parsedCountedScores,
                tierSource,
                tierGeneration: {
                  defaultTierSize: Math.max(1, Number(defaultTierSize) || 1),
                },
                tiers,
                cutRule: {
                  type: 'FIXED_SCORE' as const,
                  fixedScore: parsedFallback,
                },
                ...commonConfiguration,
              };
            })()
          : (() => {
              const parsedFallback = Number(categoryFallbackScore);
              const categories = buildCategoryDefinitions(selectedCategories, categoryPickCounts);

              if (!categories.length) {
                throw new Error('Select at least one category for a category-picks contest.');
              }

              if (
                categories.some(
                  (category) =>
                    !Number.isInteger(category.pickCount) || category.pickCount < 1,
                )
              ) {
                throw new Error('Every enabled category must require at least one pick.');
              }

              if (!Number.isInteger(parsedFallback) || parsedFallback < 0) {
                throw new Error('Missed-cut fallback score must be zero or greater.');
              }

              return {
                mode: 'GOLF_CATEGORY_PICKS' as const,
                categories,
                cutRule: {
                  type: 'FIXED_SCORE' as const,
                  fixedScore: parsedFallback,
                },
                ...commonConfiguration,
              };
            })();

      if (!isEditMode) {
        if (!selectedTemplateId || !selectedTemplate) {
          throw new Error('Select a contest template before creating the contest.');
        }

        const body: CreateContestManagementRequest = {
          name: trimmedName,
          sportEventId,
          contestType: 'SINGLE_EVENT',
          templateId: selectedTemplateId,
          configurationOverrides: configuration,
        };

        const response = await createManagedContest({
          path: { id: leagueQuery.data.id },
          body: body as never,
        });

        if (!response.data?.contest) {
          throw response.error ?? new Error('Contest creation response is missing data.');
        }

        return response.data.contest.id;
      }

      const metadataBody: UpdateContestRequest = {
        name: trimmedName,
        lockAt: parsedLockAt,
      };

      const metadataResponse = await updateContest({
        path: { contestId: contestId! },
        body: metadataBody as never,
      });
      if (metadataResponse.error) {
        throw metadataResponse.error;
      }

      const configurationResponse = await updateManagedContestConfiguration({
        path: { id: leagueQuery.data.id, contestId: contestId! },
        body: configuration as never,
      });

      if (!configurationResponse.data?.contest) {
        throw configurationResponse.error ?? new Error('Contest update response is missing data.');
      }

      return configurationResponse.data.contest.id;
    },
    onMutate: () => {
      logger.debug(
        {
          action: isEditMode ? 'contest.save.started' : 'contest.create.started',
          data: {
            leagueCode,
            contestId: contestId ?? null,
            sportEventId,
            mode,
          },
        },
        isEditMode ? 'Starting contest update flow' : 'Starting contest create flow',
      );
    },
    onSuccess: async (savedContestId: string) => {
      logger.info(
        {
          action: isEditMode ? 'contest.save.succeeded' : 'contest.create.succeeded',
          data: {
            leagueCode,
            contestId: savedContestId,
            sportEventId,
            mode,
          },
        },
        isEditMode ? 'Saved contest successfully' : 'Created contest successfully',
      );
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'league-contests', leagueQuery.data?.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'contest', savedContestId],
      });
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'managed-contest', savedContestId],
      });
      navigate(`/contests/${savedContestId}`, {
        state: { leagueCode },
      });
    },
    onError: (error) => {
      const payload = {
        action: isEditMode ? 'contest.save.failed' : 'contest.create.failed',
        data: {
          leagueCode,
          contestId: contestId ?? null,
          sportEventId,
          mode,
        },
        err: error,
      };

      if (error instanceof Error) {
        logger.error(payload, isEditMode ? 'Contest update failed unexpectedly' : 'Contest create failed unexpectedly');
      } else {
        logger.warn(payload, isEditMode ? 'Contest update was rejected' : 'Contest create was rejected');
      }
      setFormError(extractErrorMessage(error));
    },
  });

  const deleteContestMutation = useMutation({
    mutationFn: async () => {
      if (!contestId) {
        throw new Error('Contest id is required to delete a contest.');
      }

      const response = await deleteContest({
        path: { contestId },
      });

      if (response.error) {
        throw response.error;
      }
    },
    onMutate: () => {
      logger.debug(
        {
          action: 'contest.delete.started',
          data: {
            leagueCode,
            contestId: contestId ?? null,
          },
        },
        'Starting contest delete flow',
      );
    },
    onSuccess: async () => {
      logger.info(
        {
          action: 'contest.delete.succeeded',
          data: {
            leagueCode,
            contestId: contestId ?? null,
          },
        },
        'Deleted contest successfully',
      );
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'league-contests', leagueQuery.data?.id],
      });
      navigate(buildLeaguePath(leagueCode));
    },
    onError: (error) => {
      const payload = {
        action: 'contest.delete.failed',
        data: {
          leagueCode,
          contestId: contestId ?? null,
        },
        err: error,
      };

      if (error instanceof Error) {
        logger.error(payload, 'Contest delete failed unexpectedly');
      } else {
        logger.warn(payload, 'Contest delete was rejected');
      }
      setFormError(extractErrorMessage(error));
    },
  });

  function resetTiersFromDefaults() {
    setHasCustomTiers(false);
    setTiers(
      buildSeededTiers(
        Math.max(1, Number(rosterSize) || 1),
        Math.max(1, Number(defaultTierSize) || 1),
      ),
    );
  }

  function updateTier(index: number, updates: Partial<TierDefinition>) {
    setHasCustomTiers(true);
    setTiers((current) =>
      current.map((tier, tierIndex) =>
        tierIndex === index
          ? {
              ...tier,
              ...updates,
            }
          : tier,
      ),
    );
  }

  function toggleCategory(categoryKey: CategoryKey) {
    setSelectedCategories((current) =>
      current.includes(categoryKey)
        ? current.filter((key) => key !== categoryKey)
        : [...current, categoryKey],
    );
  }

  const isCommissioner =
    leagueQuery.data?.role === 'COMMISSIONER' || Boolean(auth.user?.isRootAdmin);
  const isDraftEditable = !isEditMode || managedContestQuery.data?.status === 'DRAFT';

  if (
    leagueQuery.isLoading
    || eventsQuery.isLoading
    || managedContestQuery.isLoading
    || templatesQuery.isLoading
  ) {
    return (
      <section
        className="rounded-[2rem] border border-border bg-card p-8"
        data-testid="create-contest-page-loading"
      >
        <p className="text-sm text-muted-foreground">Loading contest setup...</p>
      </section>
    );
  }

  if (
    leagueQuery.isError
    || !leagueQuery.data
    || managedContestQuery.isError
    || templatesQuery.isError
  ) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <section
        className="rounded-[2rem] border border-border bg-card p-8"
        data-testid="create-contest-page-error"
      >
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.body}
        </p>
      </section>
    );
  }

  if (!isCommissioner) {
    return (
      <section
        className="rounded-[2rem] border border-border bg-card p-8"
        data-testid="create-contest-page-unauthorized"
      >
        <h2 className="text-2xl font-semibold">Commissioner access required</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Contest configuration stays limited to commissioners so the league uses one consistent
          contest setup flow.
        </p>
        <Link
          className="mt-5 inline-flex rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
          to={buildLeaguePath(leagueQuery.data.leagueCode)}
        >
          Back to league home
        </Link>
      </section>
    );
  }

  return (
    <section
      className="space-y-6"
      data-testid={isEditMode ? 'manage-contest-page' : 'create-contest-page'}
    >
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Commissioner contest setup
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                {isEditMode ? 'Manage golf contest' : 'Create a golf contest'}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {isEditMode
                  ? 'Keep contest setup and league-facing rules aligned from the same commissioner shell used during creation.'
                  : 'Start with the approved golf-first contest family. The current web flow supports tiered golf contests end to end.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeaguePath(leagueQuery.data.leagueCode)}
            >
              Back to league
            </Link>
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueTeamPath(leagueQuery.data.leagueCode)}
            >
              My Team
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                mode === 'GOLF_TIERED'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-foreground hover:bg-muted/40'
              }`}
              data-testid="contest-mode-tiered"
              onClick={() => selectDefaultTemplateForMode('GOLF_TIERED')}
              type="button"
            >
              Tiered contest
            </button>
            <button
              className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                mode === 'GOLF_CATEGORY_PICKS'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground'
              }`}
              data-testid="contest-mode-category"
              disabled={!isEditMode}
              onClick={() => selectDefaultTemplateForMode('GOLF_CATEGORY_PICKS')}
              title={
                isEditMode
                  ? undefined
                  : 'Category-picks web entry flow will be enabled in a later slice.'
              }
              type="button"
            >
              Category picks
            </button>
            <button
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              data-testid="contest-toggle-advanced"
              onClick={() => setShowAdvanced((current) => !current)}
              type="button"
            >
              {showAdvanced ? 'Hide advanced' : 'Show advanced'}
            </button>
          </div>

          <div className="mt-6 space-y-5">
            {isEditMode && !isDraftEditable ? (
              <div
                className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-muted-foreground"
                data-testid="contest-manage-readonly-note"
              >
                Contest structure is no longer editable. Lock, in-progress, and completed states
                follow the real event timing and feed updates automatically.
              </div>
            ) : null}

            <fieldset className="space-y-5" disabled={!isDraftEditable}>
            {!isEditMode ? (
              <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
                <div>
                  <div className="text-sm font-medium">Contest template</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start from a seeded contest template. The selected template seeds the setup
                    below, and any commissioner changes become the contest-specific configuration
                    saved at creation time.
                  </p>
                </div>
                <div className="grid gap-3">
                  {visibleTemplates.map((template) => (
                    <button
                      className={`rounded-2xl border px-4 py-4 text-left transition ${
                        selectedTemplateId === template.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:bg-muted/40'
                      }`}
                      data-testid={`contest-template-${template.templateKey}`}
                      key={template.id}
                      onClick={() => selectTemplate(template.id)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-foreground">
                          {template.name}
                        </span>
                        {template.isDefault ? (
                          <span className="rounded-full border border-border px-2 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Default
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {template.description}
                      </p>
                    </button>
                  ))}
                </div>
                {!isEditMode ? (
                  <div className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground">
                    Category-picks contests remain part of the overall design, but the current web
                    entry flow is tiered-only for this first pass.
                  </div>
                ) : null}
              </div>
            ) : null}

            <label className="block space-y-2">
              <span className="text-sm font-medium">Contest name</span>
              <input
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                data-testid="contest-name"
                onChange={(event) => setContestName(event.target.value)}
                placeholder="Masters Pick 6"
                type="text"
                value={contestName}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium">Golf event</span>
              <select
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                data-testid="contest-sport-event"
                onChange={(event) => {
                  setSportEventId(event.target.value);
                }}
                value={sportEventId}
              >
                <option value="">Select an event</option>
                {eligibleEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                    {' · '}
                    {new Date(event.startDate).toLocaleDateString()}
                    {' · '}
                    {event.participantCount ?? 0}
                    {' golfers'}
                  </option>
                ))}
              </select>
            </label>

            {selectedEvent ? (
              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">Selected event readiness</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatReadinessReasons(selectedEvent)}
                    </p>
                  </div>
                  <span className="rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {formatReadinessLabel(selectedEvent)}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                    <dt className="font-medium text-foreground">Participants loaded</dt>
                    <dd className="mt-1">{selectedEvent.participantCount ?? 0}</dd>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                    <dt className="font-medium text-foreground">Release at</dt>
                    <dd className="mt-1">{formatDateTimeDisplay(selectedEvent.releaseAt)}</dd>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                    <dt className="font-medium text-foreground">Field locks at</dt>
                    <dd className="mt-1">{formatDateTimeDisplay(selectedEvent.fieldLocksAt)}</dd>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                    <dt className="font-medium text-foreground">Event status</dt>
                    <dd className="mt-1">{selectedEvent.status}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
              <div>
                <div className="text-sm font-medium">Lock time</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  PoolMaster stores an exact lock timestamp, but commissioners configure it
                  relative to the event start.
                </p>
              </div>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Lock entries</span>
                <select
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                  data-testid="contest-lock-preset"
                  onChange={(event) => setLockPreset(event.target.value as LockPreset)}
                  value={lockPreset}
                >
                  {LOCK_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {lockPreset === 'CUSTOM' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Hours before start</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-lock-custom-hours"
                      min={0}
                      onChange={(event) => setCustomLockHours(event.target.value)}
                      type="number"
                      value={customLockHours}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Minutes before start</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-lock-custom-minutes"
                      min={0}
                      onChange={(event) => setCustomLockMinutes(event.target.value)}
                      type="number"
                      value={customLockMinutes}
                    />
                  </label>
                </div>
              ) : null}
              <div className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm">
                <div className="font-medium text-foreground">Resolved lock timestamp</div>
                <div className="mt-1 text-muted-foreground" data-testid="contest-lock-summary">
                  {derivedLockAt ? formatDateTimeDisplay(derivedLockAt) : 'Select a golf event first'}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Entries per team</div>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <input
                  checked={unlimitedEntries}
                  data-testid="contest-max-entries-unlimited"
                  onChange={(event) => setUnlimitedEntries(event.target.checked)}
                  type="checkbox"
                />
                Unlimited
              </label>
              {!unlimitedEntries ? (
                <input
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                  data-testid="contest-max-entries"
                  min={1}
                  onChange={(event) => setMaxEntriesPerTeam(event.target.value)}
                  type="number"
                  value={maxEntriesPerTeam}
                />
              ) : null}
            </div>

            {mode === 'GOLF_TIERED' ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Golfers picked</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-tiered-roster-size"
                      min={1}
                      onChange={(event) => setRosterSize(event.target.value)}
                      type="number"
                      value={rosterSize}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Count best</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-tiered-counted-scores"
                      min={1}
                      onChange={(event) => setCountedScores(event.target.value)}
                      type="number"
                      value={countedScores}
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Tier source</span>
                    <select
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-tiered-source"
                      onChange={(event) => setTierSource(event.target.value as TierSource)}
                      value={tierSource}
                    >
                      <option value="ODDS">Odds</option>
                      <option value="WORLD_RANK">World rank</option>
                    </select>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Default tier size</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-tiered-default-tier-size"
                      min={1}
                      onChange={(event) => setDefaultTierSize(event.target.value)}
                      type="number"
                      value={defaultTierSize}
                    />
                  </label>
                </div>

                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-medium">Tier preview</h3>
                      <p className="text-sm text-muted-foreground">
                        Basic setup seeds one pick in each tier. Advanced mode lets you reshape the
                        boundaries and pick counts.
                      </p>
                    </div>
                    <button
                      className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40"
                      data-testid="contest-tiered-reset-tiers"
                      onClick={resetTiersFromDefaults}
                      type="button"
                    >
                      Reset tiers
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {tiers.map((tier, index) => (
                      <div
                        className="grid gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 md:grid-cols-[0.8fr_1fr_1fr_0.8fr]"
                        data-testid={`contest-tier-${tier.tierKey}`}
                        key={tier.tierKey}
                      >
                        <label className="space-y-1">
                          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            Tier
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                            data-testid={`contest-tier-label-${tier.tierKey}`}
                            disabled={!showAdvanced}
                            onChange={(event) => updateTier(index, { label: event.target.value })}
                            type="text"
                            value={tier.label}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            Start
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                            data-testid={`contest-tier-start-${tier.tierKey}`}
                            disabled={!showAdvanced}
                            min={1}
                            onChange={(event) =>
                              updateTier(index, {
                                startPosition: Math.max(1, Number(event.target.value) || 1),
                              })}
                            type="number"
                            value={tier.startPosition}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            End
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                            data-testid={`contest-tier-end-${tier.tierKey}`}
                            disabled={!showAdvanced}
                            min={tier.startPosition}
                            onChange={(event) =>
                              updateTier(index, {
                                endPosition: event.target.value
                                  ? Math.max(tier.startPosition, Number(event.target.value) || tier.startPosition)
                                  : null,
                              })}
                            placeholder={index === tiers.length - 1 ? 'Remainder' : undefined}
                            type="number"
                            value={tier.endPosition ?? ''}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            Picks
                          </span>
                          <input
                            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                            data-testid={`contest-tier-pick-count-${tier.tierKey}`}
                            disabled={!showAdvanced}
                            min={1}
                            onChange={(event) =>
                              updateTier(index, {
                                pickCount: Math.max(1, Number(event.target.value) || 1),
                              })}
                            type="number"
                            value={tier.pickCount}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {showAdvanced ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Missed-cut fallback score</span>
                    <input
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
                      data-testid="contest-tiered-fallback-score"
                      min={0}
                      onChange={(event) => setTieredFallbackScore(event.target.value)}
                      type="number"
                      value={tieredFallbackScore}
                    />
                  </label>
                ) : null}
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-border bg-background p-4">
                  <h3 className="font-medium">Enabled categories</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {CATEGORY_OPTIONS.map((category) => {
                      const isSelected = selectedCategories.includes(category.key);
                      return (
                        <label
                          className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm"
                          key={category.key}
                        >
                          <input
                            checked={isSelected}
                            data-testid={`contest-category-toggle-${category.key}`}
                            onChange={() => toggleCategory(category.key)}
                            type="checkbox"
                          />
                          <span>{category.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {showAdvanced ? (
                  <div className="space-y-4 rounded-2xl border border-border bg-background p-4">
                    <h3 className="font-medium">Advanced category settings</h3>
                    <div className="space-y-3">
                      {selectedCategories.map((categoryKey) => (
                        <label className="block space-y-2" key={categoryKey}>
                          <span className="text-sm font-medium">
                            {CATEGORY_OPTIONS.find((category) => category.key === categoryKey)?.label}
                            {' '}pick count
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                            data-testid={`contest-category-pick-count-${categoryKey}`}
                            min={1}
                            onChange={(event) =>
                              setCategoryPickCounts((current) => ({
                                ...current,
                                [categoryKey]: event.target.value,
                              }))}
                            type="number"
                            value={categoryPickCounts[categoryKey] ?? '1'}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium">Missed-cut fallback score</span>
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary"
                        data-testid="contest-category-fallback-score"
                        min={0}
                        onChange={(event) => setCategoryFallbackScore(event.target.value)}
                        type="number"
                        value={categoryFallbackScore}
                      />
                    </label>
                  </div>
                ) : null}
              </>
            )}
            </fieldset>

            {formError ? (
              <div
                className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                data-testid="create-contest-error"
              >
                {formError}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {isDraftEditable ? (
                <button
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="create-contest-submit"
                  disabled={
                    saveContestMutation.isPending
                    || eventsQuery.isError
                    || !eligibleEvents.length
                    || !selectedEvent?.contestEligible
                  }
                  onClick={() => {
                    setFormError(null);
                    void saveContestMutation.mutateAsync().catch(() => undefined);
                  }}
                  type="button"
                >
                  {saveContestMutation.isPending
                    ? (isEditMode ? 'Saving...' : 'Creating...')
                    : (isEditMode ? 'Save draft changes' : 'Create contest')}
                </button>
              ) : null}
              {isEditMode && isDraftEditable ? (
                <button
                  className="rounded-2xl border border-destructive/30 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="contest-delete"
                  disabled={deleteContestMutation.isPending}
                  onClick={() => {
                    setFormError(null);
                    void deleteContestMutation.mutateAsync().catch(() => undefined);
                  }}
                  type="button"
                >
                  {deleteContestMutation.isPending ? 'Deleting...' : 'Delete contest'}
                </button>
              ) : null}
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
                to={buildLeaguePath(leagueQuery.data.leagueCode)}
              >
                Cancel
              </Link>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Current choices</h3>
            <dl className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div>
                <dt className="font-medium text-foreground">League</dt>
                <dd>{leagueQuery.data.name}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Mode</dt>
                <dd>{mode === 'GOLF_TIERED' ? 'Golf tiered contest' : 'Golf category picks'}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Event</dt>
                <dd>{selectedEvent ? selectedEvent.name : 'Choose a golf event'}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Event starts</dt>
                <dd>{selectedEvent ? formatDateTimeDisplay(selectedEvent.startDate) : 'Choose a golf event'}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Locks</dt>
                <dd>{derivedLockAt ? formatDateTimeDisplay(derivedLockAt) : 'Choose a golf event'}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Entries per team</dt>
                <dd>{unlimitedEntries ? 'Unlimited' : maxEntriesPerTeam || '1'}</dd>
              </div>
              {mode === 'GOLF_TIERED' ? (
                <>
                  <div>
                    <dt className="font-medium text-foreground">Golfers picked</dt>
                    <dd>{rosterSize}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Count best</dt>
                    <dd>{countedScores}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-foreground">Tier source</dt>
                    <dd>{tierSource === 'ODDS' ? 'Odds' : 'World rank'}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt className="font-medium text-foreground">Enabled categories</dt>
                  <dd>{selectedCategories.length}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Lifecycle truth</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>Creating a contest makes it immediately live for league entries.</li>
              <li>Lock time is configured relative to the event start, then stored as an exact timestamp.</li>
              <li>Locked, in-progress, and completed states should follow event timing and feed updates automatically.</li>
            </ul>
          </div>

          {eventsQuery.isError ? (
            <div className="rounded-[2rem] border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
              We couldn&apos;t load golf events. Contest creation needs an imported event before a
              commissioner can continue.
            </div>
          ) : !eligibleEvents.length ? (
            <div
              className="rounded-[2rem] border border-sky-200 bg-sky-50 p-6 text-sm text-sky-950"
              data-testid="create-contest-no-events"
            >
              <h3 className="text-lg font-semibold">No golf events are currently available for contest setup.</h3>
              <p className="mt-2 text-sky-900/90">
                PoolMaster only shows real imported events once they are released and the field is
                loaded. Check back when the next tournament reaches contest-ready status.
              </p>
              {unavailableEvents.length ? (
                <ul className="mt-4 space-y-2 text-sky-900/90">
                  {unavailableEvents.slice(0, 3).map((event) => (
                    <li key={event.id}>
                      {event.name}
                      {' · '}
                      {formatReadinessLabel(event)}
                      {' · '}
                      {formatReadinessReasons(event)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

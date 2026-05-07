import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  GetManagedContestResponses,
  GetLeagueByCodeResponses,
  ListManagedContestTemplatesResponses,
  ListEventsResponses,
} from '@/lib/api';
import type { CreateContestManagementRequest, UpdateContestRequest } from '@poolmaster/shared/dto';
import {
  ContestFormat,
  Sport,
  getDefaultTournamentFormatForSport,
  getValidContestFormatsForTournamentFormat,
} from '@poolmaster/shared/domain';
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
import { getLogger } from '@/lib/logger';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueContestPath,
  buildLeaguePath,
  buildLeagueTeamPath,
} from '@/features/leagues/league-routing';
import {
  Alert,
  Button,
  ErrorState,
  FormField,
  Input,
  LinkButton,
  LoadingState,
  Select,
  SplitContentLayout,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import {
  ContestSetupSummary,
  ContestTemplatePicker,
  EventReadinessPanel,
  NoEligibleEventsAlert,
  TierSettingsEditor,
  type TierDefinition,
  type TierDefinitionUpdate,
} from './contest-configuration-sections';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { createMutationHook } from '@/lib/mutation-hooks';

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
const DEFAULT_CREATE_SPORT = Sport.GOLF;

const LOCK_PRESET_OPTIONS: Array<{
  value: LockPreset;
  label: string;
  minutes: number | null;
}> = [
  { value: 'FIVE_MINUTES', label: '5 minutes before start', minutes: 5 },
  { value: 'ONE_HOUR', label: '1 hour before start', minutes: 60 },
  { value: 'CUSTOM', label: 'Custom', minutes: null },
];

function buildTierKey(index: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return alphabet[index] ?? `T${index + 1}`;
}

function buildSeededTiers(tierCount: number, defaultTierSize: number, pickCount = 1): TierDefinition[] {
  return Array.from({ length: tierCount }, (_, index) => ({
    tierKey: buildTierKey(index),
    label: `Tier ${buildTierKey(index)}`,
    pickCount,
    startPosition: index * defaultTierSize + 1,
    endPosition: index === tierCount - 1 ? null : (index + 1) * defaultTierSize,
  }));
}

function getTierShape(tiers: TierDefinition[], fallbackRosterSize: number) {
  const tierCount = Math.max(1, tiers.length || 1);
  const fallbackPicksPerTier = Math.max(1, Math.ceil(fallbackRosterSize / tierCount));

  return {
    tierCount,
    picksPerTier: Math.max(1, tiers[0]?.pickCount ?? fallbackPicksPerTier),
  };
}

function getTierFieldValidationMessage(
  tiers: TierDefinition[],
  participantCount: number | null | undefined,
) {
  if (participantCount == null || participantCount < 1) {
    return null;
  }

  const invalidStartTier = tiers.find((tier) => tier.startPosition > participantCount);
  if (invalidStartTier) {
    return `${invalidStartTier.label} starts at field position ${invalidStartTier.startPosition}, but the selected event has only ${participantCount} participants.`;
  }

  const undersizedTier = tiers.find((tier) => {
    const endPosition = Math.min(tier.endPosition ?? participantCount, participantCount);
    return endPosition - tier.startPosition + 1 < tier.pickCount;
  });
  if (undersizedTier) {
    return `${undersizedTier.label} does not contain enough participants for ${undersizedTier.pickCount} picks.`;
  }

  return null;
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
  const logger = getLogger().child({
    feature: 'create-contest-page',
  });
  const { leagueCode = '', contestId } = useParams<{ leagueCode: string; contestId?: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
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
    queryKey: QueryKeys.leagues.detail(leagueCode),
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
    queryKey: QueryKeys.sportEvents.list({ sport: DEFAULT_CREATE_SPORT }),
    queryFn: async (): Promise<SportEventSummary[]> => {
      const response = await listEvents({
        query: {
          sport: DEFAULT_CREATE_SPORT,
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

  const selectedEventSport = useMemo(() => {
    const eventSport = eventsQuery.data?.find((event) => event.id === sportEventId)
      ?.sport as Sport | undefined;
    return eventSport ?? DEFAULT_CREATE_SPORT;
  }, [eventsQuery.data, sportEventId]);
  const selectedContestFormats = useMemo(
    () =>
      getValidContestFormatsForTournamentFormat(
        getDefaultTournamentFormatForSport(selectedEventSport),
      ),
    [selectedEventSport],
  );
  const selectedContestFormat =
    selectedContestFormats.includes(ContestFormat.ROSTER)
      ? ContestFormat.ROSTER
      : selectedContestFormats[0] ?? ContestFormat.ROSTER;

  const managedContestQuery = useQuery({
    queryKey: QueryKeys.managedContests.byLeagueAndContest(leagueQuery.data?.id, contestId),
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
    queryKey: QueryKeys.managedContests.templates(
      leagueQuery.data?.id,
      selectedEventSport,
      selectedContestFormat,
    ),
    queryFn: async (): Promise<ManagedContestTemplate[]> => {
      const response = await listManagedContestTemplates({
        path: { id: leagueQuery.data!.id },
        query: {
          sport: selectedEventSport,
          contestFormat: selectedContestFormat,
        },
      });

      if (!response.data?.templates) {
        throw response.error ?? new Error('Contest template response is missing data.');
      }

      return response.data.templates;
    },
    enabled: Boolean(leagueQuery.data?.id && selectedContestFormat),
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
    if (!eventsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestCreate.events.loaded',
        data: {
          leagueCode,
          eventCount: eventsQuery.data.length,
          eligibleCount: eligibleEvents.length,
          unavailableCount: unavailableEvents.length,
          events: eventsQuery.data.map((event) => ({
            id: event.id,
            sport: event.sport,
            name: event.name,
            status: event.status,
            startDate: event.startDate,
            releaseAt: event.releaseAt,
            fieldLocksAt: event.fieldLocksAt,
            participantCount: event.participantCount,
            fieldLocked: event.fieldLocked,
            readinessStatus: event.readinessStatus,
            readinessReasons: event.readinessReasons,
            contestEligible: event.contestEligible,
          })),
        },
      },
      'Contest create page loaded sport events',
    );
  }, [eligibleEvents.length, eventsQuery.data, leagueCode, logger, unavailableEvents.length]);

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
          eligibleEventCount: eligibleEvents.length,
          unavailableEventCount: unavailableEvents.length,
          templateCount: visibleTemplates.length,
          isEditMode,
        },
      },
      'Contest create page loaded',
    );
  }, [
    eligibleEvents.length,
    eventsQuery.data,
    isEditMode,
    leagueCode,
    leagueQuery.data,
    logger,
    unavailableEvents.length,
    visibleTemplates.length,
  ]);

  const saveContestMutation = createMutationHook({
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
        throw new Error('Select an event before creating the contest.');
      }

      if (!selectedEvent.contestEligible) {
        throw new Error('Select a contest-ready event before creating the contest.');
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

              const tierFieldValidationMessage = getTierFieldValidationMessage(
                tiers,
                selectedEvent?.participantCount,
              );
              if (tierFieldValidationMessage) {
                throw new Error(tierFieldValidationMessage);
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
          contestFormat: ContestFormat.ROSTER,
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
      navigate(buildLeagueContestPath(leagueCode, savedContestId), {
        state: { leagueCode },
      });
    },
    invalidates: (savedContestId) => [
      QueryKeys.contests.list({ leagueId: leagueQuery.data?.id }),
      QueryKeys.contests.detail(savedContestId),
      QueryKeys.managedContests.detail(savedContestId),
    ],
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
      setFormError(extractErrorMessage(error, { fallback: 'We could not create that contest. Please try again.' }));
    },
  });

  const deleteContestMutation = createMutationHook({
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
      navigate(buildLeaguePath(leagueCode));
    },
    invalidates: [QueryKeys.contests.list({ leagueId: leagueQuery.data?.id })],
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
      setFormError(extractErrorMessage(error, { fallback: 'We could not create that contest. Please try again.' }));
    },
  });

  function resetTiersFromDefaults() {
    const templateTiers =
      selectedTemplate?.configuration.mode === 'GOLF_TIERED'
        ? selectedTemplate.configuration.tiers
        : [];
    const sourceTiers = templateTiers.length ? templateTiers : tiers;
    const parsedRosterSize = Math.max(1, Number(rosterSize) || 1);
    const { tierCount, picksPerTier } = getTierShape(sourceTiers, parsedRosterSize);

    setTiers(
      buildSeededTiers(
        tierCount,
        Math.max(1, Number(defaultTierSize) || 1),
        picksPerTier,
      ),
    );
  }

  function updateTier(index: number, updates: TierDefinitionUpdate) {
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
    Boolean(leagueQuery.data?.leagueRelationship.commissioner) || Boolean(leagueQuery.data?.isRootAdmin);
  const isDraftEditable = !isEditMode || managedContestQuery.data?.status === 'DRAFT';

  const isManagedContestHydrating =
    isEditMode && Boolean(managedContestQuery.data) && !isHydratedFromManagedContest;

  if (
    leagueQuery.isLoading
    || eventsQuery.isLoading
    || managedContestQuery.isLoading
    || templatesQuery.isLoading
    || isManagedContestHydrating
  ) {
    return (
      <LoadingState
        body="Loading contest setup..."
        testId="create-contest-page-loading"
      />
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
      <ErrorState
        body={copy.body}
        testId="create-contest-page-error"
        title={copy.title}
      />
    );
  }

  if (!isCommissioner) {
    return (
      <ErrorState
        action={(
          <LinkButton to={buildLeaguePath(leagueQuery.data.leagueCode)} variant="secondary">
            Back to league home
          </LinkButton>
        )}
        body="Contest configuration stays limited to commissioners so the league uses one consistent contest setup flow."
        testId="create-contest-page-unauthorized"
        title="Commissioner access required"
      />
    );
  }

  return (
    <section
      className="space-y-6"
      data-testid={isEditMode ? 'manage-contest-page' : 'create-contest-page'}
    >
      <Tile padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <StatusBadge tone="info">
              Commissioner contest setup
            </StatusBadge>
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
            <LinkButton
              to={buildLeaguePath(leagueQuery.data.leagueCode)}
              variant="secondary"
            >
              Back to league
            </LinkButton>
            <LinkButton
              to={buildLeagueTeamPath(leagueQuery.data.leagueCode)}
              variant="secondary"
            >
              My Team
            </LinkButton>
          </div>
        </div>
      </Tile>

      <SplitContentLayout
        main={(
          <Tile>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="contest-mode-tiered"
              onClick={() => selectDefaultTemplateForMode('GOLF_TIERED')}
              variant={mode === 'GOLF_TIERED' ? 'primary' : 'secondary'}
            >
              Tiered contest
            </Button>
            <Button
              data-testid="contest-mode-category"
              disabled={!isEditMode}
              onClick={() => selectDefaultTemplateForMode('GOLF_CATEGORY_PICKS')}
              title={
                isEditMode
                  ? undefined
                  : 'Category picks are available when editing a category-picks contest.'
              }
              variant={mode === 'GOLF_CATEGORY_PICKS' ? 'primary' : 'secondary'}
            >
              Category picks
            </Button>
            <Button
              data-testid="contest-toggle-advanced"
              onClick={() => setShowAdvanced((current) => !current)}
              variant="secondary"
            >
              {showAdvanced ? 'Hide advanced' : 'Show advanced'}
            </Button>
          </div>

          <div className="mt-6 space-y-5">
            {isEditMode && !isDraftEditable ? (
              <Alert data-testid="contest-manage-readonly-note">
                Contest structure is no longer editable. Lock, in-progress, and completed states
                follow the real event timing and feed updates automatically.
              </Alert>
            ) : null}

            <fieldset className="space-y-5" disabled={!isDraftEditable}>
            <ContestTemplatePicker
              isEditMode={isEditMode}
              onSelectTemplate={selectTemplate}
              selectedTemplateId={selectedTemplateId}
              templates={visibleTemplates}
            />

            <FormField label="Contest name">
              <Input
                data-testid="contest-name"
                onChange={(event) => setContestName(event.target.value)}
                placeholder="Masters Pick 6"
                type="text"
                value={contestName}
              />
            </FormField>

            <FormField label="Golf event">
              <Select
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
              </Select>
            </FormField>

            {selectedEvent ? (
              <EventReadinessPanel
                event={selectedEvent}
                formatDateTimeDisplay={formatDateTimeDisplay}
                formatReadinessLabel={formatReadinessLabel}
                formatReadinessReasons={formatReadinessReasons}
              />
            ) : null}

            <Tile className="space-y-3" padding="sm" radius="lg" variant="subtle">
              <div>
                <div className="text-sm font-medium">Lock time</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Prime Time Commissioner stores an exact lock timestamp, but commissioners configure it
                  relative to the event start.
                </p>
              </div>
              <FormField label="Lock entries">
                <Select
                  data-testid="contest-lock-preset"
                  onChange={(event) => setLockPreset(event.target.value as LockPreset)}
                  value={lockPreset}
                >
                  {LOCK_PRESET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              {lockPreset === 'CUSTOM' ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="Hours before start">
                    <Input
                      data-testid="contest-lock-custom-hours"
                      min={0}
                      onChange={(event) => setCustomLockHours(event.target.value)}
                      type="number"
                      value={customLockHours}
                    />
                  </FormField>
                  <FormField label="Minutes before start">
                    <Input
                      data-testid="contest-lock-custom-minutes"
                      min={0}
                      onChange={(event) => setCustomLockMinutes(event.target.value)}
                      type="number"
                      value={customLockMinutes}
                    />
                  </FormField>
                </div>
              ) : null}
              <Alert title="Resolved lock timestamp">
                <div data-testid="contest-lock-summary">
                  {derivedLockAt ? formatDateTimeDisplay(derivedLockAt) : 'Select a golf event first'}
                </div>
              </Alert>
            </Tile>

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
                <Input
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
                  <FormField label="Golfers picked">
                    <Input
                      data-testid="contest-tiered-roster-size"
                      min={1}
                      onChange={(event) => setRosterSize(event.target.value)}
                      type="number"
                      value={rosterSize}
                    />
                  </FormField>
                  <FormField label="Count best">
                    <Input
                      data-testid="contest-tiered-counted-scores"
                      min={1}
                      onChange={(event) => setCountedScores(event.target.value)}
                      type="number"
                      value={countedScores}
                    />
                  </FormField>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="Tier source">
                    <Select
                      data-testid="contest-tiered-source"
                      onChange={(event) => setTierSource(event.target.value as TierSource)}
                      value={tierSource}
                    >
                      <option value="ODDS">Odds</option>
                      <option value="WORLD_RANK">World rank</option>
                    </Select>
                  </FormField>
                  <FormField label="Default tier size">
                    <Input
                      data-testid="contest-tiered-default-tier-size"
                      min={1}
                      onChange={(event) => setDefaultTierSize(event.target.value)}
                      type="number"
                      value={defaultTierSize}
                    />
                  </FormField>
                </div>

                <TierSettingsEditor
                  isDraftEditable={isDraftEditable}
                  onResetTiers={resetTiersFromDefaults}
                  onUpdateTier={updateTier}
                  tiers={tiers}
                />

                {showAdvanced ? (
                  <FormField label="Missed-cut fallback score">
                    <Input
                      data-testid="contest-tiered-fallback-score"
                      min={0}
                      onChange={(event) => setTieredFallbackScore(event.target.value)}
                      type="number"
                      value={tieredFallbackScore}
                    />
                  </FormField>
                ) : null}
              </>
            ) : (
              <>
                <Tile padding="sm" radius="lg" variant="subtle">
                  <h3 className="font-medium">Enabled categories</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {CATEGORY_OPTIONS.map((category) => {
                      const isSelected = selectedCategories.includes(category.key);
                      return (
                        <Tile key={category.key} padding="sm" radius="lg" variant="default">
                          <label className="flex items-center gap-3 text-sm">
                            <input
                              checked={isSelected}
                              data-testid={`contest-category-toggle-${category.key}`}
                              onChange={() => toggleCategory(category.key)}
                              type="checkbox"
                            />
                            <span>{category.label}</span>
                          </label>
                        </Tile>
                      );
                    })}
                  </div>
                </Tile>

                {showAdvanced ? (
                  <Tile className="space-y-4" padding="sm" radius="lg" variant="subtle">
                    <h3 className="font-medium">Advanced category settings</h3>
                    <div className="space-y-3">
                      {selectedCategories.map((categoryKey) => {
                        const categoryLabel = CATEGORY_OPTIONS.find((category) => category.key === categoryKey)?.label;
                        return (
                          <FormField key={categoryKey} label={`${categoryLabel ?? categoryKey} pick count`}>
                            <Input
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
                          </FormField>
                        );
                      })}
                    </div>
                    <FormField label="Missed-cut fallback score">
                      <Input
                        data-testid="contest-category-fallback-score"
                        min={0}
                        onChange={(event) => setCategoryFallbackScore(event.target.value)}
                        type="number"
                        value={categoryFallbackScore}
                      />
                    </FormField>
                  </Tile>
                ) : null}
              </>
            )}
            </fieldset>

            {formError ? (
              <Alert
                data-testid="create-contest-error"
                tone="danger"
              >
                {formError}
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              {isDraftEditable ? (
                <Button
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
                >
                  {saveContestMutation.isPending
                    ? (isEditMode ? 'Saving...' : 'Creating...')
                    : (isEditMode ? 'Save draft changes' : 'Create contest')}
                </Button>
              ) : null}
              {isEditMode && isDraftEditable ? (
                <Button
                  data-testid="contest-delete"
                  disabled={deleteContestMutation.isPending}
                  onClick={() => {
                    setFormError(null);
                    void deleteContestMutation.mutateAsync().catch(() => undefined);
                  }}
                  variant="danger"
                >
                  {deleteContestMutation.isPending ? 'Deleting...' : 'Delete contest'}
                </Button>
              ) : null}
              <LinkButton
                to={buildLeaguePath(leagueQuery.data.leagueCode)}
                variant="secondary"
              >
                Cancel
              </LinkButton>
            </div>
          </div>
          </Tile>
        )}
        aside={(
          <>
          <ContestSetupSummary
            items={[
              { id: 'league', label: 'League', value: leagueQuery.data.name },
              { id: 'mode', label: 'Mode', value: mode === 'GOLF_TIERED' ? 'Golf tiered contest' : 'Golf category picks' },
              { id: 'event', label: 'Event', value: selectedEvent ? selectedEvent.name : 'Choose a golf event' },
              {
                id: 'event-starts',
                label: 'Event starts',
                value: selectedEvent ? formatDateTimeDisplay(selectedEvent.startDate) : 'Choose a golf event',
              },
              { id: 'locks', label: 'Locks', value: derivedLockAt ? formatDateTimeDisplay(derivedLockAt) : 'Choose a golf event' },
              { id: 'entries-per-team', label: 'Entries per team', value: unlimitedEntries ? 'Unlimited' : maxEntriesPerTeam || '1' },
              ...(mode === 'GOLF_TIERED'
                ? [
                    { id: 'golfers-picked', label: 'Golfers picked', value: rosterSize },
                    { id: 'count-best', label: 'Count best', value: countedScores },
                    { id: 'tier-source', label: 'Tier source', value: tierSource === 'ODDS' ? 'Odds' : 'World rank' },
                  ]
                : [
                    { id: 'enabled-categories', label: 'Enabled categories', value: selectedCategories.length },
                  ]),
            ]}
          />

          <Tile>
            <h3 className="text-xl font-semibold">Lifecycle truth</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>Creating a contest makes it immediately live for league entries.</li>
              <li>Lock time is configured relative to the event start, then stored as an exact timestamp.</li>
              <li>Locked, in-progress, and completed states should follow event timing and feed updates automatically.</li>
            </ul>
          </Tile>

          {eventsQuery.isError ? (
            <Alert tone="danger">
              We couldn&apos;t load golf events. Contest creation needs an imported event before a
              commissioner can continue.
            </Alert>
          ) : !eligibleEvents.length ? (
            <NoEligibleEventsAlert
              events={unavailableEvents}
              formatReadinessLabel={formatReadinessLabel}
              formatReadinessReasons={formatReadinessReasons}
            />
          ) : null}
          </>
        )}
      />
    </section>
  );
}

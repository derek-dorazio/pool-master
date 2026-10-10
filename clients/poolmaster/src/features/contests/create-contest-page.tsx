import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useForm,
  type FieldErrors,
  type FieldPath,
  type FieldPathValue,
} from 'react-hook-form';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import type { SportEventDto, ContestConfigTemplateDto } from '@/lib/api';
import type { CreateContestRequest } from '@poolmaster/shared/dto';
import {
  ContestFormat,
  SelectionType,
  Sport,
  getDefaultCountedScores,
  getDefaultTournamentFormatForSport,
  getTieredRosterSize,
  getValidContestFormatsForTournamentFormat,
} from '@poolmaster/shared/domain';
import { createContest, listContestConfigTemplates, listEvents } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { getLogger } from '@/lib/logger';
import {
  buildLeagueAdminContestPath,
  buildLeagueAdminContestsPath,
} from '@/features/leagues/league-routing';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';
import {
  Alert,
  Button,
  Checkbox,
  ErrorState,
  formatDateDisplay,
  FormField,
  Input,
  LinkButton,
  LoadingState,
  PageHeader,
  Select,
  SplitContentLayout,
  Tile,
} from '@/features/shared/ui';
import {
  ContestSetupSummary,
  ContestTemplatePicker,
  EventReadinessPanel,
  NoEligibleEventsAlert,
} from './contest-configuration-sections';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

type ContestConfigTemplate = ContestConfigTemplateDto;

const contestSetupFormSchema = z.object({
  contestName: z.string().trim().min(1, 'Contest name is required.'),
  sportEventId: z.string().trim().min(1, 'Select an event before creating the contest.'),
  selectedTemplateId: z.string(),
  unlimitedEntries: z.boolean(),
  maxEntriesPerTeam: z.string(),
  picksPerTier: z.string(),
  countedScores: z.string(),
});

type ContestSetupFormValues = z.infer<typeof contestSetupFormSchema>;

function getContestFormErrorMessage(errors: FieldErrors<ContestSetupFormValues>) {
  return (
    errors.contestName?.message
    ?? errors.sportEventId?.message
    ?? errors.selectedTemplateId?.message
    ?? 'Review the contest setup fields before saving.'
  );
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

function formatReadinessLabel(event: SportEventDto) {
  switch (event.readinessStatus) {
    case 'CONTEST_ELIGIBLE':
      return 'Contest ready';
    case 'PENDING_FIELD':
      return 'Waiting for field';
    case 'EVENT_STARTED':
      return 'Already started';
    case 'NOT_RELEASED':
    default:
      return 'Not released yet';
  }
}

function formatReadinessReasons(event: SportEventDto) {
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
        case 'EVENT_STARTED':
          return 'already started';
        default:
          return 'readiness status unavailable';
      }
    })
    .join(', ');
}

function sortEventsForPicker(events: SportEventDto[]) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.startDate);
    const rightTime = Date.parse(right.startDate);
    return leftTime - rightTime;
  });
}

export function CreateContestPage() {
  const logger = getLogger().child({
    feature: 'create-contest-page',
  });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const navigate = useNavigate();

  const contestForm = useForm<ContestSetupFormValues>({
    resolver: zodResolver(contestSetupFormSchema),
    defaultValues: {
      contestName: '',
      sportEventId: '',
      selectedTemplateId: '',
      unlimitedEntries: false,
      maxEntriesPerTeam: '1',
      picksPerTier: '1',
      countedScores: '4',
    },
  });
  const {
    contestName,
    sportEventId,
    selectedTemplateId,
    unlimitedEntries,
    maxEntriesPerTeam,
    picksPerTier,
    countedScores,
  } = contestForm.watch();
  const [formError, setFormError] = useState<string | null>(null);
  const parsedPicksPerTierValue = Number(picksPerTier);
  const parsedCountedScoresValue = Number(countedScores);

  const setContestFormValue = useCallback(<Field extends FieldPath<ContestSetupFormValues>>(
    field: Field,
    value: FieldPathValue<ContestSetupFormValues, Field>,
  ) => {
    contestForm.setValue(field, value, {
      shouldDirty: true,
      shouldValidate: false,
    });
  }, [contestForm]);

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { league } = useLeagueContext(leagueCode);

  const eventsQuery = useQuery({
    queryKey: QueryKeys.sportEvents.list({ sport: Sport.GOLF }),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({
        query: {
          sport: Sport.GOLF,
        },
      });

      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }

      return sortEventsForPicker(response.data.events);
    },
    enabled: auth.isAuthenticated,
    retry: false,
  });

  const selectedEventSport = useMemo(() => {
    const eventSport = eventsQuery.data?.find((event) => event.id === sportEventId)
      ?.sport as Sport | undefined;
    return eventSport ?? Sport.GOLF;
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

  const templatesQuery = useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({
      sport: selectedEventSport,
      contestFormat: selectedContestFormat,
      active: true,
    }),
    queryFn: async (): Promise<ContestConfigTemplate[]> => {
      const response = await listContestConfigTemplates({
        query: {
          sport: selectedEventSport,
          contestFormat: selectedContestFormat,
          active: true,
        },
      });

      if (!response.data?.templates) {
        throwApiError(response.error, 'Contest template response is missing data.');
      }

      return response.data.templates;
    },
    enabled: Boolean(league?.id && selectedContestFormat),
    retry: false,
  });

  const selectedEvent = useMemo(
    () => eventsQuery.data?.find((event) => event.id === sportEventId) ?? null,
    [eventsQuery.data, sportEventId],
  );
  // The roster is derived (#479): the selected event's tier count times picks per tier.
  const tierCount = selectedEvent?.tierCount ?? 0;
  const rosterSizeLabel =
    tierCount > 0 && Number.isInteger(parsedPicksPerTierValue) && parsedPicksPerTierValue >= 1
      ? String(getTieredRosterSize(tierCount, parsedPicksPerTierValue))
      : '—';
  // Create needs a template, a complete configuration, or both (#245); the server answers the
  // empty state with CONTEST_CONFIGURATION_REQUIRED, and this keeps the form from reaching it.
  const configurationComplete =
    Number.isInteger(parsedPicksPerTierValue)
    && parsedPicksPerTierValue >= 1
    && Number.isInteger(parsedCountedScoresValue)
    && parsedCountedScoresValue >= 1
    && (tierCount === 0 || parsedCountedScoresValue <= getTieredRosterSize(tierCount, parsedPicksPerTierValue));
  const createNeedsConfiguration = !selectedTemplateId && !configurationComplete;
  // "Scores that count" follows picks per tier: changing it resets the count to the default.
  const changePicksPerTier = useCallback((value: string) => {
    setContestFormValue('picksPerTier', value);
    const parsed = Number(value);
    if (tierCount > 0 && Number.isInteger(parsed) && parsed >= 1) {
      setContestFormValue('countedScores', String(getDefaultCountedScores(tierCount, parsed)));
    }
  }, [setContestFormValue, tierCount]);
  // Create starts "Scores that count" at the default for the chosen event's tiers. A selected
  // template whose picks per tier the form still holds keeps its own count over the formula.
  useEffect(() => {
    if (tierCount === 0) {
      return;
    }
    const parsed = Number(contestForm.getValues('picksPerTier'));
    const selectedTemplate = templatesQuery.data?.find(
      (template) => template.id === contestForm.getValues('selectedTemplateId'),
    );
    if (selectedTemplate?.configuration.picksPerTier === parsed) {
      return;
    }
    if (Number.isInteger(parsed) && parsed >= 1) {
      setContestFormValue('countedScores', String(getDefaultCountedScores(tierCount, parsed)));
    }
  }, [contestForm, setContestFormValue, templatesQuery.data, tierCount]);
  const eligibleEvents = useMemo(
    () => eventsQuery.data?.filter((event) => event.contestEligible) ?? [],
    [eventsQuery.data],
  );
  const unavailableEvents = useMemo(
    () => eventsQuery.data?.filter((event) => !event.contestEligible) ?? [],
    [eventsQuery.data],
  );
  const visibleTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.selectionType === SelectionType.TIERED),
    [templatesQuery.data],
  );
  const applyTemplateConfiguration = useCallback((
    configuration: ContestConfigTemplate['configuration'],
  ) => {
    setContestFormValue('unlimitedEntries', configuration.maxEntriesPerSquad == null);
    setContestFormValue(
      'maxEntriesPerTeam',
      configuration.maxEntriesPerSquad == null
        ? '1'
        : String(configuration.maxEntriesPerSquad),
    );
    setContestFormValue('picksPerTier', String(configuration.picksPerTier));
    setContestFormValue('countedScores', String(configuration.countedScores));
  }, [setContestFormValue]);

  const selectTemplate = useCallback((templateId: string) => {
    setContestFormValue('selectedTemplateId', templateId);
    const template = templatesQuery.data?.find((entry) => entry.id === templateId);
    if (template) {
      applyTemplateConfiguration(template.configuration);
    }
  }, [applyTemplateConfiguration, setContestFormValue, templatesQuery.data]);

  // Create picks the first contest-ready event.
  useEffect(() => {
    if (sportEventId && eligibleEvents.some((event) => event.id === sportEventId)) {
      return;
    }

    if (eligibleEvents.length) {
      setContestFormValue('sportEventId', eligibleEvents[0].id);
    }
  }, [eligibleEvents, setContestFormValue, sportEventId]);

  useEffect(() => {
    if (selectedTemplateId || !visibleTemplates.length) {
      return;
    }

    const defaultTemplate =
      visibleTemplates.find((template) => template.isDefault)
      ?? visibleTemplates[0];

    if (defaultTemplate) {
      selectTemplate(defaultTemplate.id);
    }
  }, [selectTemplate, selectedTemplateId, visibleTemplates]);

  useEffect(() => {
    if (eventsQuery.isError) {
      logger.warn(
        {
          action: 'contestCreate.events.failed',
          data: {
            leagueCode,
          },
          err: eventsQuery.error,
        },
        'Contest create page failed to load events',
      );
    }
  }, [eventsQuery.error, eventsQuery.isError, leagueCode, logger]);

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
            participantCount: event.participantCount,
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
    if (!league || !eventsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'contestCreate.page.loaded',
        data: {
          leagueCode,
          leagueId: league.id,
          eventCount: eventsQuery.data.length,
          eligibleEventCount: eligibleEvents.length,
          unavailableEventCount: unavailableEvents.length,
          templateCount: visibleTemplates.length,
        },
      },
      'Contest create page loaded',
    );
  }, [
    eligibleEvents.length,
    eventsQuery.data,
    leagueCode,
    league,
    logger,
    unavailableEvents.length,
    visibleTemplates.length,
  ]);

  const saveContestMutation = useInvalidatingMutation({
    mutationFn: async (values: ContestSetupFormValues) => {
      if (!league?.id) {
        throw new Error('League detail is still loading.');
      }

      const selectedEventForSubmission =
        eventsQuery.data?.find((event) => event.id === values.sportEventId) ?? null;
      const selectedTemplateForSubmission =
        templatesQuery.data?.find((template) => template.id === values.selectedTemplateId) ?? null;
      const trimmedName = values.contestName.trim();
      const parsedMaxEntries = values.unlimitedEntries ? undefined : Number(values.maxEntriesPerTeam);

      if (!trimmedName) {
        throw new Error('Contest name is required.');
      }

      if (!values.sportEventId || !selectedEventForSubmission) {
        throw new Error('Select an event before creating the contest.');
      }

      if (!selectedEventForSubmission.contestEligible) {
        throw new Error('Select a contest-ready event before creating the contest.');
      }

      if (
        !values.unlimitedEntries
        && (!Number.isInteger(parsedMaxEntries) || (parsedMaxEntries ?? 0) < 1)
      ) {
        throw new Error('Max entries per team must be a positive whole number.');
      }

      const parsedPicksPerTier = Number(values.picksPerTier);
      const parsedCountedScores = Number(values.countedScores);

      if (!Number.isInteger(parsedPicksPerTier) || parsedPicksPerTier < 1) {
        throw new Error('Picks per tier must be a positive whole number.');
      }

      // An event with no tiers yet has no roster to check against; the server skips it too.
      const submittedRosterSize = getTieredRosterSize(tierCount, parsedPicksPerTier);
      if (
        !Number.isInteger(parsedCountedScores)
        || parsedCountedScores < 1
        || (tierCount > 0 && parsedCountedScores > submittedRosterSize)
      ) {
        throw new Error(
          tierCount > 0
            ? `Scores that count must be between 1 and the ${submittedRosterSize} golfers picked.`
            : 'Scores that count must be a positive whole number.',
        );
      }

      const configuration = {
        picksPerTier: parsedPicksPerTier,
        countedScores: parsedCountedScores,
        ...(parsedMaxEntries !== undefined
          ? { maxEntriesPerSquad: parsedMaxEntries }
          : {}),
      };

      // A template is an optional first step; the configuration the form holds is always
      // complete here (validated above), so it is sent either way and, with a template,
      // replaces the template's.
      const body: CreateContestRequest = {
        name: trimmedName,
        sportEventId: values.sportEventId,
        contestFormat: ContestFormat.ROSTER,
        selectionType: SelectionType.TIERED,
        ...(selectedTemplateForSubmission ? { templateId: selectedTemplateForSubmission.id } : {}),
        configuration,
      };

      const response = await createContest({
        path: { id: league.id },
        body,
      });

      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest creation response is missing data.');
      }

      return response.data.contest.id;
    },
    onMutate: (values) => {
      logger.debug(
        {
          action: 'contest.create.started',
          data: {
            leagueCode,
            sportEventId: values.sportEventId,
          },
        },
        'Starting contest create flow',
      );
    },
    onSuccess: (savedContestId: string) => {
      logger.info(
        {
          action: 'contest.create.succeeded',
          data: {
            leagueCode,
            contestId: savedContestId,
            sportEventId,
          },
        },
        'Created contest successfully',
      );
      // A new contest is not open yet (#117): the commissioner lands on its page, where they can
      // still edit or delete it and open it to the league when it is ready.
      navigate(buildLeagueAdminContestPath(leagueCode, savedContestId), { state: { leagueCode } });
    },
    invalidates: (savedContestId) => [
      QueryKeys.contests.list({ leagueId: league?.id }),
      QueryKeys.contests.detail(savedContestId),
      QueryKeys.managedContests.all,
    ],
    onError: (error) => {
      const payload = {
        action: 'contest.create.failed',
        data: {
          leagueCode,
          sportEventId,
        },
        err: error,
      };

      // ApiError wraps every SDK rejection (see throwApiError) so it is
      // always `instanceof Error`; check for it explicitly rather than
      // `error instanceof Error` to keep distinguishing an expected API
      // rejection from a genuine unexpected exception.
      if (!(error instanceof ApiError)) {
        logger.error(payload, 'Contest create failed unexpectedly');
      } else {
        logger.warn(payload, 'Contest create was rejected');
      }
      setFormError(extractErrorMessage(error, {
        codeMessages: CONTEST_RELEASE_CODE_MESSAGES,
        fallback: 'We could not create that contest. Please try again.',
      }));
    },
  });

  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  if (!league) {
    return null;
  }

  if (
    eventsQuery.isLoading
    || templatesQuery.isLoading
  ) {
    return (
      <LoadingState
        body="Loading contest setup..."
        testId="create-contest-page-loading"
      />
    );
  }

  if (templatesQuery.isError) {
    return (
      <ErrorState
        body="Try again in a moment."
        testId="create-contest-page-error"
        title="We couldn't load this contest's setup."
      />
    );
  }

  return (
    <section
      className="space-y-6"
      data-testid="create-contest-page"
    >
      <PageHeader
        description="Set up a tiered golf contest for your league."
        title="Create a golf contest"
      />

      <SplitContentLayout
        main={(
          <Tile>
          <div className="mt-6 space-y-5">
            <ContestTemplatePicker
              onSelectTemplate={selectTemplate}
              selectedTemplateId={selectedTemplateId}
              templates={visibleTemplates}
            />

            <FormField label="Contest name">
              <Input
                data-testid="contest-name"
                onChange={(event) => setContestFormValue('contestName', event.target.value)}
                placeholder="Masters Pick 6"
                type="text"
                value={contestName}
              />
            </FormField>

            <FormField label="Golf event">
              <Select
                data-testid="contest-sport-event"
                onChange={(event) => {
                  setContestFormValue('sportEventId', event.target.value);
                }}
                value={sportEventId}
              >
                <option value="">Select an event</option>
                {eligibleEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                    {' · '}
                    {formatDateDisplay(event.startDate)}
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

            <div className="space-y-3">
              <div className="text-sm font-medium">Entries per team</div>
              <label className="flex items-center gap-3 text-sm text-foreground">
                <Checkbox
                  checked={unlimitedEntries}
                  data-testid="contest-max-entries-unlimited"
                  onChange={(event) => setContestFormValue('unlimitedEntries', event.target.checked)}
                />
                Unlimited
              </label>
              {!unlimitedEntries ? (
                <Input
                  data-testid="contest-max-entries"
                  min={1}
                  onChange={(event) => setContestFormValue('maxEntriesPerTeam', event.target.value)}
                  type="number"
                  value={maxEntriesPerTeam}
                />
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                helperText={
                  tierCount > 0
                    ? `${tierCount} tiers × ${picksPerTier || '?'} = ${rosterSizeLabel} golfers picked.`
                    : 'The event has no tiers yet.'
                }
                label="Picks per tier"
              >
                <Input
                  data-testid="contest-tiered-picks-per-tier"
                  min={1}
                  onChange={(event) => changePicksPerTier(event.target.value)}
                  type="number"
                  value={picksPerTier}
                />
              </FormField>
              <FormField label="Scores that count">
                <Input
                  data-testid="contest-tiered-counted-scores"
                  min={1}
                  onChange={(event) => setContestFormValue('countedScores', event.target.value)}
                  type="number"
                  value={countedScores}
                />
              </FormField>
            </div>

            <Alert>
              This contest uses the tournament’s tiers and golfer assignments.
            </Alert>

            {formError ? (
              <Alert
                data-testid="create-contest-error"
                tone="danger"
              >
                {formError}
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                  data-testid="create-contest-submit"
                  disabled={
                    saveContestMutation.isPending
                    || eventsQuery.isError
                    || !eligibleEvents.length
                    || !selectedEvent?.contestEligible
                    || createNeedsConfiguration
                  }
                  onClick={() => {
                    setFormError(null);
                    void contestForm.handleSubmit(
                      (values) => saveContestMutation.mutateAsync(values).catch(() => undefined),
                      (errors) => setFormError(getContestFormErrorMessage(errors)),
                    )();
                  }}
                >
                  {saveContestMutation.isPending ? 'Creating...' : 'Create contest'}
                </Button>
              <LinkButton
                to={buildLeagueAdminContestsPath(league.leagueCode)}
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
              { id: 'league', label: 'League', value: league.name },
              { id: 'mode', label: 'Mode', value: 'Golf tiered contest' },
              { id: 'event', label: 'Event', value: selectedEvent ? selectedEvent.name : 'Choose a golf event' },
              {
                id: 'event-starts',
                label: 'Event starts',
                value: selectedEvent ? formatDateTimeDisplay(selectedEvent.startDate) : 'Choose a golf event',
              },
              { id: 'entries-per-team', label: 'Entries per team', value: unlimitedEntries ? 'Unlimited' : maxEntriesPerTeam || '1' },
              { id: 'picks-per-tier', label: 'Picks per tier', value: picksPerTier },
              { id: 'golfers-picked', label: 'Golfers picked', value: rosterSizeLabel },
              { id: 'count-best', label: 'Scores that count', value: countedScores },
            ]}
          />

          <Tile>
            <h3 className="text-xl font-semibold">Lifecycle truth</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>A new contest is a draft: only commissioners see it, and nobody can enter yet.</li>
              <li>Open it to the league when it is ready. Its settings lock for good at that point.</li>
              <li>Entries close when the event starts.</li>
              <li>The contest goes live when the event starts and is final when the event completes.</li>
            </ul>
          </Tile>

          {eventsQuery.isError ? (
            <Alert tone="danger">
              We couldn&apos;t load golf events. Contest creation needs an imported event before a
              commissioner can continue.
            </Alert>
          ) : !eligibleEvents.length ? (
            <NoEligibleEventsAlert />
          ) : null}
          </>
        )}
      />
    </section>
  );
}

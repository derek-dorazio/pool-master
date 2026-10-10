import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { ListOrdered } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import type { CreateContestRequest } from '@poolmaster/shared/dto';
import { ContestFormat, SelectionType, Sport } from '@poolmaster/shared/domain';
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
  ChoiceCard,
  Chip,
  ErrorState,
  formatDateTimeDisplay,
  FormField,
  FormPage,
  Input,
  LoadingState,
  SegmentedControl,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { formatStartsIn } from './contest-readiness';
import {
  formatContestRules,
  formatEntriesPerTeamSentence,
  formatPresetLabel,
  formatSelectionTypeName,
  pluralize,
  suggestContestName,
} from './contest-rules';
import { ContestRulesFields } from './contest-rules-fields';
import { defaultCountedScoresFor, parseContestRules, toContestRulesValues, type ContestRulesValues } from './contest-rules-form';

const CUSTOM_PRESET = 'custom';

/** The ways of picking the create contract accepts; it widens as new formats are built. */
type CreatableSelectionType = CreateContestRequest['selectionType'];

/**
 * The ways of picking Create contest offers, one card each. Budget (#93) adds its card here with
 * its own rules fields.
 */
const FORMAT_CHOICES: Array<{ description: string; selectionType: CreatableSelectionType }> = [
  {
    selectionType: SelectionType.TIERED,
    description: "Pick golfers from each of the event's tiers, so the favorites are spread across every entry.",
  },
];

const creatableSelectionTypes = FORMAT_CHOICES.map((choice) => choice.selectionType) as [
  CreatableSelectionType,
  ...CreatableSelectionType[],
];

const createContestFormSchema = z.object({
  contestName: z.string().trim().min(1, 'Contest name is required.'),
  countedScores: z.string(),
  maxEntriesPerTeam: z.string(),
  picksPerTier: z.string(),
  selectedTemplateId: z.string(),
  selectionType: z.enum(creatableSelectionTypes),
  sportEventId: z.string().min(1, 'Choose an event for the contest.'),
  unlimitedEntries: z.boolean(),
});

type CreateContestFormValues = z.infer<typeof createContestFormSchema>;

const DEFAULT_RULES: ContestRulesValues = {
  countedScores: '4',
  maxEntriesPerTeam: '1',
  picksPerTier: '1',
  unlimitedEntries: false,
};

function sortEventsBySoonest(events: SportEventDto[]) {
  return [...events].sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate));
}

/** One numbered part of the form: 1 Event, 2 Format, 3 Rules, 4 Name. */
function SetupSection({
  children,
  lead,
  step,
  testId,
  title,
}: {
  children: ReactNode;
  lead?: string;
  step: number;
  testId: string;
  title: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-title`}
      className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0"
      data-testid={testId}
    >
      <div>
        <h3 className="flex items-baseline gap-2 text-base font-semibold" id={`${testId}-title`}>
          <span className="font-display text-sm text-muted-foreground">{step}</span>
          {title}
        </h3>
        {lead ? <p className="mt-0.5 text-sm text-muted-foreground">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** No released, unstarted event with a field: nothing to build a contest on yet (#431). */
function NoEligibleEventsAlert() {
  return (
    <Alert
      data-testid="create-contest-no-events"
      title="No golf events are currently available for contest setup."
      tone="warning"
    >
      <p>
        An event appears here once an admin releases it for contests, until it starts. Check back
        when the next tournament is released.
      </p>
    </Alert>
  );
}

/**
 * Commissioner tools › Contests › Create contest: one page in four numbered sections. Event,
 * then format with a preset to start from, then the rules, then a name suggested from the event
 * until the commissioner types their own, with the sentence members will see. Create lands on the
 * new contest's page, where it can still change until it is opened to the league.
 */
export function CreateContestPage() {
  const logger = getLogger().child({ feature: 'create-contest-page' });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);

  const form = useForm<CreateContestFormValues>({
    resolver: zodResolver(createContestFormSchema),
    defaultValues: {
      contestName: '',
      selectedTemplateId: '',
      selectionType: SelectionType.TIERED,
      sportEventId: '',
      ...DEFAULT_RULES,
    },
  });
  const values = form.watch();
  const { contestName, selectedTemplateId, selectionType, sportEventId } = values;
  const [isNameEdited, setIsNameEdited] = useState(false);
  const defaultPresetApplied = useRef(false);

  const setFormValues = useCallback((next: Partial<CreateContestFormValues>) => {
    for (const [field, value] of Object.entries(next) as Array<[keyof CreateContestFormValues, CreateContestFormValues[keyof CreateContestFormValues]]>) {
      form.setValue(field, value, { shouldDirty: true });
    }
  }, [form]);

  const eventsQuery = useQuery({
    queryKey: QueryKeys.sportEvents.list({ sport: Sport.GOLF }),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sport: Sport.GOLF } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }
      return sortEventsBySoonest(response.data.events);
    },
    enabled: auth.isAuthenticated,
    retry: false,
  });

  const templatesQuery = useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({ sport: Sport.GOLF, contestFormat: ContestFormat.ROSTER, active: true }),
    queryFn: async (): Promise<ContestConfigTemplateDto[]> => {
      const response = await listContestConfigTemplates({
        query: { sport: Sport.GOLF, contestFormat: ContestFormat.ROSTER, active: true },
      });
      if (!response.data?.templates) {
        throwApiError(response.error, 'Contest template response is missing data.');
      }
      return response.data.templates;
    },
    enabled: Boolean(league?.id),
    retry: false,
  });

  const eligibleEvents = useMemo(
    () => eventsQuery.data?.filter((event) => event.contestEligible) ?? [],
    [eventsQuery.data],
  );
  const selectedEvent = eligibleEvents.find((event) => event.id === sportEventId) ?? null;
  const tierCount = selectedEvent?.tierCount ?? 0;
  // The format's presets. The rules fields hold tiered rules, so a preset is offered when its
  // rules are tiered too.
  const presets = useMemo(
    () => (templatesQuery.data ?? []).flatMap((template) => (
      template.selectionType === selectionType && template.configuration.selectionType === SelectionType.TIERED
        ? [{ ...template, configuration: template.configuration }]
        : []
    )),
    [selectionType, templatesQuery.data],
  );
  const parsedRules = parseContestRules(values, tierCount);

  const selectPreset = useCallback((templateId: string) => {
    const template = presets.find((candidate) => candidate.id === templateId);
    if (!template) {
      setFormValues({ selectedTemplateId: '' });
      return;
    }
    setFormValues({ selectedTemplateId: template.id, ...toContestRulesValues(template.configuration) });
  }, [presets, setFormValues]);

  // The soonest contest-ready event is chosen to start with.
  useEffect(() => {
    const [soonest] = eligibleEvents;
    if (soonest && !eligibleEvents.some((event) => event.id === sportEventId)) {
      setFormValues({ sportEventId: soonest.id });
    }
  }, [eligibleEvents, setFormValues, sportEventId]);

  // The default preset is chosen once; after that, Custom stays Custom.
  useEffect(() => {
    if (defaultPresetApplied.current || !presets.length) {
      return;
    }
    defaultPresetApplied.current = true;
    const defaultPreset = presets.find((template) => template.isDefault) ?? presets[0];
    if (defaultPreset) {
      selectPreset(defaultPreset.id);
    }
  }, [presets, selectPreset]);

  // "Scores that count" starts at the default for the chosen event's tiers. A preset whose picks
  // per tier the form still holds keeps its own count over the formula.
  useEffect(() => {
    const picksPerTier = form.getValues('picksPerTier');
    const preset = presets.find((template) => template.id === form.getValues('selectedTemplateId'));
    if (preset && String(preset.configuration.picksPerTier) === picksPerTier) {
      return;
    }
    const countedScores = defaultCountedScoresFor(picksPerTier, tierCount);
    if (countedScores !== null) {
      setFormValues({ countedScores });
    }
  }, [form, presets, setFormValues, tierCount]);

  // The name follows the event and the rules until the commissioner types their own.
  const suggestedName = selectedEvent
    ? suggestContestName(selectedEvent.name, selectionType, parsedRules.configuration, tierCount)
    : '';
  useEffect(() => {
    if (!isNameEdited && suggestedName && form.getValues('contestName') !== suggestedName) {
      form.setValue('contestName', suggestedName);
    }
  }, [form, isNameEdited, suggestedName]);

  useEffect(() => {
    if (eventsQuery.isError) {
      logger.warn(
        { action: 'contestCreate.events.failed', data: { leagueCode }, err: eventsQuery.error },
        'Contest create page failed to load events',
      );
    }
  }, [eventsQuery.error, eventsQuery.isError, leagueCode, logger]);

  const createMutation = useInvalidatingMutation({
    mutationFn: async (submitted: CreateContestFormValues) => {
      if (!league?.id) {
        throw new Error('League detail is still loading.');
      }
      const event = eligibleEvents.find((candidate) => candidate.id === submitted.sportEventId);
      if (!event) {
        throw new Error('Choose a contest-ready event for the contest.');
      }
      const parsed = parseContestRules(submitted, event.tierCount);
      if (parsed.error !== null) {
        throw new Error(parsed.error);
      }
      // A preset is an optional starting point; the configuration the form holds is always sent
      // and, with a preset, replaces the preset's (#245).
      const body: CreateContestRequest = {
        name: submitted.contestName.trim(),
        sportEventId: event.id,
        contestFormat: ContestFormat.ROSTER,
        selectionType: submitted.selectionType,
        ...(submitted.selectedTemplateId ? { templateId: submitted.selectedTemplateId } : {}),
        configuration: parsed.configuration,
      };
      const response = await createContest({ path: { id: league.id }, body });
      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest creation response is missing data.');
      }
      return response.data.contest.id;
    },
    onMutate: (submitted) => {
      logger.debug(
        { action: 'contest.create.started', data: { leagueCode, sportEventId: submitted.sportEventId } },
        'Starting contest create flow',
      );
    },
    onSuccess: (savedContestId: string) => {
      logger.info(
        { action: 'contest.create.succeeded', data: { leagueCode, contestId: savedContestId, sportEventId } },
        'Created contest successfully',
      );
      // A new contest is not open yet (#117): the commissioner lands on its page, where they can
      // still edit or delete it and open it to the league when it is ready.
      navigate(buildLeagueAdminContestPath(leagueCode, savedContestId));
    },
    invalidates: (savedContestId) => [
      QueryKeys.contests.list({ leagueId: league?.id }),
      QueryKeys.contests.detail(savedContestId),
      QueryKeys.managedContests.all,
    ],
    onError: (error) => {
      const payload = { action: 'contest.create.failed', data: { leagueCode, sportEventId }, err: error };
      // ApiError wraps every SDK rejection, so it is checked explicitly to tell an expected API
      // rejection from a genuine unexpected exception.
      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest create was rejected');
      } else {
        logger.error(payload, 'Contest create failed unexpectedly');
      }
    },
  });

  if (!league) {
    return null;
  }

  if (eventsQuery.isLoading || templatesQuery.isLoading) {
    return <LoadingState body="Loading contest setup..." testId="create-contest-page-loading" />;
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

  const { errors } = form.formState;
  const errorMessage = errors.contestName?.message
    ?? errors.sportEventId?.message
    ?? (createMutation.isError
      ? extractErrorMessage(createMutation.error, {
        codeMessages: CONTEST_RELEASE_CODE_MESSAGES,
        fallback: 'We could not create that contest. Please try again.',
      })
      : null);
  const presetOptions = [
    ...presets.map((template) => ({
      label: formatPresetLabel(template.configuration, tierCount),
      testId: `contest-template-${template.templateKey}`,
      value: template.id,
    })),
    { label: 'Custom', testId: 'contest-template-custom', value: CUSTOM_PRESET },
  ];

  return (
    <FormPage
      cancelTo={buildLeagueAdminContestsPath(league.leagueCode)}
      description="Only commissioners see it until you open it to the league."
      errorMessage={errorMessage}
      isPending={createMutation.isPending}
      isSubmitDisabled={!selectedEvent || parsedRules.error !== null}
      onSubmit={(submitEvent) => {
        createMutation.reset();
        void form.handleSubmit((submitted) => {
          createMutation.mutate(submitted);
        })(submitEvent);
      }}
      pendingLabel="Creating..."
      submitLabel="Create contest"
      submitTestId="create-contest-submit"
      testId="create-contest-page"
      title="Create contest"
    >
      <SetupSection
        lead="Released events that haven't started. Entries close at the first tee time."
        step={1}
        testId="create-contest-event"
        title="Event"
      >
        {eventsQuery.isError ? (
          <Alert tone="danger">We couldn&apos;t load golf events. Try again in a moment.</Alert>
        ) : !eligibleEvents.length ? (
          <NoEligibleEventsAlert />
        ) : (
          <div aria-label="Event" className="grid gap-2" role="radiogroup">
            {eligibleEvents.map((event) => (
              <ChoiceCard
                isSelected={event.id === sportEventId}
                key={event.id}
                onSelect={() => setFormValues({ sportEventId: event.id })}
                testId={`contest-event-${event.id}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{event.name}</span>
                  {event.venue ? <span className="text-xs text-muted-foreground"> · {event.venue}</span> : null}
                  <span className="block text-xs text-muted-foreground">
                    Starts {formatDateTimeDisplay(event.startDate)}
                    {' · '}
                    {pluralize(event.participantCount ?? 0, 'golfer')}
                    {' · '}
                    {pluralize(event.tierCount, 'tier')}
                  </span>
                </span>
                <Chip>{formatStartsIn(event.startDate)}</Chip>
              </ChoiceCard>
            ))}
          </div>
        )}
      </SetupSection>

      <SetupSection step={2} testId="create-contest-format" title="Format">
        <div aria-label="Format" className="grid gap-2 md:grid-cols-2" role="radiogroup">
          {FORMAT_CHOICES.map((choice) => (
            <ChoiceCard
              isSelected={choice.selectionType === selectionType}
              key={choice.selectionType}
              onSelect={() => setFormValues({ selectedTemplateId: '', selectionType: choice.selectionType })}
              testId={`contest-format-${choice.selectionType}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-semibold">
                  <ListOrdered aria-hidden size={16} />
                  {formatSelectionTypeName(choice.selectionType)}
                </span>
                <span className="block text-xs text-muted-foreground">{choice.description}</span>
              </span>
            </ChoiceCard>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Start from</span>
          <SegmentedControl
            aria-label="Start from"
            onChange={(value) => selectPreset(value === CUSTOM_PRESET ? '' : value)}
            options={presetOptions}
            value={selectedTemplateId || CUSTOM_PRESET}
          />
        </div>
      </SetupSection>

      <SetupSection step={3} testId="create-contest-rules" title="Rules">
        <ContestRulesFields
          onChange={(next) => setFormValues({ ...next, selectedTemplateId: '' })}
          tierCount={tierCount}
          values={values}
        />
        {parsedRules.error !== null ? (
          <p className="text-sm text-destructive" data-testid="contest-rules-error">{parsedRules.error}</p>
        ) : null}
      </SetupSection>

      <SetupSection step={4} testId="create-contest-name" title="Name">
        <FormField helperText="Filled from the event and format until you change it." label="Contest name">
          <Input
            data-testid="contest-name"
            onChange={(event) => {
              setIsNameEdited(true);
              form.setValue('contestName', event.target.value, { shouldDirty: true });
            }}
            type="text"
            value={contestName}
          />
        </FormField>
        {selectedEvent && parsedRules.configuration ? (
          <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm" data-testid="contest-members-will-see">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Members will see</div>
            <div className="font-semibold">{`${contestName.trim() || 'Untitled contest'} · ${selectedEvent.name}`}</div>
            <div>
              {`${formatContestRules(parsedRules.configuration, tierCount)} ${formatEntriesPerTeamSentence(parsedRules.configuration.maxEntriesPerSquad)}.`}
            </div>
          </div>
        ) : null}
      </SetupSection>
    </FormPage>
  );
}

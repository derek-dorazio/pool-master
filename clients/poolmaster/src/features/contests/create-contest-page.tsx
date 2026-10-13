import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { ListOrdered, Shuffle, Wallet, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import type { CreateContestRequest } from '@poolmaster/shared/dto';
import {
  ContestFormat,
  ParticipantScoringDefinitionIdSchema,
  SelectionType,
  SUPPORTED_SPORTS,
  getSportDefinition,
  sportAllowsSelectionType,
  type ContestScoringSettings,
  type Sport,
  type SportDefinition,
  type SportNoun,
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
  ChoiceCard,
  ErrorState,
  FormField,
  FormPage,
  Input,
  SegmentedControl,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import {
  formatContestRules,
  formatEntriesPerTeamSentence,
  formatPresetLabel,
  formatSelectionTypeName,
  suggestContestName,
} from './contest-rules';
import {
  EMPTY_SCORING_SETTINGS_VALUES,
  SCORING_SETTINGS_UI,
} from './contest-scoring-settings';
import { EventChoices, NoEligibleEventsAlert, SetupSection, SportPicker } from './create-contest-sections';
import { ContestRulesFields } from './contest-rules-fields';
import {
  DEFAULT_CONTEST_RULES,
  defaultCountedScoresFor,
  parseContestRules,
  toContestRulesValues,
} from './contest-rules-form';

const CUSTOM_PRESET = 'custom';

/** The ways of picking the create contract accepts; it widens as new formats are built. */
type CreatableSelectionType = CreateContestRequest['selectionType'];

/**
 * The ways of picking Create contest offers, one card each, with its own rules fields. A sport
 * offers the ones its definition lists; each card says what it means in the sport's words.
 */
const FORMAT_CHOICES: Array<{ describe: (participant: SportNoun) => string; icon: LucideIcon; selectionType: CreatableSelectionType }> = [
  {
    selectionType: SelectionType.TIERED,
    icon: ListOrdered,
    describe: ({ many }) => `Pick ${many} from each of the event's tiers, so the favorites are spread across every entry.`,
  },
  {
    selectionType: SelectionType.BUDGET_PICK,
    icon: Wallet,
    describe: ({ one }) => `Every ${one} has a price. Pick a roster whose prices fit under the salary cap.`,
  },
  {
    selectionType: SelectionType.RANDOM_DRAW,
    icon: Shuffle,
    describe: ({ many }) => `A sweepstake: nobody picks. Once entries are in, you run the draw and each entry is dealt ${many} at random.`,
  },
];

/** The formats a sport's contests may use, in the order Create contest offers them. */
function formatChoicesFor(sport: SportDefinition) {
  return FORMAT_CHOICES.filter((choice) => sportAllowsSelectionType(sport, choice.selectionType));
}


const creatableSelectionTypes = FORMAT_CHOICES.map((choice) => choice.selectionType) as [
  CreatableSelectionType,
  ...CreatableSelectionType[],
];

const createContestFormSchema = z.object({
  contestName: z.string().trim().min(1, 'Contest name is required.'),
  countedScores: z.string(),
  didNotFinishPoints: z.string(),
  maxEntriesPerTeam: z.string(),
  picksPerEntry: z.string(),
  picksPerTier: z.string(),
  pointsTable: z.string(),
  rosterSize: z.string(),
  scoringDefinitionId: ParticipantScoringDefinitionIdSchema,
  selectedTemplateId: z.string(),
  selectionType: z.enum(creatableSelectionTypes),
  sport: z.custom<Sport>((value) => SUPPORTED_SPORTS.some((sport) => sport === value)),
  sportEventId: z.string().min(1, 'Choose an event for the contest.'),
  unlimitedEntries: z.boolean(),
});

type CreateContestFormValues = z.infer<typeof createContestFormSchema>;

/**
 * A format's starting preset: the event's sport league's own default over the sport-wide default,
 * else the first. The list holds only that league's templates and the sport-wide ones, so a
 * template with a sport league is the event's league's.
 */
function defaultPresetOf<Preset extends Pick<ContestConfigTemplateDto, 'isDefault' | 'sportLeagueId'>>(presets: Preset[]) {
  return presets.find((template) => template.isDefault && template.sportLeagueId !== null)
    ?? presets.find((template) => template.isDefault)
    ?? presets.at(0);
}

function sortEventsBySoonest(events: SportEventDto[]) {
  return [...events].sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate));
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
      scoringDefinitionId: getSportDefinition(SUPPORTED_SPORTS[0]).scoringDefinitions[0],
      selectedTemplateId: '',
      selectionType: SelectionType.TIERED,
      sport: SUPPORTED_SPORTS[0],
      sportEventId: '',
      ...DEFAULT_CONTEST_RULES,
      ...EMPTY_SCORING_SETTINGS_VALUES,
    },
  });
  const values = form.watch();
  const { contestName, scoringDefinitionId, selectedTemplateId, selectionType, sport, sportEventId } = values;
  const sportDefinition = getSportDefinition(sport);
  const { participant } = sportDefinition.vocabulary;
  const scoringSettingsUi = SCORING_SETTINGS_UI[scoringDefinitionId];
  const [isNameEdited, setIsNameEdited] = useState(false);
  // The sport and sport league whose default preset was applied last: their default is applied
  // when their presets arrive and again on switching back to them; while both stay, Custom stays
  // Custom.
  const defaultPresetAppliedFor = useRef<`${Sport}/${string}` | null>(null);

  const setFormValues = useCallback((next: Partial<CreateContestFormValues>) => {
    for (const [field, value] of Object.entries(next) as Array<[keyof CreateContestFormValues, CreateContestFormValues[keyof CreateContestFormValues]]>) {
      form.setValue(field, value, { shouldDirty: true });
    }
  }, [form]);

  const eventsQuery = useQuery({
    queryKey: QueryKeys.sportEvents.list({ sport }),
    queryFn: async (): Promise<SportEventDto[]> => {
      const response = await listEvents({ query: { sport } });
      if (!response.data?.events) {
        throwApiError(response.error, 'Sport event list response is missing data.');
      }
      return sortEventsBySoonest(response.data.events);
    },
    enabled: auth.isAuthenticated,
    retry: false,
  });

  const eligibleEvents = useMemo(
    () => eventsQuery.data?.filter((event) => event.contestEligible) ?? [],
    [eventsQuery.data],
  );
  const selectedEvent = eligibleEvents.find((event) => event.id === sportEventId) ?? null;
  // The chosen event's sport league: its own presets are offered beside the sport-wide ones, so
  // the presets wait for an event.
  const sportLeagueId = selectedEvent?.sportLeagueId;

  const templatesQuery = useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({ sport, sportLeagueId, contestFormat: ContestFormat.ROSTER, active: true }),
    queryFn: async (): Promise<ContestConfigTemplateDto[]> => {
      const response = await listContestConfigTemplates({
        query: { sport, sportLeagueId, contestFormat: ContestFormat.ROSTER, active: true },
      });
      if (!response.data?.templates) {
        throwApiError(response.error, 'Contest template response is missing data.');
      }
      return response.data.templates;
    },
    enabled: Boolean(league?.id) && selectedEvent !== null,
    retry: false,
  });
  const tierCount = selectedEvent?.tierCount ?? 0;
  // The event's salary cap, which every budget contest on it plays under; null until it is priced.
  const salaryCap = selectedEvent?.pricing?.salaryCap ?? null;
  const isBudgetUnavailable = selectedEvent !== null && salaryCap === null;
  // Each format's presets: the templates whose rules are that format's.
  const presetsFor = useCallback(
    (format: CreatableSelectionType) => (templatesQuery.data ?? []).flatMap((template) => {
      const { configuration } = template;
      return template.selectionType === format && configuration.selectionType === format
        ? [{ ...template, configuration }]
        : [];
    }),
    [templatesQuery.data],
  );
  const presets = useMemo(() => presetsFor(selectionType), [presetsFor, selectionType]);
  const parsedRules = parseContestRules(values, selectionType, tierCount, participant);
  const parsedScoring = scoringSettingsUi.parse(values);

  // A preset's rules and, when it presets them, its scoring definition and settings. Without a
  // preset scoring, the contest scores by its sport's default definition.
  const presetValues = useCallback((configuration: (typeof presets)[number]['configuration']) => {
    const current = form.getValues();
    const scoring: ContestScoringSettings | undefined = configuration.scoring;
    const definitionId = scoring?.participantScoringDefinitionId
      ?? getSportDefinition(current.sport).scoringDefinitions[0];
    return {
      ...toContestRulesValues(configuration, current),
      scoringDefinitionId: definitionId,
      ...(scoring
        ? SCORING_SETTINGS_UI[definitionId].toValues(scoring, {
          pointsTable: current.pointsTable,
          didNotFinishPoints: current.didNotFinishPoints,
        })
        : {}),
    };
  }, [form]);

  const selectPreset = useCallback((templateId: string) => {
    const template = presets.find((candidate) => candidate.id === templateId);
    if (!template) {
      setFormValues({ selectedTemplateId: '' });
      return;
    }
    setFormValues({ selectedTemplateId: template.id, ...presetValues(template.configuration) });
  }, [presetValues, presets, setFormValues]);

  // A new format starts from its default preset, or from what the fields hold when it has none.
  const selectFormat = useCallback((format: CreatableSelectionType) => {
    const preset = defaultPresetOf(presetsFor(format));
    setFormValues({
      selectionType: format,
      selectedTemplateId: preset?.id ?? '',
      ...(preset ? presetValues(preset.configuration) : {}),
    });
  }, [presetValues, presetsFor, setFormValues]);

  // A new sport starts over: its own events and presets, a format it offers, and its default
  // scoring definition until one of its presets says otherwise.
  const selectSport = useCallback((next: Sport) => {
    const definition = getSportDefinition(next);
    const current = form.getValues('selectionType');
    setFormValues({
      sport: next,
      sportEventId: '',
      selectedTemplateId: '',
      selectionType: sportAllowsSelectionType(definition, current)
        ? current
        : formatChoicesFor(definition)[0]?.selectionType ?? current,
      scoringDefinitionId: definition.scoringDefinitions[0],
    });
  }, [form, setFormValues]);

  // The soonest contest-ready event is chosen to start with.
  useEffect(() => {
    const soonest = eligibleEvents.at(0);
    if (soonest && !eligibleEvents.some((event) => event.id === sportEventId)) {
      setFormValues({ sportEventId: soonest.id });
    }
  }, [eligibleEvents, setFormValues, sportEventId]);

  // A newly chosen sport or sport league starts on its default preset; while both stay, Custom
  // stays Custom.
  useEffect(() => {
    const presetsKey: `${Sport}/${string}` = `${sport}/${sportLeagueId ?? ''}`;
    if (defaultPresetAppliedFor.current === presetsKey || !presets.length) {
      return;
    }
    defaultPresetAppliedFor.current = presetsKey;
    const defaultPreset = defaultPresetOf(presets);
    if (defaultPreset) {
      selectPreset(defaultPreset.id);
    }
  }, [presets, selectPreset, sport, sportLeagueId]);

  // A tiered contest's "Scores that count" starts at the default for the chosen event's tiers. A
  // preset whose picks per tier the form still holds keeps its own count over the formula.
  useEffect(() => {
    if (form.getValues('selectionType') !== SelectionType.TIERED) {
      return;
    }
    const picksPerTier = form.getValues('picksPerTier');
    const preset = presets.find((template) => template.id === form.getValues('selectedTemplateId'));
    if (preset?.configuration.selectionType === SelectionType.TIERED
      && String(preset.configuration.picksPerTier) === picksPerTier) {
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
      const submittedParticipant = getSportDefinition(submitted.sport).vocabulary.participant;
      const parsed = parseContestRules(submitted, submitted.selectionType, event.tierCount, submittedParticipant);
      if (parsed.error !== null) {
        throw new Error(parsed.error);
      }
      const scoring = SCORING_SETTINGS_UI[submitted.scoringDefinitionId].parse(submitted);
      if (scoring.error !== null) {
        throw new Error(scoring.error);
      }
      // A preset is an optional starting point; the configuration the form holds is always sent
      // and, with a preset, replaces the preset's (#245).
      const body: CreateContestRequest = {
        name: submitted.contestName.trim(),
        sportEventId: event.id,
        contestFormat: ContestFormat.ROSTER,
        selectionType: submitted.selectionType,
        ...(submitted.selectedTemplateId ? { templateId: submitted.selectedTemplateId } : {}),
        // A definition that takes settings sends them; one that takes none leaves the template's
        // preset or the sport's default to apply.
        configuration: scoring.scoring ? { ...parsed.configuration, scoring: scoring.scoring } : parsed.configuration,
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
      // The event's presets are still loading: a contest sent now would skip its default preset.
      isSubmitDisabled={!selectedEvent
        || templatesQuery.isPending
        || parsedRules.error !== null
        || parsedScoring.error !== null
        || (selectionType === SelectionType.BUDGET_PICK && isBudgetUnavailable)}
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
        lead={`Released events that haven't started. Entries close at the ${sportDefinition.vocabulary.eventStart}.`}
        step={1}
        testId="create-contest-event"
        title="Event"
      >
        <SportPicker onChange={selectSport} value={sport} />
        {eventsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="create-contest-events-loading">
            Loading events...
          </p>
        ) : eventsQuery.isError ? (
          <Alert tone="danger">
            We couldn&apos;t load {sportDefinition.name.toLowerCase()} events. Try again in a moment.
          </Alert>
        ) : !eligibleEvents.length ? (
          <NoEligibleEventsAlert sport={sportDefinition} />
        ) : (
          <EventChoices
            events={eligibleEvents}
            onSelect={(eventId) => setFormValues({ sportEventId: eventId })}
            selectedEventId={sportEventId}
            sport={sportDefinition}
          />
        )}
      </SetupSection>

      <SetupSection step={2} testId="create-contest-format" title="Format">
        <div aria-label="Format" className="grid gap-2 md:grid-cols-2" role="radiogroup">
          {formatChoicesFor(sportDefinition).map((choice) => {
            const isSelected = choice.selectionType === selectionType;
            // A budget contest needs a priced field; the card says so rather than vanishing.
            const isUnavailable = choice.selectionType === SelectionType.BUDGET_PICK && isBudgetUnavailable;
            const Icon = choice.icon;
            return (
              <ChoiceCard
                isDisabled={isUnavailable && !isSelected}
                isSelected={isSelected}
                key={choice.selectionType}
                onSelect={() => selectFormat(choice.selectionType)}
                testId={`contest-format-${choice.selectionType}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon aria-hidden size={16} />
                    {formatSelectionTypeName(choice.selectionType)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {isUnavailable ? `This event’s ${participant.many} have no prices yet.` : choice.describe(participant)}
                  </span>
                </span>
              </ChoiceCard>
            );
          })}
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
          participant={participant}
          salaryCap={salaryCap}
          selectionType={selectionType}
          tierCount={tierCount}
          values={values}
        />
        {parsedRules.error !== null ? (
          <p className="text-sm text-destructive" data-testid="contest-rules-error">{parsedRules.error}</p>
        ) : null}
        {scoringSettingsUi.Fields ? (
          <scoringSettingsUi.Fields
            onChange={(next) => setFormValues({ ...next, selectedTemplateId: '' })}
            values={values}
            vocabulary={sportDefinition.vocabulary}
          />
        ) : null}
        {parsedScoring.error !== null ? (
          <p className="text-sm text-destructive" data-testid="contest-scoring-error">{parsedScoring.error}</p>
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
              {[
                formatContestRules(parsedRules.configuration, tierCount, participant, salaryCap),
                scoringSettingsUi.describe(parsedScoring.scoring),
                `${formatEntriesPerTeamSentence(parsedRules.configuration.maxEntriesPerSquad)}.`,
              ].filter((sentence) => sentence !== null).join(' ')}
            </div>
          </div>
        ) : null}
      </SetupSection>
    </FormPage>
  );
}

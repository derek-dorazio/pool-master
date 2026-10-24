import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import type { ContestConfigTemplateDto, SportEventDto } from '@/lib/api';
import type { CreateContestRequest } from '@poolmaster/shared/dto';
import {
  type ContestScoringSettings,
  ParticipantScoringDefinitionIdSchema,
  PickEmMode,
  PlanCap,
  SUPPORTED_SPORTS,
  SelectionType,
  type Sport,
  type SportDefinition,
  type SportNoun,
  UpsetBonusRule,
  contestFormatForSelectionType,
  contestTemplateEventTypeOf,
  formatContestRules,
  formatEntriesPerTeamSentence,
  formatSelectionTypeName,
  getSportDefinition,
  pluralize,
  sportAllowsSelectionType,
  suggestContestName,
} from '@poolmaster/shared/domain';
import { createContest, listContestConfigTemplates } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { getLogger } from '@/lib/logger';
import {
  buildLeagueAdminContestPath,
  buildLeagueAdminContestsPath,
  buildLeagueAdminPlanPath,
} from '@/features/leagues/league-routing';
import { useSportLeaguesUsed } from '@/features/plans/use-sport-leagues-used';
import { CONTEST_RELEASE_CODE_MESSAGES } from './contest-release-messages';
import { bracketRoundCount, bracketStartRoundOptions } from './bracket-start-round';
import { canEventStartRules, contestEventsFor, contestEventsForTemplate } from './contest-template-events';
import { SELECTION_TYPE_ICONS } from './selection-type-icons';
import { useActiveContestTemplatesQuery } from './use-active-contest-templates-query';
import { sportEventsQueryOptions } from './sport-events-query';
import { useEventRoundName } from './use-bracket-round-label';
import { hasWebEntryScreen, type WebEnterableSelectionType } from './contest-entry-screens';
import { SquaresGamePicker } from './squares-game-picker';
import { useSquaresGameChoices } from './use-squares-game-choices';
import {
  Alert,
  ChoiceCard,
  ErrorState,
  FormField,
  FormPage,
  Input,
} from '@/features/shared/ui';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import {
  EMPTY_SCORING_SETTINGS_VALUES,
  SCORING_SETTINGS_UI,
  scoringSettingsUiFor,
} from './contest-scoring-settings';
import { EventChoices, NoEligibleEventsAlert, SetupSection, SportPicker } from './create-contest-sections';
import { ContestRulesFields } from './contest-rules-fields';
import {
  DEFAULT_CONTEST_RULES,
  defaultCountedScoresFor,
  parseContestRules,
  tiersInPlayFor,
  toContestRulesValues,
} from './contest-rules-form';

/**
 * The ways of picking Create contest can offer: the ones the create contract accepts whose
 * entries have a screen to pick on here.
 */
type CreatableSelectionType = Extract<CreateContestRequest['selectionType'], WebEnterableSelectionType>;

/**
 * The ways of picking Create contest offers, one card each, with its own rules fields. A `Record`
 * over the creatable types, so a type that gains an entry screen must gain a card. Each card says
 * what it means in the sport's words.
 */
const FORMAT_CHOICES: Record<CreatableSelectionType, { describe: (participant: SportNoun) => string; icon: LucideIcon }> = {
  [SelectionType.TIERED]: {
    icon: SELECTION_TYPE_ICONS.TIERED,
    describe: ({ many }) => `Pick ${many} from each of the event's tiers, so the favorites are spread across every entry.`,
  },
  [SelectionType.BUDGET_PICK]: {
    icon: SELECTION_TYPE_ICONS.BUDGET_PICK,
    describe: ({ one }) => `Every ${one} has a price. Pick a roster whose prices fit under the salary cap.`,
  },
  [SelectionType.RANDOM_DRAW]: {
    icon: SELECTION_TYPE_ICONS.RANDOM_DRAW,
    describe: ({ many }) => `A sweepstake: nobody picks. Once entries are in, you run the draw and each entry is dealt ${many} at random.`,
  },
  [SelectionType.PICK_EM]: {
    icon: SELECTION_TYPE_ICONS.PICK_EM,
    describe: () => 'Pick the winner of every game, week by week, straight up or ranked by confidence. Add the season\'s other weeks once the contest is created.',
  },
  [SelectionType.BRACKET]: {
    icon: SELECTION_TYPE_ICONS.BRACKET,
    describe: () => 'Pick the winner of every game, all the way to the final: the whole bracket before it starts, or a second-chance bracket from a later round.',
  },
  [SelectionType.SURVIVOR]: {
    icon: SELECTION_TYPE_ICONS.SURVIVOR,
    describe: () => 'Pick one team to win each week, never the same team twice. A loss puts the entry out; the last ones standing win. Add the season\'s other weeks once the contest is created.',
  },
  [SelectionType.SQUARES]: {
    icon: SELECTION_TYPE_ICONS.SQUARES,
    describe: () => 'A 10x10 grid on one game. Members claim boxes, you draw the numbers, and the box matching each team\'s last digit wins each quarter and the final score.',
  },
};

/**
 * The formats a sport's contests may use, in its definition's order: those whose entries have a
 * screen to pick on here.
 */
function formatChoicesFor(sport: SportDefinition) {
  return sport.selectionTypes
    .filter(hasWebEntryScreen)
    .map((selectionType) => ({ selectionType, ...FORMAT_CHOICES[selectionType] }));
}

const creatableSelectionTypes = Object.values(SelectionType).filter(hasWebEntryScreen) as [
  CreatableSelectionType,
  ...CreatableSelectionType[],
];

function isCreatableSelectionType(selectionType: SelectionType): selectionType is CreatableSelectionType {
  return creatableSelectionTypes.some((creatable) => creatable === selectionType);
}

const createContestFormSchema = z.object({
  contestName: z.string().trim().min(1, 'Contest name is required.'),
  countedScores: z.string(),
  didNotFinishPoints: z.string(),
  maxEntriesPerTeam: z.string(),
  maxSquaresPerEntry: z.string(),
  pickEmAgainstTheSpread: z.boolean(),
  survivorReuseTeams: z.boolean(),
  pickEmMode: z.nativeEnum(PickEmMode),
  picksPerEntry: z.string(),
  picksPerTier: z.string(),
  pointsTable: z.string(),
  rosterSize: z.string(),
  roundValues: z.string(),
  scoringDefinitionId: ParticipantScoringDefinitionIdSchema,
  startsAtRound: z.string(),
  tiersUsed: z.string(),
  selectedTemplateId: z.string(),
  selectionType: z.enum(creatableSelectionTypes),
  sport: z.custom<Sport>((value) => SUPPORTED_SPORTS.some((sport) => sport === value)),
  sportEventId: z.string().min(1, 'Choose an event for the contest.'),
  /** The game a squares contest is played on (#711); empty for every other format. */
  sportEventMatchId: z.string(),
  unlimitedEntries: z.boolean(),
  upsetBonusMultiplier: z.string(),
  upsetBonusRule: z.enum([UpsetBonusRule.NONE, UpsetBonusRule.SEED_DIFFERENCE]),
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

/**
 * The format an event's sport league starts on: the format of its first default by sort order
 * among the ones the page creates and the event can take (#802: a league has a default for each
 * format, and sorts the one to start on first, such as Formula 1's budget contest, #625). Null when
 * the league has no default of its own, and the format chosen stays.
 */
function leagueStartingFormatOf(
  templates: ContestConfigTemplateDto[],
  isAvailable: (format: CreatableSelectionType) => boolean,
): CreatableSelectionType | null {
  const formats = templates
    .filter((template) => template.isDefault && template.sportLeagueId !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((template) => template.selectionType)
    .filter((format): format is CreatableSelectionType => hasWebEntryScreen(format) && isAvailable(format));
  return formats.at(0) ?? null;
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
      sportEventMatchId: '',
      ...DEFAULT_CONTEST_RULES,
      ...EMPTY_SCORING_SETTINGS_VALUES,
    },
  });
  const values = form.watch();
  const { contestName, scoringDefinitionId, selectedTemplateId, selectionType, sport, sportEventId, sportEventMatchId } = values;
  const sportDefinition = getSportDefinition(sport);
  const { participant } = sportDefinition.vocabulary;
  const scoringSettingsUi = scoringSettingsUiFor(selectionType, scoringDefinitionId);
  const [isNameEdited, setIsNameEdited] = useState(false);
  // The sport, sport league and kind of event whose default preset was applied last: their default
  // is applied when their presets arrive and again on switching back to them; while all three
  // stay, Custom stays Custom.
  const defaultPresetAppliedFor = useRef<`${Sport}/${string}/${string}` | null>(null);

  const setFormValues = useCallback((next: Partial<CreateContestFormValues>) => {
    for (const [field, value] of Object.entries(next) as Array<[keyof CreateContestFormValues, CreateContestFormValues[keyof CreateContestFormValues]]>) {
      form.setValue(field, value, { shouldDirty: true });
    }
  }, [form]);

  // A contest type chosen on the league's contest types page (#803) arrives as `?template=<id>`:
  // the page starts on that template, on the soonest event it is offered on, once. After that the
  // commissioner's own choices stand.
  const [searchParams] = useSearchParams();
  const requestedTemplateId = searchParams.get('template');
  const requestedTemplateQuery = useActiveContestTemplatesQuery({ enabled: auth.isAuthenticated && requestedTemplateId !== null });
  const requestedTemplate = requestedTemplateQuery.data?.find((template) => template.id === requestedTemplateId
    && isCreatableSelectionType(template.selectionType)) ?? null;
  const requestedTemplateProgress = useRef<'sport' | 'event' | 'settled'>('sport');

  const eventsQuery = useQuery(sportEventsQueryOptions(sport, auth.isAuthenticated));

  const contestEvents = useMemo(
    () => contestEventsFor(eventsQuery.data ?? [], selectionType),
    [eventsQuery.data, selectionType],
  );
  // The plan's sports leagues a year (#947): once a year's contests use them all, an event in
  // another sports league that year is locked. A contest's year is its first event's.
  const sportLeagueCap = league?.planEntitlements.caps[PlanCap.SPORTS_LEAGUES_PER_YEAR] ?? null;
  const eventYears = useMemo(
    () => [...new Set(contestEvents.map((event) => event.eventYear))].sort((left, right) => left - right),
    [contestEvents],
  );
  const sportLeaguesUsed = useSportLeaguesUsed(league?.id, eventYears, sportLeagueCap !== null);
  const lockedEventIds = useMemo(() => contestEvents.flatMap((event) => {
    const used = sportLeaguesUsed.get(event.eventYear);
    return sportLeagueCap !== null && used !== undefined
      && used.length >= sportLeagueCap && !used.includes(event.sportLeagueId)
      ? [event.id]
      : [];
  }), [contestEvents, sportLeagueCap, sportLeaguesUsed]);
  const selectableEvents = useMemo(
    () => contestEvents.filter((event) => !lockedEventIds.includes(event.id)),
    [contestEvents, lockedEventIds],
  );
  const selectedEvent = selectableEvents.find((event) => event.id === sportEventId) ?? null;
  // The events that can start a requested template, whatever format the page is on.
  const requestedEvents = useMemo(
    () => (requestedTemplate ? contestEventsForTemplate(eventsQuery.data ?? [], requestedTemplate) : []),
    [eventsQuery.data, requestedTemplate],
  );
  // A knockout under way takes only a second-chance bracket.
  const isEventUnderWay = selectedEvent !== null && !selectedEvent.contestEligible;
  const roundName = useEventRoundName(selectionType === SelectionType.BRACKET ? selectedEvent : null);
  const bracketStartRounds = selectionType === SelectionType.BRACKET && selectedEvent
    ? bracketStartRoundOptions(bracketRoundCount(selectedEvent), roundName, { isUnderWay: isEventUnderWay })
    : [];
  // A squares contest's games: read once a squares contest's event is chosen.
  const [now] = useState(() => new Date());
  const squaresGames = useSquaresGameChoices(selectionType === SelectionType.SQUARES ? selectedEvent : null, now);
  const isSquaresGameMissing = selectionType === SelectionType.SQUARES
    && !squaresGames.games.some((game) => game.id === sportEventMatchId);
  // The chosen event's sport league: its own presets are offered beside the sport-wide ones, so
  // the presets wait for an event.
  const sportLeagueId = selectedEvent?.sportLeagueId;
  // A sport played as matches offers a week's templates on a week of games and a knockout's on a
  // knockout (#802); every other sport's templates suit all its events.
  const eventType = selectedEvent ? contestTemplateEventTypeOf(selectedEvent) ?? undefined : undefined;

  const templatesQuery = useQuery({
    queryKey: QueryKeys.contestConfigTemplates.list({ sport, sportLeagueId, eventType, active: true }),
    queryFn: async (): Promise<ContestConfigTemplateDto[]> => {
      const response = await listContestConfigTemplates({
        query: { sport, sportLeagueId, eventType, active: true },
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
  // Each format's presets: the templates whose rules are that format's, and for a bracket only the
  // ones the chosen event can start at (#802): a full bracket before the first game, a second
  // chance once it is under way.
  const presetsFor = useCallback(
    (format: CreatableSelectionType) => (templatesQuery.data ?? []).flatMap((template) => {
      const { configuration } = template;
      return template.selectionType === format && configuration.selectionType === format
        && (selectedEvent === null ? configuration.selectionType !== SelectionType.BRACKET : canEventStartRules(configuration, selectedEvent))
        ? [{ ...template, configuration }]
        : [];
    }),
    [selectedEvent, templatesQuery.data],
  );
  const presets = useMemo(() => presetsFor(selectionType), [presetsFor, selectionType]);
  const parsedRules = parseContestRules(values, selectionType, tierCount, participant);
  // A full bracket typed by hand cannot start on a knockout under way: a later round must be chosen.
  const rulesError = parsedRules.error
    ?? (bracketStartRounds.length && !bracketStartRounds.some((option) => String(option.roundNumber) === values.startsAtRound)
      ? 'Choose the round the bracket starts at.'
      : null);
  const parsedScoring = scoringSettingsUi.parse(values);

  // A preset's rules and, when it presets them, its scoring definition and settings. Without a
  // preset scoring, the contest scores by its sport's default definition.
  const presetValues = useCallback((configuration: (typeof presets)[number]['configuration']) => {
    const current = form.getValues();
    const scoring: ContestScoringSettings | undefined = configuration.scoring;
    const definitionId = scoring?.participantScoringDefinitionId
      ?? getSportDefinition(current.sport).scoringDefinitions[0];
    const rules = toContestRulesValues(configuration, current);
    return {
      ...rules,
      scoringDefinitionId: definitionId,
      ...(scoring
        ? SCORING_SETTINGS_UI[definitionId].toValues(scoring, {
          pointsTable: current.pointsTable,
          didNotFinishPoints: current.didNotFinishPoints,
          roundValues: current.roundValues,
          upsetBonusRule: current.upsetBonusRule,
          upsetBonusMultiplier: current.upsetBonusMultiplier,
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

  // A contest-ready event takes the full bracket; a knockout under way starts its second-chance
  // bracket at the first round it offers.
  const chooseEvent = useCallback((event: SportEventDto) => {
    setFormValues({ sportEventId: event.id, startsAtRound: event.contestEligible ? '1' : '2' });
  }, [setFormValues]);

  // A squares contest starts on the first game offered: the event's final when it is to come.
  const firstSquaresGameId = squaresGames.games.at(0)?.id;
  useEffect(() => {
    if (firstSquaresGameId && isSquaresGameMissing) {
      setFormValues({ sportEventMatchId: firstSquaresGameId });
    }
  }, [firstSquaresGameId, isSquaresGameMissing, setFormValues]);

  // A requested template starts the page on its sport and format, so its events are listed.
  useEffect(() => {
    if (!requestedTemplate || requestedTemplateProgress.current !== 'sport' || !isCreatableSelectionType(requestedTemplate.selectionType)) {
      return;
    }
    requestedTemplateProgress.current = 'event';
    if (form.getValues('sport') !== requestedTemplate.sport) {
      selectSport(requestedTemplate.sport);
    }
    setFormValues({ selectionType: requestedTemplate.selectionType });
  }, [form, requestedTemplate, selectSport, setFormValues]);

  // The soonest contest-ready event is chosen to start with, else a knockout under way. Until a
  // requested template is settled, the soonest event that can start it, when it has one.
  useEffect(() => {
    const pendingEvents = requestedTemplateProgress.current === 'event' ? requestedEvents : [];
    const current = selectableEvents.find((event) => event.id === sportEventId);
    if (current && (!pendingEvents.length || pendingEvents.includes(current))) {
      return;
    }
    const choices = pendingEvents.length ? pendingEvents.filter((event) => selectableEvents.includes(event)) : selectableEvents;
    const soonest = choices.find((event) => event.contestEligible) ?? choices.at(0);
    if (soonest) {
      chooseEvent(soonest);
    }
  }, [chooseEvent, requestedEvents, selectableEvents, sportEventId]);

  // A newly chosen sport, sport league or kind of event starts on its default preset; while all
  // three stay, Custom stays Custom. A sport league starts on the format its defaults sort first
  // (the Formula 1 default is a budget contest, #625; an NFL week a pick'em, #802), unless the
  // sport does not offer it, the event has no prices for it yet, or the event cannot take it (a
  // knockout under way takes only a second-chance bracket or squares).
  useEffect(() => {
    const presetsKey: `${Sport}/${string}/${string}` = `${sport}/${sportLeagueId ?? ''}/${eventType ?? ''}`;
    if (defaultPresetAppliedFor.current === presetsKey || templatesQuery.data === undefined) {
      return;
    }
    const startingFormat = leagueStartingFormatOf(
      templatesQuery.data,
      (format) => sportAllowsSelectionType(getSportDefinition(sport), format)
        && !(format === SelectionType.BUDGET_PICK && isBudgetUnavailable)
        && (selectedEvent === null || contestEventsFor([selectedEvent], format).length > 0),
    );
    if (startingFormat && startingFormat !== form.getValues('selectionType')) {
      defaultPresetAppliedFor.current = presetsKey;
      selectFormat(startingFormat);
      return;
    }
    if (!presets.length) {
      return;
    }
    defaultPresetAppliedFor.current = presetsKey;
    const defaultPreset = defaultPresetOf(presets);
    if (defaultPreset) {
      selectPreset(defaultPreset.id);
    }
  }, [eventType, form, isBudgetUnavailable, presets, selectFormat, selectPreset, selectedEvent, sport, sportLeagueId, templatesQuery.data]);

  // A requested template is settled once, when the templates of the event it starts on arrive: it
  // is applied over the league's default the effect above may have started on. With no event that
  // can start it, such as a second chance before its tournament, the page keeps that default.
  useEffect(() => {
    if (!requestedTemplate || requestedTemplateProgress.current !== 'event' || templatesQuery.data === undefined
      || sport !== requestedTemplate.sport || eventsQuery.data === undefined || selectedEvent === null
      || (requestedEvents.length > 0 && !requestedEvents.includes(selectedEvent))
      || !isCreatableSelectionType(requestedTemplate.selectionType)) {
      return;
    }
    requestedTemplateProgress.current = 'settled';
    const preset = presetsFor(requestedTemplate.selectionType).find((template) => template.id === requestedTemplate.id);
    if (!preset) {
      return;
    }
    defaultPresetAppliedFor.current = `${sport}/${sportLeagueId ?? ''}/${eventType ?? ''}`;
    setFormValues({ selectionType: requestedTemplate.selectionType, selectedTemplateId: preset.id, ...presetValues(preset.configuration) });
  }, [eventType, eventsQuery.data, presetValues, presetsFor, requestedEvents, requestedTemplate, selectedEvent, setFormValues, sport, sportLeagueId, templatesQuery.data]);

  // A preset the chosen event cannot start, such as a full bracket once the event is under way,
  // gives way to the format's default among the presets it can (#802), or to Custom.
  useEffect(() => {
    const templateId = form.getValues('selectedTemplateId');
    const offered = presetsFor(form.getValues('selectionType'));
    if (!templateId || templatesQuery.data === undefined || offered.some((template) => template.id === templateId)) {
      return;
    }
    const preset = defaultPresetOf(offered);
    setFormValues({ selectedTemplateId: preset?.id ?? '', ...(preset ? presetValues(preset.configuration) : {}) });
  }, [form, presetValues, presetsFor, selectedTemplateId, setFormValues, templatesQuery.data]);

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
    const countedScores = defaultCountedScoresFor(picksPerTier, tiersInPlayFor(form.getValues('tiersUsed'), tierCount));
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
      const event = selectableEvents.find((candidate) => candidate.id === submitted.sportEventId);
      if (!event) {
        throw new Error('Choose a contest-ready event for the contest.');
      }
      const submittedParticipant = getSportDefinition(submitted.sport).vocabulary.participant;
      const parsed = parseContestRules(submitted, submitted.selectionType, event.tierCount, submittedParticipant);
      if (parsed.error !== null) {
        throw new Error(parsed.error);
      }
      const scoring = scoringSettingsUiFor(submitted.selectionType, submitted.scoringDefinitionId).parse(submitted);
      if (scoring.error !== null) {
        throw new Error(scoring.error);
      }
      // A preset is an optional starting point; the configuration the form holds is always sent
      // and, with a preset, replaces the preset's (#245).
      const body: CreateContestRequest = {
        name: submitted.contestName.trim(),
        // A contest starts on one event; the commissioner adds more from its Events page (#713).
        sportEventIds: [event.id],
        contestFormat: contestFormatForSelectionType(submitted.selectionType),
        selectionType: submitted.selectionType,
        ...(submitted.selectionType === SelectionType.SQUARES ? { sportEventMatchId: submitted.sportEventMatchId } : {}),
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
      QueryKeys.plans.sportLeaguesUsedAll(league?.id),
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

  return (
    <FormPage
      cancelTo={buildLeagueAdminContestsPath(league.leagueCode)}
      description="Only commissioners see it until you open it to the league."
      errorMessage={errorMessage}
      isPending={createMutation.isPending}
      // The event's presets are still loading: a contest sent now would skip its default preset.
      isSubmitDisabled={!selectedEvent
        || templatesQuery.isPending
        || isSquaresGameMissing
        || rulesError !== null
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
        lead={selectionType === SelectionType.BRACKET
          ? `Released events that haven't started, and ${sportDefinition.vocabulary.event.many} under way for a second-chance bracket. Entries close at the ${sportDefinition.vocabulary.eventStart}, or at a second-chance bracket's first game.`
          : selectionType === SelectionType.PICK_EM || selectionType === SelectionType.SURVIVOR
            ? 'Released weeks that haven\'t started. Choose the first week of the contest; you add the rest of the season from its Events page. Each week closes at its first kickoff.'
            : selectionType === SelectionType.SQUARES
              ? `Released ${sportDefinition.vocabulary.event.many} with a game still to kick off. Choose the game the grid is played on; boxes close at its kickoff.`
              : `Released events that haven't started. Entries close at the ${sportDefinition.vocabulary.eventStart}.`}
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
        ) : !contestEvents.length ? (
          <NoEligibleEventsAlert sport={sportDefinition} />
        ) : (
          <EventChoices
            events={contestEvents}
            lockedEventIds={lockedEventIds}
            onSelect={(eventId) => {
              const event = selectableEvents.find((candidate) => candidate.id === eventId);
              if (event) {
                chooseEvent(event);
              }
            }}
            selectedEventId={sportEventId}
            sport={sportDefinition}
          />
        )}
        {sportLeagueCap !== null && selectedEvent ? (
          <p className="text-sm text-muted-foreground" data-testid="create-contest-sport-leagues-used">
            {`Sports leagues in ${selectedEvent.eventYear}: ${sportLeaguesUsed.get(selectedEvent.eventYear)?.length ?? 0} of ${sportLeagueCap}.`}
          </p>
        ) : null}
        {sportLeagueCap !== null && lockedEventIds.length ? (
          <Alert data-testid="create-contest-sport-leagues-locked">
            Your plan allows {pluralize(sportLeagueCap, 'sports league')} a year, so events in other sports
            leagues are locked for a year whose contests already use {sportLeagueCap === 1 ? 'it' : 'them all'}.
            {' '}
            <Link
              className="font-medium text-primary underline"
              data-testid="create-contest-plan-link"
              to={buildLeagueAdminPlanPath(league.leagueCode)}
            >
              Change plan
            </Link>
          </Alert>
        ) : null}
        {selectionType === SelectionType.SQUARES && selectedEvent ? (
          <SquaresGamePicker
            choices={squaresGames}
            event={selectedEvent}
            onChange={(next) => setFormValues({ sportEventMatchId: next })}
            value={sportEventMatchId}
          />
        ) : null}
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
        <div className="grid gap-2">
          <span className="text-sm text-muted-foreground">Start from</span>
          {/* Each template by its own name and description (#802), then Custom for rules typed by hand. */}
          <div aria-label="Start from" className="grid gap-2 md:grid-cols-2" role="radiogroup">
            {presets.map((template) => (
              <ChoiceCard
                isSelected={template.id === selectedTemplateId}
                key={template.id}
                onSelect={() => selectPreset(template.id)}
                testId={`contest-template-${template.templateKey}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{template.name}</span>
                  <span className="block text-xs text-muted-foreground">{template.description}</span>
                </span>
              </ChoiceCard>
            ))}
            <ChoiceCard
              isSelected={!selectedTemplateId}
              onSelect={() => selectPreset('')}
              testId="contest-template-custom"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Custom</span>
                <span className="block text-xs text-muted-foreground">Set every rule yourself.</span>
              </span>
            </ChoiceCard>
          </div>
        </div>
      </SetupSection>

      <SetupSection step={3} testId="create-contest-rules" title="Rules">
        <ContestRulesFields
          bracketStartRounds={bracketStartRounds}
          onChange={(next) => setFormValues({ ...next, selectedTemplateId: '' })}
          participant={participant}
          salaryCap={salaryCap}
          selectionType={selectionType}
          tierCount={tierCount}
          values={values}
        />
        {rulesError !== null ? (
          <p className="text-sm text-destructive" data-testid="contest-rules-error">{rulesError}</p>
        ) : null}
        {scoringSettingsUi.Fields ? (
          <scoringSettingsUi.Fields
            onChange={(next) => setFormValues({ ...next, selectedTemplateId: '' })}
            selectionType={selectionType}
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
                formatContestRules(parsedRules.configuration, tierCount, participant, salaryCap, roundName),
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

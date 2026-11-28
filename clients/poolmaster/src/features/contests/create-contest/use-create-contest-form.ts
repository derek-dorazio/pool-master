import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import {
  type ContestScoringSettings,
  eventSportDefinition,
  getSportDefinition,
  PlanCap,
  SelectionType,
  type Sport,
  sportAllowsSelectionType,
  sportVocabulary,
  suggestContestName,
  SUPPORTED_SPORTS,
} from '@poolmaster/shared/domain';
import { listContestConfigTemplates, type ContestConfigTemplateDto, type LeagueDto, type SportEventDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth/auth-context';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import { useSportLeaguesUsed } from '@/features/plans/use-sport-leagues-used';
import { contestEventsFor, contestEventsForTemplate } from '../contest-template-events';
import {
  DEFAULT_CONTEST_RULES,
  defaultCountedScoresFor,
  parseContestRules,
  toContestRulesValues,
} from '../contest-rules-form';
import {
  EMPTY_SCORING_SETTINGS_VALUES,
  SCORING_SETTINGS_UI,
  scoringSettingsUiFor,
} from '../contest-scoring-settings';
import { membersWillSeeRules } from '../members-will-see';
import { sportEventsQueryOptions } from '../sport-events-query';
import { useActiveContestTemplatesQuery } from '../use-active-contest-templates-query';
import { useSquaresGameChoices } from '../use-squares-game-choices';
import {
  type CreatableSelectionType,
  type CreateContestFormValues,
  createContestFormSchema,
  defaultPresetOf,
  definitionOfEvent,
  formatChoicesFor,
  isCreatableSelectionType,
  leagueStartingFormatOf,
} from './create-contest-helpers';

/**
 * Create contest's draft and everything read from it: the events on offer and the plan's locks,
 * the chosen event's presets, the parsed rules and scoring, and the choices that move the draft
 * (sport, event, format, preset). A preset is applied when its sport league's presets arrive, a
 * template asked for in the address is applied once, and the name follows the event and rules
 * until the commissioner types their own. The page draws it and owns the save.
 */
export function useCreateContestForm(league: Pick<LeagueDto, 'id' | 'planEntitlements'> | null) {
  const auth = useAuth();
  const form = useForm<CreateContestFormValues>({
    resolver: zodResolver(createContestFormSchema),
    defaultValues: {
      contestName: '',
      scoringDefinitionId: getSportDefinition(SUPPORTED_SPORTS[0]).scoringDefinitions[0],
      selectedTemplateId: '',
      selectionType: SelectionType.TIERED,
      sport: SUPPORTED_SPORTS[0],
      sportEventId: '',
      sportEventRoundMatchGameId: '',
      ...DEFAULT_CONTEST_RULES,
      ...EMPTY_SCORING_SETTINGS_VALUES,
    },
  });
  const values = form.watch();
  const { scoringDefinitionId, selectedTemplateId, selectionType, sport, sportEventId, sportEventRoundMatchGameId } = values;
  const scoringSettingsUi = scoringSettingsUiFor(selectionType, scoringDefinitionId);
  const [isNameEdited, setIsNameEdited] = useState(false);
  // The sport, sport league and slot definitions whose default preset was applied last: their
  // default is applied when their presets arrive and again on switching back to them; while they
  // stay, Custom stays Custom.
  const defaultPresetAppliedFor = useRef<string | null>(null);

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
  // poolmaster-allow-list-lookup: the active contest templates, reference data the picker lists anyway
  const requestedTemplate = requestedTemplateQuery.data?.find((template) => template.id === requestedTemplateId
    && isCreatableSelectionType(template.selectionType)) ?? null;
  const requestedTemplateProgress = useRef<'sport' | 'event' | 'settled'>('sport');
  // A contest type chosen in one sport league's section names it, `?sportLeague=<id>` (#1716): the
  // template starts on that league's soonest event.
  const requestedSportLeagueId = searchParams.get('sportLeague');
  // An event page's start (#1008) also names the edition, `?event=<id>`: chosen once, with the
  // template.
  const requestedEventId = searchParams.get('event');
  const requestedEventChosen = useRef(false);

  const eventsQuery = useQuery(sportEventsQueryOptions(sport, auth.isAuthenticated));
  // The sports a contest can be made in: each with a sport league still on. A sport whose every
  // league is switched off (#1812) is not offered; its events are not either.
  const sportLeaguesQuery = useSportLeaguesQuery();
  const offeredSports = useMemo(
    () => SUPPORTED_SPORTS.filter((candidate) => (sportLeaguesQuery.data ?? []).some((sportLeague) => sportLeague.sport === candidate && sportLeague.isActive)),
    [sportLeaguesQuery.data],
  );
  // A template is one sport league's, so its sport is that league's (#2010).
  // poolmaster-allow-list-lookup: the sport leagues, reference data the sport picker lists anyway
  const requestedTemplateSport = sportLeaguesQuery.data?.find((sportLeague) => sportLeague.id === requestedTemplate?.sportLeagueId)?.sport ?? null;

  const contestEvents = useMemo(
    () => contestEventsFor(eventsQuery.data ?? [], selectionType),
    [eventsQuery.data, selectionType],
  );
  // The plan's sports leagues a year (#947): the API says which offered sports leagues a new
  // contest in each championship year would put over the cap, and those events are locked.
  const sportLeagueCap = league?.planEntitlements.caps[PlanCap.SPORTS_LEAGUES_PER_YEAR] ?? null;
  const offerings = useMemo(() => {
    const byYear = new Map<number, Set<string>>();
    for (const event of contestEvents) {
      byYear.set(event.championshipYear, (byYear.get(event.championshipYear) ?? new Set()).add(event.sportLeagueId));
    }
    return [...byYear.entries()].sort(([left], [right]) => left - right)
      .map(([championshipYear, sportLeagueIds]) => ({ championshipYear, sportLeagueIds: [...sportLeagueIds].sort() }));
  }, [contestEvents]);
  const sportLeaguesUsed = useSportLeaguesUsed(league?.id, offerings, sportLeagueCap !== null);
  const lockedEventIds = useMemo(() => contestEvents.flatMap((event) => (
    sportLeaguesUsed.get(event.championshipYear)?.overCapSportLeagueIds.includes(event.sportLeagueId) ? [event.id] : []
  )), [contestEvents, sportLeaguesUsed]);
  const selectableEvents = useMemo(
    () => contestEvents.filter((event) => !lockedEventIds.includes(event.id)),
    [contestEvents, lockedEventIds],
  );
  const selectedEvent = selectableEvents.find((event) => event.id === sportEventId) ?? null;
  // The chosen event's definition, its sport's until one is chosen.
  const sportDefinition = selectedEvent ? eventSportDefinition(selectedEvent) : getSportDefinition(sport);
  const { participant } = sportVocabulary(sportDefinition);
  // The events that can start a requested template, whatever format the page is on, in the
  // requested sport league when the link names one.
  const requestedEvents = useMemo(
    () => (requestedTemplate
      ? contestEventsForTemplate(eventsQuery.data ?? [], requestedTemplate)
        .filter((event) => requestedSportLeagueId === null || event.sportLeagueId === requestedSportLeagueId)
      : []),
    [eventsQuery.data, requestedSportLeagueId, requestedTemplate],
  );
  // A squares contest's games: read once a squares contest's event is chosen.
  const squaresGames = useSquaresGameChoices(selectionType === SelectionType.SQUARES ? selectedEvent : null);
  const isSquaresGameMissing = selectionType === SelectionType.SQUARES
    && !squaresGames.games.some((choice) => choice.sportEventRoundMatchGameId === sportEventRoundMatchGameId);
  // The chosen event's sport league: only its own presets are offered, so the presets wait for an
  // event.
  const sportLeagueId = selectedEvent?.sportLeagueId;
  // The templates offered on the event are those covering one of its slot definitions (#2010): a
  // week's on a week of games, a knockout's on a knockout. An event with no slot is offered none.
  const slotDefinitionIds = selectedEvent?.slotDefinitionIds;
  // Which presets the default was applied for: the event's sport league and slot definitions.
  const presetsKey = JSON.stringify([sport, sportLeagueId ?? null, slotDefinitionIds ?? null]);

  const templatesQuery = useQuery({
    // An empty list, never undefined, while no event is chosen: undefined filters would share the
    // every-active-template key (`useActiveContestTemplatesQuery`) and offer those as presets.
    queryKey: QueryKeys.contestConfigTemplates.list({ sportLeagueId, slotDefinitionIds: slotDefinitionIds ?? [], active: true }),
    queryFn: async (): Promise<ContestConfigTemplateDto[]> => {
      if (!slotDefinitionIds?.length) return [];
      const response = await listContestConfigTemplates({
        query: { sportLeagueId, slotDefinitionIds, active: true },
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
  const rulesError = parsedRules.error;
  const parsedScoring = scoringSettingsUi.parse(values);

  // A preset's rules and, when it presets them, its scoring definition and settings. Without a
  // preset scoring, the contest scores by its sport's default definition.
  const presetValues = useCallback((configuration: (typeof presets)[number]['configuration']) => {
    const current = form.getValues();
    const scoring: ContestScoringSettings | undefined = configuration.scoring;
    const definitionId = scoring?.participantScoringDefinitionId
      ?? definitionOfEvent(current.sport, eventsQuery.data, current.sportEventId).scoringDefinitions[0];
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
  }, [eventsQuery.data, form]);

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

  const chooseEvent = useCallback((event: SportEventDto) => {
    const { scoringDefinitions } = eventSportDefinition(event);
    const current = form.getValues('scoringDefinitionId');
    setFormValues({
      sportEventId: event.id,
      // The chosen scoring stays while the event offers it; otherwise the event's first.
      scoringDefinitionId: scoringDefinitions.includes(current) ? current : scoringDefinitions[0],
    });
  }, [form, setFormValues]);

  // A squares contest starts on the API's default Game: the event's final when it is to come.
  const defaultSquaresGameId = squaresGames.defaultGameId;
  useEffect(() => {
    if (defaultSquaresGameId !== null && isSquaresGameMissing) {
      setFormValues({ sportEventRoundMatchGameId: defaultSquaresGameId });
    }
  }, [defaultSquaresGameId, isSquaresGameMissing, setFormValues]);

  // A requested template starts the page on its sport and format, so its events are listed. Its
  // sport is its league's, so the start waits for the sport leagues too.
  useEffect(() => {
    if (!requestedTemplate || requestedTemplateSport === null || requestedTemplateProgress.current !== 'sport' || !isCreatableSelectionType(requestedTemplate.selectionType)) {
      return;
    }
    requestedTemplateProgress.current = 'event';
    if (form.getValues('sport') !== requestedTemplateSport) {
      selectSport(requestedTemplateSport);
    }
    setFormValues({ selectionType: requestedTemplate.selectionType });
  }, [form, requestedTemplate, requestedTemplateSport, selectSport, setFormValues]);

  // The soonest contest-ready event is chosen to start with, else a knockout under way. Until a
  // requested template is settled, the soonest event that can start it, when it has one.
  useEffect(() => {
    const pendingEvents = requestedTemplateProgress.current === 'event' ? requestedEvents : [];
    const current = selectableEvents.find((event) => event.id === sportEventId);
    const requestedEvent = requestedEventChosen.current
      ? undefined
      : pendingEvents.find((event) => event.id === requestedEventId && selectableEvents.includes(event));
    if (requestedEvent) {
      requestedEventChosen.current = true;
      if (current !== requestedEvent) {
        chooseEvent(requestedEvent);
      }
      return;
    }
    if (current && (!pendingEvents.length || pendingEvents.includes(current))) {
      return;
    }
    const choices = pendingEvents.length ? pendingEvents.filter((event) => selectableEvents.includes(event)) : selectableEvents;
    const soonest = choices.find((event) => event.contestEligible) ?? choices.at(0);
    if (soonest) {
      chooseEvent(soonest);
    }
  }, [chooseEvent, requestedEventId, requestedEvents, selectableEvents, sportEventId]);

  // A newly chosen sport, sport league or event's slot definitions start on their default preset;
  // while they stay, Custom stays Custom. A sport league starts on the format its defaults sort first
  // (the Formula 1 default is a budget contest, #625; an NFL week a pick'em, #802), unless the
  // sport does not offer it, the event has no prices for it yet, or the event cannot take it (a
  // knockout under way takes only a second-chance bracket or squares).
  useEffect(() => {
    if (defaultPresetAppliedFor.current === presetsKey || templatesQuery.data === undefined) {
      return;
    }
    const startingFormat = leagueStartingFormatOf(
      templatesQuery.data,
      (format) => sportAllowsSelectionType(sportDefinition, format)
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
  }, [form, isBudgetUnavailable, presets, presetsKey, selectFormat, selectPreset, selectedEvent, sportDefinition, templatesQuery.data]);

  // A requested template is settled once, when the templates of the event it starts on arrive: it
  // is applied over the league's default the effect above may have started on. With no event that
  // can start it, such as a second chance before its tournament, the page keeps that default.
  useEffect(() => {
    if (!requestedTemplate || requestedTemplateProgress.current !== 'event' || templatesQuery.data === undefined
      || sport !== requestedTemplateSport || eventsQuery.data === undefined || selectedEvent === null
      || (requestedEvents.length > 0 && !requestedEvents.includes(selectedEvent))
      || !isCreatableSelectionType(requestedTemplate.selectionType)) {
      return;
    }
    requestedTemplateProgress.current = 'settled';
    const preset = presetsFor(requestedTemplate.selectionType).find((template) => template.id === requestedTemplate.id);
    if (!preset) {
      return;
    }
    defaultPresetAppliedFor.current = presetsKey;
    setFormValues({
      selectionType: requestedTemplate.selectionType,
      selectedTemplateId: preset.id,
      ...presetValues(preset.configuration),
    });
  }, [eventsQuery.data, presetValues, presetsFor, presetsKey, requestedEvents, requestedTemplate, requestedTemplateSport, selectedEvent, setFormValues, sport, templatesQuery.data]);

  // A preset the chosen event does not offer, or none at all, gives way to the format's default
  // among the presets it does (#802): every contest starts from one (#2014).
  useEffect(() => {
    const templateId = form.getValues('selectedTemplateId');
    const offered = presetsFor(form.getValues('selectionType'));
    if (templatesQuery.data === undefined || offered.some((template) => template.id === templateId)) {
      return;
    }
    const preset = defaultPresetOf(offered);
    if (!templateId && !preset) {
      return;
    }
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

  // The sentence members read about the contest: its rules, how picks score, and its entries.
  const memberRules = parsedRules.configuration
    ? membersWillSeeRules(parsedRules.configuration, parsedScoring.scoring, { participant, salaryCap, tierCount })
    : null;

  return {
    chooseEvent,
    contestEvents,
    eventsQuery,
    form,
    isBudgetUnavailable,
    isSquaresGameMissing,
    lockedEventIds,
    memberRules,
    offeredSports,
    parsedScoring,
    presets,
    rulesError,
    /** The rules as they stand, or null while they don't read: what the picks preview draws. */
    rulesConfiguration: rulesError === null ? parsedRules.configuration : null,
    salaryCap,
    scoringSettingsUi,
    selectFormat,
    selectPreset,
    selectSport,
    selectableEvents,
    selectedEvent,
    setFormValues,
    setIsNameEdited,
    sportDefinition,
    sportLeagueCap,
    sportLeaguesUsed,
    squaresGames,
    templatesQuery,
    tierCount,
    values,
  };
}

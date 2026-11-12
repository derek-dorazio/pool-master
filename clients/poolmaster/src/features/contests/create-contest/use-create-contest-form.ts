import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import {
  type ContestScoringSettings,
  PlanCap,
  SUPPORTED_SPORTS,
  SelectionType,
  type Sport,
  contestTemplateEventTypeOf,
  eventSportDefinition,
  getSportDefinition,
  sportAllowsSelectionType,
  suggestContestName,
} from '@poolmaster/shared/domain';
import { listContestConfigTemplates, type ContestConfigTemplateDto, type LeagueDto, type SportEventDto } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useAuth } from '@/features/auth/auth-context';
import { useSportLeaguesUsed } from '@/features/plans/use-sport-leagues-used';
import { bracketRoundCount, bracketStartRoundOptions } from '../bracket-start-round';
import { canEventStartRules, contestEventsFor, contestEventsForTemplate } from '../contest-template-events';
import {
  DEFAULT_CONTEST_RULES,
  defaultCountedScoresFor,
  parseContestRules,
  tiersInPlayFor,
  toContestRulesValues,
} from '../contest-rules-form';
import {
  EMPTY_SCORING_SETTINGS_VALUES,
  SCORING_SETTINGS_UI,
  scoringSettingsUiFor,
} from '../contest-scoring-settings';
import { membersWillSeeRules } from '../members-will-see';
import { statPoolContestName, statPoolScoringLine } from '../scoring-family-ui/stat-pool-copy';
import { sportEventsQueryOptions } from '../sport-events-query';
import { useActiveContestTemplatesQuery } from '../use-active-contest-templates-query';
import { useEventRoundName } from '../use-bracket-round-label';
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
      sportEventMatchId: '',
      ...DEFAULT_CONTEST_RULES,
      ...EMPTY_SCORING_SETTINGS_VALUES,
    },
  });
  const values = form.watch();
  const { scoringDefinitionId, selectedTemplateId, selectionType, sport, sportEventId, sportEventMatchId } = values;
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
  // poolmaster-allow-list-lookup: the active contest templates, reference data the picker lists anyway
  const requestedTemplate = requestedTemplateQuery.data?.find((template) => template.id === requestedTemplateId
    && isCreatableSelectionType(template.selectionType)) ?? null;
  const requestedTemplateProgress = useRef<'sport' | 'event' | 'settled'>('sport');
  // An event page's start (#1008) also names the edition, `?event=<id>`, and a later-round
  // bracket's first round, `?startRound=<n>`: chosen once, with the template.
  const requestedEventId = searchParams.get('event');
  const requestedStartRound = searchParams.get('startRound');
  const requestedEventChosen = useRef(false);

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
  // The chosen event's definition, its sport's until one is chosen: a stat pool event plays its
  // sport's composite with players (#936), not its bracket.
  const sportDefinition = selectedEvent ? eventSportDefinition(selectedEvent) : getSportDefinition(sport);
  const { participant } = sportDefinition.vocabulary;
  const statPoolScoring = statPoolScoringLine(sportDefinition);
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

  // A contest-ready event takes the full bracket; a knockout under way starts its second-chance
  // bracket at the first round it offers.
  const chooseEvent = useCallback((event: SportEventDto) => {
    const { scoringDefinitions } = eventSportDefinition(event);
    const current = form.getValues('scoringDefinitionId');
    setFormValues({
      sportEventId: event.id,
      startsAtRound: event.contestEligible ? '1' : '2',
      // A stat pool event scores by its composite, whatever the sport's bracket scores by.
      scoringDefinitionId: scoringDefinitions.includes(current) ? current : scoringDefinitions[0],
    });
  }, [form, setFormValues]);

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
  }, [eventType, form, isBudgetUnavailable, presets, selectFormat, selectPreset, selectedEvent, sport, sportDefinition, sportLeagueId, templatesQuery.data]);

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
    setFormValues({
      selectionType: requestedTemplate.selectionType,
      selectedTemplateId: preset.id,
      ...presetValues(preset.configuration),
      ...(requestedStartRound && requestedTemplate.selectionType === SelectionType.BRACKET ? { startsAtRound: requestedStartRound } : {}),
    });
  }, [eventType, eventsQuery.data, presetValues, presetsFor, requestedEvents, requestedStartRound, requestedTemplate, selectedEvent, setFormValues, sport, sportLeagueId, templatesQuery.data]);

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

  // The name follows the event and the rules until the commissioner types their own; a Clutch
  // Card is "<event> Stars" whichever way its stars are picked (#995).
  const suggestedName = selectedEvent
    ? statPoolScoring !== null
      ? statPoolContestName(selectedEvent.name)
      : suggestContestName(selectedEvent.name, selectionType, parsedRules.configuration, tierCount)
    : '';
  useEffect(() => {
    if (!isNameEdited && suggestedName && form.getValues('contestName') !== suggestedName) {
      form.setValue('contestName', suggestedName);
    }
  }, [form, isNameEdited, suggestedName]);

  // The sentence members read about the contest: its rules, how picks score, and its entries.
  const memberRules = parsedRules.configuration
    ? membersWillSeeRules(parsedRules.configuration, parsedScoring.scoring, { participant, roundName, salaryCap, tierCount })
    : null;

  return {
    bracketStartRounds,
    chooseEvent,
    contestEvents,
    eventsQuery,
    form,
    isBudgetUnavailable,
    isSquaresGameMissing,
    lockedEventIds,
    memberRules,
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
    statPoolScoring,
    templatesQuery,
    tierCount,
    values,
  };
}

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CreateContestRequest } from '@poolmaster/shared/dto';
import {
  SelectionType,
  contestFormatForSelectionType,
  eventSportDefinition,
} from '@poolmaster/shared/domain';
import { createContest } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildLeagueAdminContestPath, buildLeagueAdminContestsPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ErrorState, FormPage } from '@/features/shared/ui';
import { CONTEST_RELEASE_CODE_MESSAGES } from '../contest-release-messages';
import { parseContestRules } from '../contest-rules-form';
import { scoringSettingsUiFor } from '../contest-scoring-settings';
import { MemberPreview } from '../member-preview';
import { PickPreviewAction } from '../pick-preview-dialog';
import type { CreateContestFormValues } from './create-contest-helpers';
import { CreateContestEventSection } from './create-contest-event-section';
import { CreateContestFormatSection } from './create-contest-format-section';
import { CreateContestNameSection } from './create-contest-name-section';
import { CreateContestRulesSection } from './create-contest-rules-section';
import { useCreateContestForm } from './use-create-contest-form';

/**
 * Commissioner tools › Contests › Create contest: one page in four numbered sections. Event,
 * then format with a preset to start from, then the rules, then a name suggested from the event
 * until the commissioner types their own, and under them what members will see. Create lands on
 * the new contest's page, where it can still change until it is opened to the league. The draft
 * lives in `useCreateContestForm`; this page loads it, lays out its sections and saves it.
 */
export function CreateContestPage() {
  const logger = getLogger().child({ feature: 'create-contest-page' });
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const navigate = useNavigate();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const draft = useCreateContestForm(league ?? null);
  const {
    eventsQuery,
    form,
    selectableEvents,
    selectedEvent,
    templatesQuery,
    values,
  } = draft;
  const { sportEventId } = values;

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
      const submittedParticipant = eventSportDefinition(event).vocabulary.participant;
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
      void navigate(buildLeagueAdminContestPath(leagueCode, savedContestId));
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
        body="We couldn't load this contest's setup."
        onRetry={() => void templatesQuery.refetch()}
        testId="create-contest-page-error"
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
  // Any rule or scoring changed by hand leaves the preset for Custom.
  const changeRules = (next: Partial<CreateContestFormValues>) => draft.setFormValues({ ...next, selectedTemplateId: '' });

  return (
    <FormPage
      cancelTo={buildLeagueAdminContestsPath(league.leagueCode)}
      help="Only commissioners see it until you open it to the league."
      errorMessage={errorMessage}
      extraAction={(
        <PickPreviewAction
          configuration={draft.rulesConfiguration}
          contestName={values.contestName}
          event={selectedEvent}
          leagueId={league.id}
          participant={draft.sportDefinition.vocabulary.participant}
          rulesError={draft.rulesError}
          selectionType={values.selectionType}
          tierCount={draft.tierCount}
        />
      )}
      isPending={createMutation.isPending}
      // The event's presets are still loading: a contest sent now would skip its default preset.
      isSubmitDisabled={!selectedEvent
        || templatesQuery.isPending
        || draft.isSquaresGameMissing
        || draft.rulesError !== null
        || draft.parsedScoring.error !== null
        || (values.selectionType === SelectionType.BUDGET_PICK && draft.isBudgetUnavailable)}
      onSubmit={(submitEvent) => {
        createMutation.reset();
        void form.handleSubmit((submitted) => {
          createMutation.mutate(submitted);
        })(submitEvent);
      }}
      pendingLabel="Creating..."
      preview={selectedEvent && draft.memberRules !== null ? (
        <MemberPreview eventName={selectedEvent.name} name={values.contestName} rules={draft.memberRules} selectionType={values.selectionType} />
      ) : null}
      submitLabel="Create contest"
      submitTestId="create-contest-submit"
      testId="create-contest-page"
      title="Create contest"
    >
      <CreateContestEventSection
        contestEvents={draft.contestEvents}
        eventsQuery={eventsQuery}
        leagueCode={league.leagueCode}
        lockedEventIds={draft.lockedEventIds}
        onChooseEvent={(eventId) => {
          const event = selectableEvents.find((candidate) => candidate.id === eventId);
          if (event) {
            draft.chooseEvent(event);
          }
        }}
        onSelectSport={draft.selectSport}
        onSquaresGameChange={(next) => draft.setFormValues({ sportEventMatchId: next })}
        selectedEvent={selectedEvent}
        selectionType={values.selectionType}
        sport={values.sport}
        sportDefinition={draft.sportDefinition}
        sportEventId={sportEventId}
        sportEventMatchId={values.sportEventMatchId}
        sportLeagueCap={draft.sportLeagueCap}
        sportLeaguesUsedThisYear={selectedEvent ? draft.sportLeaguesUsed.get(selectedEvent.eventYear)?.length ?? 0 : 0}
        squaresGames={draft.squaresGames}
      />
      <CreateContestFormatSection
        isBudgetUnavailable={draft.isBudgetUnavailable}
        onSelectFormat={draft.selectFormat}
        onSelectPreset={draft.selectPreset}
        presets={draft.presets}
        selectedTemplateId={values.selectedTemplateId}
        selectionType={values.selectionType}
        sportDefinition={draft.sportDefinition}
      />
      <CreateContestRulesSection
        bracketStartRounds={draft.bracketStartRounds}
        onChange={changeRules}
        rulesError={draft.rulesError}
        salaryCap={draft.salaryCap}
        ScoringFields={draft.scoringSettingsUi.Fields}
        scoringError={draft.parsedScoring.error}
        sportDefinition={draft.sportDefinition}
        statPoolScoring={draft.statPoolScoring}
        tierCount={draft.tierCount}
        values={values}
      />
      <CreateContestNameSection
        onChange={(name) => {
          draft.setIsNameEdited(true);
          form.setValue('contestName', name, { shouldDirty: true });
        }}
        value={values.contestName}
      />
    </FormPage>
  );
}

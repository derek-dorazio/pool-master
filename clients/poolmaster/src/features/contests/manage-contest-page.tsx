import {
  ContestStatus,
  SelectionType,
  type SportNoun,
  countParticipants,
  formatContestRules,
  formatEntriesPerTeam,
  formatSelectionTypeName,
  getSportDefinition,
} from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { Lock, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteContest, type EffectiveTierDto } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  buildLeagueAdminContestEditPath,
  buildLeagueAdminContestEventsPath,
  buildLeagueAdminContestsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import {
  Alert,
  Button,
  Chip,
  ConfirmDialog,
  DangerZone,
  DangerZoneAction,
  DateDisplay,
  EmptyState,
  ErrorState,
  IdentityHeading,
  LinkButton,
  LoadingState,
  SettingsRow,
  SettingsSection,
} from '@/features/shared/ui';
import { useLeagueSquadsQuery } from '@/features/teams/use-league-squads-query';
import { coversOneEvent, firstContestEvent } from './contest-events';
import { ContestStatusBadge } from './contest-status-badge';
import { ContestStatusCard } from './contest-status-card';
import { secondChanceRoundName } from './bracket-start-round';
import { useEventRoundName } from './use-bracket-round-label';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useLeagueContestsQuery } from './use-league-contests-query';
import { useManagedContestQuery } from './use-managed-contest-query';

function FixedNote() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="Set when the contest was created">
      <Lock aria-hidden size={13} />
      Fixed
    </span>
  );
}

/** The event's tiers, Tier 1 on top, one per row with its golfer count. */
function ContestTiersSection({
  eventName,
  noun,
  tiers,
  title,
}: {
  eventName: string;
  noun: SportNoun;
  tiers: EffectiveTierDto[];
  title: string;
}) {
  const sortedTiers = [...tiers].sort((left, right) => left.tierNumber - right.tierNumber);

  return (
    <SettingsSection
      description={`From the event, top tier first. Every contest on ${eventName} uses the same tiers.`}
      testId="contest-tiers"
      title={title}
    >
      {sortedTiers.length ? (
        sortedTiers.map((tier) => (
          <SettingsRow
            key={tier.tierKey}
            label={<Chip tone="info">Tier {tier.tierNumber}</Chip>}
            testId={`contest-tier-${tier.tierNumber}`}
            value={countParticipants(tier.assignments.length, noun)}
          />
        ))
      ) : (
        <div className="px-5 py-3.5 text-sm text-muted-foreground" data-testid="contest-tiers-empty">
          The event has no tiers yet. An admin sets them before the event is released.
        </div>
      )}
    </SettingsSection>
  );
}

/**
 * Commissioner tools › Contests › one contest: its status and next step first, then its settings
 * as rows with one Edit while it is not open, its tiers, and Delete contest in the danger zone.
 */
export function ManageContestPage() {
  const logger = getLogger().child({ feature: 'manage-contest-page' });
  const navigate = useNavigate();
  const { leagueCode = '', contestId = '' } = useParams<{ leagueCode: string; contestId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { league } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const managedContestQuery = useManagedContestQuery(league?.id, contestId);
  const teamsQuery = useLeagueSquadsQuery(leagueId);
  const contest = contestsQuery.data?.find((candidate) => candidate.id === contestId) ?? null;
  // The first event: its start is when entries close, and the status card counts down to it.
  const firstEventId = (contest ? firstContestEvent(contest)?.sportEventId : undefined)
    ?? managedContestQuery.data?.sportEvents.at(0)?.sportEventId;
  const eventQuery = useQuery(sportEventQueryOptions(firstEventId ?? ''));
  // A bracket's rounds are named for where it starts (#721); other formats read no round names.
  const roundName = useEventRoundName(contest?.selectionType === SelectionType.BRACKET ? eventQuery.data ?? null : null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const contestsPath = buildLeagueAdminContestsPath(leagueCode);

  const deleteContestMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await deleteContest({ path: { contestId } });
      if (response.error) {
        throwApiError(response.error);
      }
    },
    onSuccess: () => {
      logger.info({ action: 'contest.delete.succeeded', data: { leagueCode, contestId } }, 'Deleted contest');
      navigate(contestsPath);
    },
    invalidates: [QueryKeys.contests.list({ leagueId }), QueryKeys.managedContests.all],
    onError: (error) => {
      const payload = { action: 'contest.delete.failed', data: { leagueCode, contestId }, err: error };
      if (error instanceof ApiError) {
        logger.warn(payload, 'Contest delete was rejected');
      } else {
        logger.error(payload, 'Contest delete failed unexpectedly');
      }
    },
  });

  if (!league) {
    return null;
  }
  if (contestsQuery.isLoading || managedContestQuery.isLoading || eventQuery.isLoading) {
    return <LoadingState body="Loading contest..." testId="manage-contest-loading" />;
  }
  if (contestsQuery.isError || managedContestQuery.isError || eventQuery.isError) {
    return (
      <ErrorState
        body="Try again in a moment."
        testId="manage-contest-error"
        title="We couldn't load this contest."
      />
    );
  }
  const managedContest = managedContestQuery.data;
  const event = eventQuery.data;
  if (!contest || !managedContest || !event) {
    return (
      <EmptyState
        action={<LinkButton to={contestsPath} variant="secondary">All contests</LinkButton>}
        body="It may have been deleted."
        testId="manage-contest-not-found"
        title="This contest isn't in this league"
      />
    );
  }

  const isNotOpen = contest.status === ContestStatus.DRAFT;
  const isTiered = contest.selectionType === SelectionType.TIERED;
  const activeTeamCount = (teamsQuery.data ?? []).filter((team) => team.isActive).length;
  const { configuration } = managedContest;
  const rules = formatContestRules(
    configuration,
    managedContest.sportEvents.at(0)?.effectiveTiers.length ?? 0,
    getSportDefinition(event.sport).vocabulary.participant,
    configuration.selectionType === SelectionType.BUDGET_PICK ? configuration.salaryCap : null,
    roundName,
  );
  const bracketStartRoundName = configuration.selectionType === SelectionType.BRACKET
    ? secondChanceRoundName(configuration.startsAtRound, roundName)
    : null;
  const eventLabel = event.venue ? `${event.name} · ${event.venue}` : event.name;
  const isMultiEvent = contest.sportEvents.length > 1;
  // Events can change until the contest is final; a random draw deals one event, once, and a
  // bracket is one knockout.
  const canChangeEvents = league.isActive
    && contest.status !== ContestStatus.COMPLETED
    && !coversOneEvent(contest.selectionType);
  const eventNamesById = new Map(contest.sportEvents.map((sportEvent) => [sportEvent.sportEventId, sportEvent.name]));

  function closeDeleteDialog() {
    if (!deleteContestMutation.isPending) {
      deleteContestMutation.reset();
      setIsDeleteOpen(false);
    }
  }

  return (
    <section className="space-y-8" data-testid="manage-contest-page">
      <IdentityHeading
        icon={<Trophy aria-hidden size={22} />}
        meta={(
          <>
            <ContestStatusBadge status={contest.status} />
            <span data-testid="manage-contest-event">
              {event.name} · Starts <DateDisplay className="text-muted-foreground" value={event.startDate} />
            </span>
          </>
        )}
        name={contest.name}
        testId="manage-contest-identity"
      />

      <ContestStatusCard
        contest={contest}
        event={event}
        leagueCode={leagueCode}
        secondChanceRoundName={bracketStartRoundName}
        teamCount={activeTeamCount}
      />

      <SettingsSection
        action={isNotOpen ? (
          <LinkButton
            data-testid="manage-contest-edit"
            isDisabled={!league.isActive}
            size="sm"
            to={buildLeagueAdminContestEditPath(leagueCode, contest.id)}
            variant="secondary"
          >
            Edit
          </LinkButton>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="manage-contest-locked">
            <Lock aria-hidden size={13} />
            Locked
          </span>
        )}
        description={isNotOpen
          ? 'What members will see when they enter.'
          : 'Settings locked when you opened it to the league.'}
        testId="manage-contest-settings"
        title="Contest"
      >
        <SettingsRow label="Name" testId="manage-contest-name" value={<span className="font-semibold">{contest.name}</span>} />
        <SettingsRow
          action={canChangeEvents ? (
            <LinkButton
              data-testid="manage-contest-events-edit"
              size="sm"
              to={buildLeagueAdminContestEventsPath(leagueCode, contest.id)}
              variant="secondary"
            >
              {isMultiEvent ? 'Change events' : 'Add events'}
            </LinkButton>
          ) : isNotOpen ? <FixedNote /> : undefined}
          label={isMultiEvent ? `Events (${contest.sportEvents.length})` : 'Event'}
          testId="manage-contest-event-row"
          value={(
            <>
              {isMultiEvent ? (
                <ol className="space-y-0.5" data-testid="manage-contest-event-list">
                  {contest.sportEvents.map((sportEvent) => (
                    <li key={sportEvent.sportEventId}>
                      {sportEvent.name}
                      <span className="text-xs text-muted-foreground">
                        {' · '}<DateDisplay className="text-muted-foreground" value={sportEvent.startDate} />
                      </span>
                    </li>
                  ))}
                </ol>
              ) : eventLabel}
              <div className="text-xs text-muted-foreground">
                {isMultiEvent ? 'The first event starts ' : 'Starts '}
                <DateDisplay className="text-muted-foreground" value={event.startDate} />.
                {contest.selectionType === SelectionType.RANDOM_DRAW
                  ? ' Entries close when you run the draw, which must be before then.'
                  : ' Entries close then.'}
              </div>
            </>
          )}
        />
        <SettingsRow
          action={isNotOpen ? <FixedNote /> : undefined}
          label="Format"
          testId="manage-contest-format"
          value={formatSelectionTypeName(contest.selectionType)}
        />
        <SettingsRow label="Rules" testId="manage-contest-rules" value={rules} />
        <SettingsRow
          label="Entries per member"
          testId="manage-contest-entries-per-team"
          value={formatEntriesPerTeam(configuration.maxEntriesPerSquad)}
        />
      </SettingsSection>

      {isTiered ? managedContest.sportEvents.map((managedEvent) => (
        <ContestTiersSection
          eventName={eventNamesById.get(managedEvent.sportEventId) ?? event.name}
          key={managedEvent.sportEventId}
          noun={getSportDefinition(event.sport).vocabulary.participant}
          tiers={managedEvent.effectiveTiers}
          title={isMultiEvent ? `Tiers · ${eventNamesById.get(managedEvent.sportEventId) ?? event.name}` : 'Tiers'}
        />
      )) : null}

      {isNotOpen ? (
        <DangerZone testId="manage-contest-danger-zone">
          <DangerZoneAction
            action={(
              <Button
                data-testid="contest-delete"
                disabled={!league.isActive}
                onClick={() => setIsDeleteOpen(true)}
                variant="danger"
              >
                Delete contest
              </Button>
            )}
            description="Removes this contest for good. Possible only until you open it to the league."
            title="Delete contest"
          />
        </DangerZone>
      ) : null}

      <ConfirmDialog
        confirmLabel="Delete contest"
        description={`${contest.name} will be removed for good. Members never saw it.`}
        isPending={deleteContestMutation.isPending}
        onCancel={closeDeleteDialog}
        onConfirm={() => void deleteContestMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setIsDeleteOpen(true);
            return;
          }
          closeDeleteDialog();
        }}
        open={isDeleteOpen}
        pendingLabel="Deleting..."
        testId="contest-delete-dialog"
        title="Delete this contest?"
        tone="danger"
      >
        {deleteContestMutation.isError ? (
          <Alert data-testid="contest-delete-error" tone="danger">
            {extractErrorMessage(deleteContestMutation.error, {
              fallback: 'We could not delete that contest. Please try again.',
            })}
          </Alert>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}

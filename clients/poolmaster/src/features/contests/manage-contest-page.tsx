import { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import { useQuery } from '@tanstack/react-query';
import { Lock, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteContest, type GolfEffectiveTierDto } from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  buildLeagueAdminContestEditPath,
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
import { formatContestRules, formatEntriesPerTeam, formatSelectionTypeName } from './contest-rules';
import { ContestStatusBadge } from './contest-status-badge';
import { ContestStatusCard } from './contest-status-card';
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
function ContestTiersSection({ eventName, tiers }: { eventName: string; tiers: GolfEffectiveTierDto[] }) {
  const sortedTiers = [...tiers].sort((left, right) => left.tierNumber - right.tierNumber);

  return (
    <SettingsSection
      description={`From the event, top tier first. Every contest on ${eventName} uses the same tiers.`}
      testId="contest-tiers"
      title="Tiers"
    >
      {sortedTiers.length ? (
        sortedTiers.map((tier) => (
          <SettingsRow
            key={tier.tierKey}
            label={<Chip tone="info">Tier {tier.tierNumber}</Chip>}
            testId={`contest-tier-${tier.tierNumber}`}
            value={`${tier.assignments.length} golfer${tier.assignments.length === 1 ? '' : 's'}`}
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
  const eventQuery = useQuery(
    sportEventQueryOptions(contest?.sportEventId ?? managedContestQuery.data?.sportEventId ?? ''),
  );
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
  const rules = formatContestRules(contest.selectionType, configuration, managedContest.effectiveTiers.length);
  const eventLabel = event.venue ? `${event.name} · ${event.venue}` : event.name;

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

      <ContestStatusCard contest={contest} event={event} leagueCode={leagueCode} teamCount={activeTeamCount} />

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
          action={isNotOpen ? <FixedNote /> : undefined}
          label="Event"
          testId="manage-contest-event-row"
          value={(
            <>
              {eventLabel}
              <div className="text-xs text-muted-foreground">
                Starts <DateDisplay className="text-muted-foreground" value={event.startDate} />. Entries close then.
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
          label="Entries per team"
          testId="manage-contest-entries-per-team"
          value={formatEntriesPerTeam(configuration.maxEntriesPerSquad)}
        />
      </SettingsSection>

      {isTiered ? <ContestTiersSection eventName={event.name} tiers={managedContest.effectiveTiers} /> : null}

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

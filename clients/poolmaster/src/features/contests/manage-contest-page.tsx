import {
  ContestStatus,
  countParticipants,
  formatContestRules,
  formatEntriesPerTeam,
  formatSelectionTypeName,
  PlanFeature,
  SelectionType,
  type SportNoun,
  sportVocabulary,
} from '@poolmaster/shared/domain';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import { useQuery } from '@tanstack/react-query';
import { Lock, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { EffectiveTierDto } from '@/lib/api';
import { hasErrorCode } from '@/lib/errors';
import { ContestExpansionSection } from '@/features/billing/contest-expansion-section';
import {
  buildLeagueAdminContestCupWeightPath,
  buildLeagueAdminContestEditPath,
  buildLeagueAdminContestsPath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { hasPlanFeature } from '@/features/plans/plan-features';
import {
  Button,
  Chip,
  DateDisplay,
  EmptyState,
  ErrorState,
  HelpTip,
  LinkButton,
  LoadingState,
  PendingPage,
  PageHeader,
  refetchFailed,
  SectionCard,
  SectionEmpty,
  SectionRow,
  SectionRows,
  Text,
} from '@/features/shared/ui';
import { eventOfFirstSlot, eventOfSlot } from './contest-events';
import { ContestStatusBadge } from './contest-status-badge';
import { ContestStatusCard } from './contest-status-card';
import { ChangeContestEventDialog } from './change-contest-event-dialog';
import { DeleteContestDialog } from './delete-contest-dialog';
import { sportEventQueryOptions } from './use-contest-schedule';
import { useContestQuery } from './use-contest-query';
import { useManagedContestQuery } from './use-managed-contest-query';

function FixedNote() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock aria-hidden size={13} />
      Fixed
      <HelpTip className="-my-2 -ml-2" label="Why this is fixed" testId="manage-contest-fixed-help">Set when the contest was created.</HelpTip>
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
    <SectionCard
      help={`From the event, top tier first. Every contest on ${eventName} uses the same tiers. An admin sets them before the event is released.`}
      testId="contest-tiers"
      title={title}
    >
      {sortedTiers.length ? (
        <SectionRows>
          {sortedTiers.map((tier) => (
            <SectionRow
              layout="setting"
              key={tier.tierKey}
              name={<Chip tone="info">Tier {tier.tierNumber}</Chip>}
              testId={`contest-tier-${tier.tierNumber}`}
              value={countParticipants(tier.assignments.length, noun)}
            />
          ))}
        </SectionRows>
      ) : (
        <SectionEmpty testId="contest-tiers-empty">No tiers yet.</SectionEmpty>
      )}
    </SectionCard>
  );
}

/**
 * Commissioner tools › Contests › one contest: its status and next step first, then its settings
 * as rows with one Edit while it is not open, how much it counts toward its cup until it is
 * final, its tiers, and Delete contest in the danger zone.
 */
export function ManageContestPage() {
  const navigate = useNavigate();
  const { leagueCode = '', contestId = '' } = useParams<{ leagueCode: string; contestId: string }>();
  // `CommissionerRouteGuard` has loaded the league and admitted the viewer before this renders.
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const contestQuery = useContestQuery(contestId);
  const managedContestQuery = useManagedContestQuery(league?.id, contestId);
  const contest = contestQuery.data ?? null;
  // The first event: its start is when entries close, and the status card counts down to it.
  const firstEventId = (contest ? eventOfFirstSlot(contest)?.sportEventId : undefined)
    ?? managedContestQuery.data?.sportEvents.at(0)?.sportEventId;
  const eventQuery = useQuery(sportEventQueryOptions(firstEventId ?? ''));
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isChangeEventOpen, setIsChangeEventOpen] = useState(false);
  const contestsPath = buildLeagueAdminContestsPath(leagueCode);

  if (!league) {
    return null;
  }
  if (contestQuery.isLoading || managedContestQuery.isLoading || eventQuery.isLoading) {
    return <PendingPage spacing={8} testId="manage-contest-pending"><LoadingState body="Loading contest..." testId="manage-contest-loading" /></PendingPage>;
  }
  // A contest that is gone answers CONTEST_NOT_FOUND; one of another league is not this league's either.
  const isContestMissing = hasErrorCode(contestQuery.error, 'CONTEST_NOT_FOUND')
    || (contest !== null && contest.leagueId !== league.id);
  if ((contestQuery.isError && !isContestMissing) || managedContestQuery.isError || eventQuery.isError) {
    return (
      <PendingPage spacing={8} testId="manage-contest-pending">
        <ErrorState
          body="We couldn't load this contest."
          onRetry={refetchFailed(contestQuery, managedContestQuery, eventQuery)}
          testId="manage-contest-error"
        />
      </PendingPage>
    );
  }
  const managedContest = managedContestQuery.data;
  const event = eventQuery.data;
  if (!contest || isContestMissing || !managedContest || !event) {
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
  const activeTeamCount = leagueQuery.data?.activeTeamCount ?? 0;
  const { configuration } = managedContest;
  // Every event of a tiered contest has the same number of tiers; the server checks it.
  const tierCount = managedContest.sportEvents.at(0)?.effectiveTiers.length ?? 0;
  const rules = formatContestRules(
    configuration,
    tierCount,
    sportVocabulary(event.sport).participant,
    configuration.selectionType === SelectionType.BUDGET_PICK ? configuration.salaryCap : null,
  );
  const eventLabel = event.venue ? `${event.name} · ${event.venue}` : event.name;
  const isMultiEvent = contest.sportEvents.length > 1;
  const eventNamesById = new Map(contest.sportEvents.map((sportEvent) => [sportEvent.sportEventId, sportEvent.name]));

  return (
    <section className="space-y-8" data-testid="manage-contest-page">
      <PageHeader
        icon={<Trophy aria-hidden size={22} />}
        meta={(
          <span data-testid="manage-contest-event">
            {event.name} · Starts <DateDisplay tone="inherit" value={event.startDate} />
          </span>
        )}
        // The stage the lifecycle panel's track shows as current.
        status={<ContestStatusBadge data-testid="manage-contest-stage" status={contest.status} />}
        title={contest.name}
        testId="manage-contest-identity"
      />

      <ContestStatusCard
        configuration={configuration}
        contest={contest}
        event={event}
        leagueCode={leagueCode}
        teamCount={activeTeamCount}
        tierCount={tierCount}
      />

      <SectionCard
        trailing={isNotOpen ? (
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
        help={isNotOpen
          ? 'What members will see when they enter.'
          : 'Settings locked when you opened it to the league.'}
        testId="manage-contest-settings"
        title="Contest"
      >
        <SectionRows>
          <SectionRow layout="setting" name="Name" testId="manage-contest-name" value={<span className="font-semibold">{contest.name}</span>} />
          <SectionRow
            layout="setting"
            // In Set up a one-event contest can move to another event of its Season (#2014).
            aside={isNotOpen ? (isMultiEvent ? <FixedNote /> : (
              <Button
                data-testid="manage-contest-change-event"
                disabled={!league.isActive}
                onClick={() => setIsChangeEventOpen(true)}
                size="sm"
                variant="secondary"
              >
                Change
              </Button>
            )) : undefined}
            name={isMultiEvent ? 'Events' : 'Event'}
            testId="manage-contest-event-row"
            value={(
              <>
                {isMultiEvent ? `${contest.sportEvents.length} events, listed below` : eventLabel}
                <Text as="div" variant="caption">
                  {isMultiEvent ? 'The first event starts ' : 'Starts '}
                  <DateDisplay tone="inherit" value={event.startDate} />.
                  {contest.selectionType === SelectionType.RANDOM_DRAW
                    ? ' Entries close when you run the draw, which must be before then.'
                    : ' Entries close then.'}
                </Text>
              </>
            )}
          />
          <SectionRow
            layout="setting"
            aside={isNotOpen ? <FixedNote /> : undefined}
            name="Format"
            testId="manage-contest-format"
            value={formatSelectionTypeName(contest.selectionType)}
          />
          <SectionRow layout="setting" name="Rules" testId="manage-contest-rules" value={rules} />
          <SectionRow
            layout="setting"
            name="Entries per member"
            testId="manage-contest-entries-per-team"
            value={formatEntriesPerTeam(configuration.maxEntriesPerSquad)}
          />
        </SectionRows>
      </SectionCard>

      {contest.coveredSlots.length > 1 ? (
        <SectionCard help="Set when the contest was created." testId="manage-contest-slot-list" title="Covers, in order">
          <SectionRows>
            {contest.coveredSlots.map((slot, index) => {
              const slotEvent = eventOfSlot(contest, slot);
              return (
                <SectionRow
                  facts={slotEvent ? <DateDisplay tone="inherit" value={slot.startsAt ?? slotEvent.startDate} /> : undefined}
                  key={slot.seasonSlotId}
                  name={slotLabel(slot)}
                  testId={`manage-contest-slot-${slot.seasonSlotId}`}
                  value={index + 1}
                />
              );
            })}
          </SectionRows>
        </SectionCard>
      ) : null}

      <ContestExpansionSection
        canGrant={viewer.isRootAdmin}
        contestId={contest.id}
        isLeagueActive={league.isActive}
        leagueId={league.id}
      />

      {hasPlanFeature(league, PlanFeature.CUP_SETTINGS) ? (
        <SectionCard
          help="How much this contest counts toward its sports league cup and the league championship."
          testId="manage-contest-championships"
          title="Championships"
        >
          <SectionRows>
            <SectionRow
              layout="setting"
              aside={contest.status === ContestStatus.COMPLETED ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="manage-contest-cup-weight-final">
                  <Lock aria-hidden size={13} />
                  Final
                  <HelpTip className="-my-2 -ml-2" label="Why this is final" testId="manage-contest-cup-weight-final-help">Fixed when the contest went final.</HelpTip>
                </span>
              ) : (
                <LinkButton
                  data-testid="manage-contest-cup-weight-edit"
                  isDisabled={!league.isActive}
                  size="sm"
                  to={buildLeagueAdminContestCupWeightPath(leagueCode, contest.id)}
                  variant="secondary"
                >
                  Edit
                </LinkButton>
              )}
              name="Cup weight"
              testId="manage-contest-cup-weight"
              value={enumLabel('CupWeight', managedContest.cupWeight)}
            />
          </SectionRows>
        </SectionCard>
      ) : null}

      {isTiered ? managedContest.sportEvents.map((managedEvent) => (
        <ContestTiersSection
          eventName={eventNamesById.get(managedEvent.sportEventId) ?? event.name}
          key={managedEvent.sportEventId}
          noun={sportVocabulary(event.sport).participant}
          tiers={managedEvent.effectiveTiers}
          title={isMultiEvent ? `Tiers · ${eventNamesById.get(managedEvent.sportEventId) ?? event.name}` : 'Tiers'}
        />
      )) : null}

      {isNotOpen ? (
        <SectionCard testId="manage-contest-danger-zone" tone="danger">
          <SectionRows>
            <SectionRow
              layout="action"
              aside={(
                <Button
                  data-testid="contest-delete"
                  disabled={!league.isActive}
                  onClick={() => setIsDeleteOpen(true)}
                  variant="danger"
                >
                  Delete contest
                </Button>
              )}
              facts="Removes this contest for good. Possible only until you open it to the league."
              name="Delete contest"
            />
          </SectionRows>
        </SectionCard>
      ) : null}

      {isNotOpen && !isMultiEvent ? (
        <ChangeContestEventDialog
          contestId={contestId}
          currentEvent={event}
          leagueCode={leagueCode}
          leagueId={leagueId}
          onOpenChange={setIsChangeEventOpen}
          open={isChangeEventOpen}
        />
      ) : null}

      <DeleteContestDialog
        contestId={contestId}
        contestName={contest.name}
        leagueCode={leagueCode}
        leagueId={leagueId}
        onDeleted={() => void navigate(contestsPath)}
        onOpenChange={setIsDeleteOpen}
        open={isDeleteOpen}
      />
    </section>
  );
}

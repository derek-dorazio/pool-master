import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { Route } from 'lucide-react';
import { useState } from 'react';
import type { SportLeagueDto } from '@/lib/api';
import {
  Button,
  ConfirmDialog,
  InlineError,
  LinkButton,
  PageHeader,
  SectionCard,
  SectionRow,
  SectionRows,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { buildSportLeaguePath } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';
import { useUpdateSportLeague } from './use-update-sport-league';
import { upperFirst } from '@/lib/upper-first';

/** The sport league's identity heading: name, active state, roster size and event count. */
export function SportLeagueHeading({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { participant, event } = useManagedSport().definition.vocabulary;
  return (
    <PageHeader
      icon={<Route aria-hidden size={22} />}
      meta={(
        <span data-testid="root-admin-sport-league-counts">
          {`${sportLeague.affiliationCount} ${sportLeague.affiliationCount === 1 ? participant.one : participant.many} · ${sportLeague.sportEventCount} ${sportLeague.sportEventCount === 1 ? event.one : event.many}`}
        </span>
      )}
      status={(
        <StatusBadge tone={sportLeague.isActive ? 'active' : 'inactive'}>
          {sportLeague.isActive ? 'Active' : 'Inactive'}
        </StatusBadge>
      )}
      title={sportLeague.name}
      testId="root-admin-sport-league-identity"
    />
  );
}

/** The sport league's properties as labelled rows, with one Edit (rules/ux-rules.md §12 rules 5 and 6). */
export function SportLeagueDetailsSection({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, definition } = useManagedSport();
  return (
    <SectionCard
      trailing={(
        <LinkButton
          data-testid="root-admin-sport-league-home-edit"
          size="sm"
          to={`${buildSportLeaguePath(sport, sportLeague.id)}/edit`}
          variant="secondary"
        >
          Edit
        </LinkButton>
      )}
      testId="root-admin-sport-league-details"
      title="Details"
    >
      <SectionRows>
        <SectionRow layout="setting" name="Match keyword" value={sportLeague.matchKeyword || 'Not set'} />
        <SectionRow layout="setting" name="Event sync" value={sportLeague.eventSyncProviderId ?? 'Off'} />
        <SectionRow layout="setting" name="Roster size" value={sportLeague.affiliationCount} />
        <SectionRow layout="setting" name={upperFirst(definition.vocabulary.event.many)} value={sportLeague.sportEventCount} />
        <SectionRow layout="setting" name="Current year" value={sportLeague.currentEventYear ?? 'Not set'} />
      </SectionRows>
    </SectionCard>
  );
}

/** Deactivating or reactivating the sport league, confirmed first, at the bottom of its page. */
export function SportLeagueDangerZone({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeague.noun);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actionLabel = sportLeague.isActive ? `Deactivate ${sportLeagueNoun.one}` : `Activate ${sportLeagueNoun.one}`;

  const toggleActiveMutation = useUpdateSportLeague({
    failedAction: 'sportLeague.toggleActive.failed',
    onSuccess: () => setConfirmOpen(false),
    refusedMessage: 'Sport league active toggle was rejected',
    sportLeagueId: sportLeague.id,
    toBody: () => ({ isActive: !sportLeague.isActive }),
  });

  const closeDialog = () => {
    toggleActiveMutation.reset();
    setConfirmOpen(false);
  };

  return (
    <>
      <SectionCard testId="root-admin-sport-league-danger-zone" tone="danger">
        <SectionRows>
          <SectionRow
            layout="action"
            aside={(
              <Button
                data-testid="root-admin-sport-league-home-toggle-active"
                onClick={() => setConfirmOpen(true)}
                size="sm"
                variant={sportLeague.isActive ? 'danger' : 'primary'}
              >
                {actionLabel}
              </Button>
            )}
            facts={sportLeague.isActive
              ? `Marks the ${sportLeagueNoun.one} inactive. Its roster and ${event.many} stay as they are.`
              : `Marks the ${sportLeagueNoun.one} active again.`}
            name={actionLabel}
          />
        </SectionRows>
      </SectionCard>

      <ConfirmDialog
        confirmLabel={actionLabel}
        confirmTestId="root-admin-sport-league-toggle-active-confirm"
        description={sportLeague.isActive
          ? `${sportLeague.name} will show as inactive. You can activate it again at any time.`
          : `${sportLeague.name} will show as active.`}
        isPending={toggleActiveMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => toggleActiveMutation.mutate()}
        onOpenChange={(open) => (open ? setConfirmOpen(true) : closeDialog())}
        open={confirmOpen}
        pendingLabel="Saving..."
        testId="root-admin-sport-league-toggle-active-dialog"
        title={`${actionLabel}?`}
        tone={sportLeague.isActive ? 'danger' : 'default'}
      >
        {toggleActiveMutation.isError ? (
          <InlineError>
            {extractErrorMessage(toggleActiveMutation.error, {
              fallback: `We could not change this ${sportLeagueNoun.one}’s active state.`,
            })}
          </InlineError>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

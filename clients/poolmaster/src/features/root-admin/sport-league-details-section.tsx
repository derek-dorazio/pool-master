import { sportLeagueNounOf } from '@poolmaster/shared/domain';
import { Route } from 'lucide-react';
import { useState } from 'react';
import { updateSportLeague } from '@/lib/api';
import type { SportLeagueDto } from '@/lib/api';
import {
  Button,
  ConfirmDialog,
  DangerZone,
  DangerZoneAction,
  IdentityHeading,
  InlineError,
  LinkButton,
  SettingsRow,
  SettingsSection,
  StatusBadge,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { buildSportLeaguePath, capitalize } from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

/** The sport league's identity heading: name, active state, roster size and event count. */
export function SportLeagueHeading({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { participant, event } = useManagedSport().definition.vocabulary;
  return (
    <IdentityHeading
      icon={<Route aria-hidden size={22} />}
      meta={(
        <>
          <StatusBadge tone={sportLeague.isActive ? 'active' : 'inactive'}>
            {sportLeague.isActive ? 'Active' : 'Inactive'}
          </StatusBadge>
          <span data-testid="root-admin-sport-league-counts">
            {`${sportLeague.affiliationCount} ${sportLeague.affiliationCount === 1 ? participant.one : participant.many} · ${sportLeague.sportEventCount} ${sportLeague.sportEventCount === 1 ? event.one : event.many}`}
          </span>
        </>
      )}
      name={sportLeague.name}
      testId="root-admin-sport-league-identity"
    />
  );
}

/** The sport league's properties as labelled rows, with one Edit (rules/ux-rules.md §12 rules 5 and 6). */
export function SportLeagueDetailsSection({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, definition } = useManagedSport();
  return (
    <SettingsSection
      action={(
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
      <SettingsRow label="Match keyword" value={sportLeague.matchKeyword || 'Not set'} />
      <SettingsRow label="Roster size" value={sportLeague.affiliationCount} />
      <SettingsRow label={capitalize(definition.vocabulary.event.many)} value={sportLeague.sportEventCount} />
      <SettingsRow label="Current year" value={sportLeague.currentEventYear ?? 'Not set'} />
    </SettingsSection>
  );
}

/** Deactivating or reactivating the sport league, confirmed first, at the bottom of its page. */
export function SportLeagueDangerZone({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-league-home-page',
  });
  const { sport, definition } = useManagedSport();
  const { event } = definition.vocabulary;
  const sportLeagueNoun = sportLeagueNounOf(sport, sportLeague.noun);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actionLabel = sportLeague.isActive ? `Deactivate ${sportLeagueNoun.one}` : `Activate ${sportLeagueNoun.one}`;

  const toggleActiveMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await updateSportLeague({
        path: { sportLeagueId: sportLeague.id },
        body: { isActive: !sportLeague.isActive },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Sport league update response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagues],
    onSuccess: () => setConfirmOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.toggleActive.failed', err: error },
        'Sport league active toggle was rejected',
      );
    },
  });

  const closeDialog = () => {
    toggleActiveMutation.reset();
    setConfirmOpen(false);
  };

  return (
    <>
      <DangerZone testId="root-admin-sport-league-danger-zone">
        <DangerZoneAction
          action={(
            <Button
              data-testid="root-admin-sport-league-home-toggle-active"
              onClick={() => setConfirmOpen(true)}
              size="sm"
              variant={sportLeague.isActive ? 'danger' : 'primary'}
            >
              {actionLabel}
            </Button>
          )}
          description={sportLeague.isActive
            ? `Marks the ${sportLeagueNoun.one} inactive. Its roster and ${event.many} stay as they are.`
            : `Marks the ${sportLeagueNoun.one} active again.`}
          title={actionLabel}
        />
      </DangerZone>

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

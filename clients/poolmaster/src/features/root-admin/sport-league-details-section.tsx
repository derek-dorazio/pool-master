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
export function SportLeagueHeading({ tour }: { tour: SportLeagueDto }) {
  const { participant, event } = useManagedSport().definition.vocabulary;
  return (
    <IdentityHeading
      icon={<Route aria-hidden size={22} />}
      meta={(
        <>
          <StatusBadge tone={tour.isActive ? 'active' : 'inactive'}>
            {tour.isActive ? 'Active' : 'Inactive'}
          </StatusBadge>
          <span data-testid="root-admin-sport-league-counts">
            {`${tour.affiliationCount} ${tour.affiliationCount === 1 ? participant.one : participant.many} · ${tour.sportEventCount} ${tour.sportEventCount === 1 ? event.one : event.many}`}
          </span>
        </>
      )}
      name={tour.name}
      testId="root-admin-sport-league-identity"
    />
  );
}

/** The sport league's properties as labelled rows, with one Edit (rules/ux-rules.md §12 rules 5 and 6). */
export function SportLeagueDetailsSection({ tour }: { tour: SportLeagueDto }) {
  const { sport, definition } = useManagedSport();
  return (
    <SettingsSection
      action={(
        <LinkButton
          data-testid="root-admin-sport-league-home-edit"
          size="sm"
          to={`${buildSportLeaguePath(sport, tour.id)}/edit`}
          variant="secondary"
        >
          Edit
        </LinkButton>
      )}
      testId="root-admin-sport-league-details"
      title="Details"
    >
      <SettingsRow label="Match keyword" value={tour.matchKeyword || 'Not set'} />
      <SettingsRow label="Roster size" value={tour.affiliationCount} />
      <SettingsRow label={capitalize(definition.vocabulary.event.many)} value={tour.sportEventCount} />
      <SettingsRow label="Current year" value={tour.currentEventYear ?? 'Not set'} />
    </SettingsSection>
  );
}

/** Deactivating or reactivating the sport league, confirmed first, at the bottom of its page. */
export function SportLeagueDangerZone({ tour }: { tour: SportLeagueDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-league-home-page',
  });
  const { sportLeague, event } = useManagedSport().definition.vocabulary;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actionLabel = tour.isActive ? `Deactivate ${sportLeague.one}` : `Activate ${sportLeague.one}`;

  const toggleActiveMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await updateSportLeague({
        path: { sportLeagueId: tour.id },
        body: { isActive: !tour.isActive },
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
        { action: 'golf.tour.toggleActive.failed', err: error },
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
              variant={tour.isActive ? 'danger' : 'primary'}
            >
              {actionLabel}
            </Button>
          )}
          description={tour.isActive
            ? `Marks the ${sportLeague.one} inactive. Its roster and ${event.many} stay as they are.`
            : `Marks the ${sportLeague.one} active again.`}
          title={actionLabel}
        />
      </DangerZone>

      <ConfirmDialog
        confirmLabel={actionLabel}
        confirmTestId="root-admin-sport-league-toggle-active-confirm"
        description={tour.isActive
          ? `${tour.name} will show as inactive. You can activate it again at any time.`
          : `${tour.name} will show as active.`}
        isPending={toggleActiveMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => toggleActiveMutation.mutate()}
        onOpenChange={(open) => (open ? setConfirmOpen(true) : closeDialog())}
        open={confirmOpen}
        pendingLabel="Saving..."
        testId="root-admin-sport-league-toggle-active-dialog"
        title={`${actionLabel}?`}
        tone={tour.isActive ? 'danger' : 'default'}
      >
        {toggleActiveMutation.isError ? (
          <p className="text-sm font-medium text-destructive">
            {extractErrorMessage(toggleActiveMutation.error, {
              fallback: `We could not change this ${sportLeague.one}’s active state.`,
            })}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

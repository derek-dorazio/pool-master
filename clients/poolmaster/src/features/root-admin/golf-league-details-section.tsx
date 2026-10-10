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
import { buildGolfTourPath } from './manage-navigation';

/** The tour's identity heading: name, active state, roster size and tournament count. */
export function GolfTourHeading({ tour }: { tour: SportLeagueDto }) {
  return (
    <IdentityHeading
      icon={<Route aria-hidden size={22} />}
      meta={(
        <>
          <StatusBadge tone={tour.isActive ? 'active' : 'inactive'}>
            {tour.isActive ? 'Active' : 'Inactive'}
          </StatusBadge>
          <span data-testid="root-admin-golf-league-counts">
            {tour.affiliationCount} golfers · {tour.sportEventCount} tournaments
          </span>
        </>
      )}
      name={tour.name}
      testId="root-admin-golf-league-identity"
    />
  );
}

/** The tour's properties as labelled rows, with one Edit (rules/ux-rules.md §12 rules 5 and 6). */
export function GolfTourDetailsSection({ tour }: { tour: SportLeagueDto }) {
  return (
    <SettingsSection
      action={(
        <LinkButton
          data-testid="root-admin-golf-league-home-edit"
          size="sm"
          to={`${buildGolfTourPath(tour.id)}/edit`}
          variant="secondary"
        >
          Edit
        </LinkButton>
      )}
      testId="root-admin-golf-league-details"
      title="Details"
    >
      <SettingsRow label="Match keyword" value={tour.matchKeyword || 'Not set'} />
      <SettingsRow label="Roster size" value={tour.affiliationCount} />
      <SettingsRow label="Tournaments" value={tour.sportEventCount} />
      <SettingsRow label="Current year" value={tour.currentEventYear ?? 'Not set'} />
    </SettingsSection>
  );
}

/** Deactivating or reactivating the tour, confirmed first, at the bottom of its page. */
export function GolfTourDangerZone({ tour }: { tour: SportLeagueDto }) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-league-home-page',
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actionLabel = tour.isActive ? 'Deactivate tour' : 'Activate tour';

  const toggleActiveMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await updateSportLeague({
        path: { sportLeagueId: tour.id },
        body: { isActive: !tour.isActive },
      });
      if (!response.data?.sportLeague) {
        throwApiError(response.error, 'Golf tour update response is missing data.');
      }
      return response.data.sportLeague;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tours],
    onSuccess: () => setConfirmOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.toggleActive.failed', err: error },
        'Golf tour active toggle was rejected',
      );
    },
  });

  const closeDialog = () => {
    toggleActiveMutation.reset();
    setConfirmOpen(false);
  };

  return (
    <>
      <DangerZone testId="root-admin-golf-league-danger-zone">
        <DangerZoneAction
          action={(
            <Button
              data-testid="root-admin-golf-league-home-toggle-active"
              onClick={() => setConfirmOpen(true)}
              size="sm"
              variant={tour.isActive ? 'danger' : 'primary'}
            >
              {actionLabel}
            </Button>
          )}
          description={tour.isActive
            ? 'Marks the tour inactive. Its roster and tournaments stay as they are.'
            : 'Marks the tour active again.'}
          title={actionLabel}
        />
      </DangerZone>

      <ConfirmDialog
        confirmLabel={actionLabel}
        confirmTestId="root-admin-golf-league-toggle-active-confirm"
        description={tour.isActive
          ? `${tour.name} will show as inactive. You can activate it again at any time.`
          : `${tour.name} will show as active.`}
        isPending={toggleActiveMutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => toggleActiveMutation.mutate()}
        onOpenChange={(open) => (open ? setConfirmOpen(true) : closeDialog())}
        open={confirmOpen}
        pendingLabel="Saving..."
        testId="root-admin-golf-league-toggle-active-dialog"
        title={`${actionLabel}?`}
        tone={tour.isActive ? 'danger' : 'default'}
      >
        {toggleActiveMutation.isError ? (
          <p className="text-sm font-medium text-destructive">
            {extractErrorMessage(toggleActiveMutation.error, {
              fallback: 'We could not change this tour’s active state.',
            })}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}

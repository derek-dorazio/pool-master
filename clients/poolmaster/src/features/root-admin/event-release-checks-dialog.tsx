import { enumLabel } from '@poolmaster/shared/display-strings';
import { blocksManualRelease } from '@poolmaster/shared/domain';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { releaseEvent, type SportEventDto, type SportEventOverviewDto } from '@/lib/api';
import {
  ConfirmDialog,
  formatDateTimeDisplay,
  ReadOnlyDetailModal,
  SectionRow,
  SectionRows,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { releaseCheckValueText, releaseTriesText } from './event-release-checks-text';

const logger = getLogger().child({ feature: 'root-admin-event-release' });

/**
 * The header's Release chip opens this (#1890): how the draft event is released, when automatic
 * release tries and what its last try found, then each ready check with ✓ or ✗ and its value.
 * Release now asks first, and is off while a check a root admin's release needs still fails.
 */
export function EventReleaseChecksDialog({
  event,
  onClose,
  overview,
}: {
  event: SportEventDto;
  onClose: () => void;
  overview: SportEventOverviewDto | undefined;
}) {
  const preferences = useDisplayPreferences();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const checks = event.releaseChecks ?? [];
  const blocked = event.releaseChecks === null || checks.some((check) => !check.passed && blocksManualRelease(check.key));
  const lastTry = event.lastAutoReleaseCheck;

  const releaseMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await releaseEvent({ path: { eventId: event.id } });
      if (!response.data?.event) throwApiError(response.error, 'Release event response is missing data.');
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.event(event.id),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.sportEvents.all,
    ],
    onSuccess: () => {
      logger.info({ action: 'event.release.succeeded', data: { eventId: event.id } }, 'Released event for contests');
      setConfirmOpen(false);
      onClose();
    },
    onError: (error) => {
      logger.warn({ action: 'event.release.failed', data: { eventId: event.id }, err: error }, 'Event release was rejected');
    },
  });

  return (
    <>
      <ReadOnlyDetailModal
        action={{
          isDisabled: blocked,
          label: 'Release now',
          onClick: () => setConfirmOpen(true),
          testId: 'root-admin-sport-event-release',
        }}
        detailContent={(
          <SectionRows>
            {checks.map((check) => (
              <SectionRow
                aside={check.passed
                  ? <Check aria-label="Passed" size={16} />
                  : <X aria-label="Failed" size={16} />}
                facts={releaseCheckValueText(check, preferences)}
                key={check.key}
                name={enumLabel('ReleaseCheckKey', check.key)}
                note={blocksManualRelease(check.key) ? undefined : 'Automatic release only'}
                testId={`root-admin-event-release-check-${check.key}`}
              />
            ))}
          </SectionRows>
        )}
        details={[
          { id: 'mode', label: 'Release mode', value: overview === undefined ? '…' : enumLabel('SportEventReleaseMode', overview.releaseMode) },
          { id: 'tries', label: 'Tries', value: releaseTriesText(overview, preferences) },
          {
            id: 'lastTry',
            label: 'Last try',
            value: lastTry === null ? 'Never' : `${formatDateTimeDisplay(lastTry.checkedAt, preferences)} · ${lastTry.outcome === 'HELD' ? 'held' : 'released'}`,
          },
        ]}
        onCancel={onClose}
        onOpenChange={(open) => (open ? undefined : onClose())}
        open={!confirmOpen}
        testId="root-admin-event-release-checks"
        title="Release checks"
      />
      <ConfirmDialog
        confirmLabel="Release for contests"
        confirmTestId="root-admin-sport-event-release-confirm"
        description={'Commissioners will be able to create contests on this event. Its tiers and prices lock for good; the field, ranks, odds and withdrawals stay editable. It can\'t be returned to a draft.'}
        error={releaseMutation.isError
          ? extractErrorMessage(releaseMutation.error, { fallback: 'The release was rejected.' })
          : undefined}
        isPending={releaseMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => releaseMutation.mutate()}
        onOpenChange={(open) => !open && setConfirmOpen(false)}
        open={confirmOpen}
        pendingLabel="Releasing..."
        testId="root-admin-sport-event-release-modal"
        title={'Release this event for contests?'}
      />
    </>
  );
}

import { useState, type ReactNode } from 'react';
import { enumLabel, slotLabel } from '@poolmaster/shared/display-strings';
import { assertNever, ProviderSyncFindingAction } from '@poolmaster/shared/domain';
import {
  Button,
  ConfirmDialog,
  DateDisplay,
  DetailEditModal,
  FormField,
  LinkButton,
  Notice,
  QueryState,
  Select,
  StatusBadge,
  Textarea,
  showToast,
  type DetailAction,
} from '@/features/shared/ui';
import type { ProviderSyncFindingDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { buildSyncFindingMapParticipantPath } from './manage-navigation';
import { SYNC_FINDING_SEVERITY_TONES, SYNC_FINDING_STATUS_TONES, syncFindingTitle } from './sync-finding-labels';
import { useChangeSyncFindingStatus, useLinkSyncFindingSlot, useSyncFindingSlotChoicesQuery } from './use-sync-findings';

const NONE = '—';

/**
 * One sync finding's dialog on Findings (#1999), opened by ⤢ on its row: its Details, then the
 * actions the API says it offers (rules/ux-rules.md §12 item 14). View only; each action is its
 * own button. Waive asks for its note, and Link to existing for its slot (#2011), in a confirm
 * dialog.
 */
export function SyncFindingDialog({ finding, onClose }: { finding: ProviderSyncFindingDto; onClose: () => void }) {
  const testId = 'root-admin-sync-finding-dialog';
  const [isWaiving, setIsWaiving] = useState(false);
  const [waiveNote, setWaiveNote] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [slotDefinitionId, setSlotDefinitionId] = useState('');
  const slotChoices = useSyncFindingSlotChoicesQuery(finding.id, isLinking);
  const linkMutation = useLinkSyncFindingSlot(finding.id, {
    onSuccess: (saved) => {
      setIsLinking(false);
      setSlotDefinitionId('');
      showToast({ title: `${enumLabel('ProviderSyncFindingAction', ProviderSyncFindingAction.LINK_SLOT)}: ${syncFindingTitle(saved)}`, tone: 'success' });
    },
  });
  const linkErrorText = linkMutation.isError
    ? extractErrorMessage(linkMutation.error, { fallback: 'We could not link this tournament to that slot.' })
    : null;
  const statusMutation = useChangeSyncFindingStatus(finding.id, {
    onSuccess: (saved) => {
      setIsWaiving(false);
      setWaiveNote('');
      showToast({ title: `${enumLabel('ProviderSyncFindingStatus', saved.status)}: ${syncFindingTitle(saved)}`, tone: 'success' });
    },
  });
  const errorText = statusMutation.isError
    ? extractErrorMessage(statusMutation.error, { fallback: 'We could not change this finding.' })
    : null;

  /** Each action's button, and the page's sentence on what it does. */
  const actionParts = (action: ProviderSyncFindingAction): { description: string; control: ReactNode } => {
    const label = enumLabel('ProviderSyncFindingAction', action);
    const buttonTestId = `${testId}-${action}`;
    switch (action) {
      case ProviderSyncFindingAction.MAP_PARTICIPANT:
        return {
          description: 'Choose the participant of this sport league the feed means. Their synced results land from the next sync, and the finding is resolved.',
          control: (
            <LinkButton data-testid={buttonTestId} size="sm" to={buildSyncFindingMapParticipantPath(finding.id)} variant="secondary">
              {`${label} ›`}
            </LinkButton>
          ),
        };
      case ProviderSyncFindingAction.LINK_SLOT:
        return {
          description: 'Choose the slot this tournament plays. Its name is added to that slot, the next sync links the tournament there, and the finding is resolved.',
          control: (
            <Button data-testid={buttonTestId} onClick={() => setIsLinking(true)} size="sm" type="button" variant="secondary">
              {label}
            </Button>
          ),
        };
      case ProviderSyncFindingAction.WAIVE:
        return {
          description: 'Accepts it as it is, with a note saying why. It stays waived when the sync sees it again.',
          control: (
            <Button data-testid={buttonTestId} onClick={() => setIsWaiving(true)} size="sm" type="button" variant="secondary">
              {label}
            </Button>
          ),
        };
      case ProviderSyncFindingAction.RESOLVE:
      case ProviderSyncFindingAction.REOPEN:
        return {
          description: action === ProviderSyncFindingAction.RESOLVE
            ? 'Marks it fixed. The sync opens it again if it sees it again.'
            : 'Opens it again, so it counts on the Sports page.',
          control: (
            <Button
              data-testid={buttonTestId}
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ action })}
              size="sm"
              type="button"
              variant="secondary"
            >
              {label}
            </Button>
          ),
        };
      default:
        return assertNever(action);
    }
  };

  const actions: DetailAction[] = finding.actions.map((action) => ({
    id: action,
    name: enumLabel('ProviderSyncFindingAction', action),
    ...actionParts(action),
    testId: `${testId}-action-${action}`,
  }));

  return (
    <>
      <DetailEditModal
        actions={actions}
        facts={[
          { id: 'severity', label: 'Severity', value: <StatusBadge tone={SYNC_FINDING_SEVERITY_TONES[finding.severity]}>{enumLabel('ProviderSyncFindingSeverity', finding.severity)}</StatusBadge>, testId: `${testId}-severity` },
          { id: 'status', label: 'Status', value: <StatusBadge tone={SYNC_FINDING_STATUS_TONES[finding.status]}>{enumLabel('ProviderSyncFindingStatus', finding.status)}</StatusBadge>, testId: `${testId}-status` },
          { id: 'league', label: 'Sport league', value: finding.sportLeague.name, testId: `${testId}-league` },
          { id: 'event', label: 'Event', value: finding.sportEvent?.name ?? NONE, testId: `${testId}-event` },
          { id: 'provider', label: 'Provider', value: finding.provider?.name ?? NONE, testId: `${testId}-provider` },
          { id: 'value', label: 'Feed value', value: finding.providerValue ?? NONE, detail: finding.providerValueName ?? undefined, testId: `${testId}-value` },
          ...(finding.syncKind === null ? [] : [{ id: 'sync', label: 'Sync', value: enumLabel('ProviderSyncKind', finding.syncKind), testId: `${testId}-sync` }]),
          { id: 'first-seen', label: 'First seen', value: <DateDisplay value={finding.firstSeenAt} />, testId: `${testId}-first-seen` },
          { id: 'last-seen', label: 'Last seen', value: <DateDisplay value={finding.lastSeenAt} />, detail: `${String(finding.seenCount)} times`, testId: `${testId}-last-seen` },
          {
            id: 'changed',
            label: 'Status set',
            value: <DateDisplay value={finding.statusChangedAt} />,
            detail: finding.statusChangedBy === null ? 'By the sync' : `By ${finding.statusChangedBy.displayName}`,
            testId: `${testId}-changed`,
          },
          ...(finding.waiveNote === null ? [] : [{ id: 'note', label: 'Why waived', value: finding.waiveNote, testId: `${testId}-note` }]),
        ]}
        mode="view"
        onCancel={onClose}
        onOpenChange={(open) => (open ? undefined : onClose())}
        open
        testId={testId}
        title={syncFindingTitle(finding)}
        viewContent={errorText !== null && !isWaiving
          ? <Notice data-testid={`${testId}-error`} tone="danger">{errorText}</Notice>
          : undefined}
      />
      <ConfirmDialog
        confirmLabel={enumLabel('ProviderSyncFindingAction', ProviderSyncFindingAction.WAIVE)}
        error={isWaiving ? errorText : null}
        isConfirmDisabled={waiveNote.trim() === ''}
        isPending={statusMutation.isPending}
        onCancel={() => setIsWaiving(false)}
        onConfirm={() => statusMutation.mutate({ action: ProviderSyncFindingAction.WAIVE, waiveNote })}
        onOpenChange={setIsWaiving}
        open={isWaiving}
        pendingLabel="Waiving..."
        testId={`${testId}-waive`}
        title={`Waive ${syncFindingTitle(finding)}?`}
      >
        <FormField label="Why it is waived">
          <Textarea data-testid={`${testId}-waive-note`} onChange={(event) => setWaiveNote(event.target.value)} rows={3} value={waiveNote} />
        </FormField>
      </ConfirmDialog>
      <ConfirmDialog
        confirmLabel={enumLabel('ProviderSyncFindingAction', ProviderSyncFindingAction.LINK_SLOT)}
        error={isLinking ? linkErrorText : null}
        isConfirmDisabled={slotDefinitionId === ''}
        isPending={linkMutation.isPending}
        onCancel={() => setIsLinking(false)}
        onConfirm={() => linkMutation.mutate(slotDefinitionId)}
        onOpenChange={setIsLinking}
        open={isLinking}
        pendingLabel="Linking..."
        testId={`${testId}-link`}
        title={`Link ${finding.providerValueName ?? finding.providerValue ?? NONE} to a slot`}
      >
        <QueryState
          error={extractErrorMessage(slotChoices.error, { fallback: 'We could not load the slots.' })}
          loading="Loading slots..."
          query={slotChoices}
          testId={`${testId}-link-slots`}
        >
          {(slots) => (
            <FormField label="Slot">
              <Select data-testid={`${testId}-link-slot`} onChange={(event) => setSlotDefinitionId(event.target.value)} value={slotDefinitionId}>
                <option value="">Choose a slot</option>
                {slots.map((slot) => <option key={slot.slotDefinitionId} value={slot.slotDefinitionId}>{slotLabel(slot)}</option>)}
              </Select>
            </FormField>
          )}
        </QueryState>
      </ConfirmDialog>
    </>
  );
}

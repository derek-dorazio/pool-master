import { useMemo, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { adminReplaceGolfTournamentTiers } from '@/lib/api';
import { reorderById } from './golf-tier-board-utils';
import {
  Alert,
  Button,
  ConfirmationModal,
  FormField,
  Input,
  Select,
  SortableList,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminGetGolfTournamentTiersResponses,
  AdminReplaceGolfTournamentTiersData,
} from '@/lib/api';

type TierDto = AdminGetGolfTournamentTiersResponses[200]['tiers'][number];
type TierDraft = {
  id: string;
  tierKey: string;
  label: string;
  defaultPickCount: number;
};
type TierBody = AdminReplaceGolfTournamentTiersData['body']['tiers'][number];

function toDraft(tiers: readonly TierDto[]): TierDraft[] {
  return [...tiers]
    .sort((a, b) => a.tierNumber - b.tierNumber)
    .map((tier) => ({
      id: tier.tierKey,
      tierKey: tier.tierKey,
      label: tier.label,
      defaultPickCount: tier.defaultPickCount,
    }));
}

function toBody(draft: readonly TierDraft[]): TierBody[] {
  return draft.map((tier, index) => ({
    tierKey: tier.tierKey,
    label: tier.label.trim() || `Tier ${index + 1}`,
    tierNumber: index + 1,
    defaultPickCount: Number.isFinite(tier.defaultPickCount)
      ? Math.max(0, Math.trunc(tier.defaultPickCount))
      : 0,
  }));
}

/**
 * plans/124 §6.3 — the left panel: add / rename / reorder / set pick count for a
 * tournament's tier definitions, plus a per-tier delete `ConfirmationModal` that
 * surfaces the orphan count and (when non-zero) requires a reassignment target.
 */
export function GolfTierDefinitionsPanel({
  assignmentCountByTierKey,
  eventId,
  readOnly,
  tiers,
}: {
  assignmentCountByTierKey: Record<string, number>;
  eventId: string;
  readOnly: boolean;
  tiers: TierDto[];
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-tiers-page',
  });

  const serverDraft = useMemo(() => toDraft(tiers), [tiers]);
  const [draft, setDraft] = useState<TierDraft[]>(serverDraft);
  const [draftKey, setDraftKey] = useState(() => JSON.stringify(serverDraft));
  const [deleteTarget, setDeleteTarget] = useState<TierDraft | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  const nextKey = JSON.stringify(serverDraft);
  if (nextKey !== draftKey) {
    setDraftKey(nextKey);
    setDraft(serverDraft);
  }

  const editable = !readOnly;
  const dirty = JSON.stringify(draft) !== JSON.stringify(serverDraft);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (body: AdminReplaceGolfTournamentTiersData['body']) => {
      const response = await adminReplaceGolfTournamentTiers({
        path: { eventId },
        body,
      });
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tiers(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
    ],
    onError: (error) => {
      logger.warn(
        { action: 'golf.tiers.definitions.save.failed', err: error },
        'Golf tier definition save was rejected',
      );
    },
  });

  function addTier() {
    setDraft((current) => {
      const used = new Set(current.map((tier) => tier.tierKey));
      // tierKey is stable identity and is never renumbered on delete, so a
      // sparse key set (e.g. [tier-2, tier-3] after deleting tier-1) must not
      // regenerate an existing key — walk forward until one is free.
      let n = current.length + 1;
      while (used.has(`tier-${n}`)) {
        n += 1;
      }
      return [
        ...current,
        {
          id: `tier-${n}`,
          tierKey: `tier-${n}`,
          label: `Tier ${current.length + 1}`,
          defaultPickCount: 1,
        },
      ];
    });
  }

  function confirmDelete() {
    const remaining = draft.filter((tier) => tier.id !== deleteTarget?.id);
    const orphans = deleteTarget
      ? assignmentCountByTierKey[deleteTarget.tierKey] ?? 0
      : 0;
    saveMutation.mutate(
      orphans > 0
        ? { tiers: toBody(remaining), reassignOrphansTo: reassignTo }
        : { tiers: toBody(remaining) },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          setReassignTo('');
        },
      },
    );
  }

  const orphanCount = deleteTarget
    ? assignmentCountByTierKey[deleteTarget.tierKey] ?? 0
    : 0;

  return (
    <Tile>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">Tiers</h3>
        {editable ? (
          <Button
            data-testid="root-admin-golf-tier-def-add"
            disabled={draft.length >= 12}
            onClick={addTier}
            size="sm"
            variant="secondary"
          >
            Add tier
          </Button>
        ) : null}
      </div>

      {saveMutation.isError && !deleteTarget ? (
        <Alert className="mt-3" data-testid="root-admin-golf-tier-def-error" tone="danger">
          {extractErrorMessage(saveMutation.error, {
            codeMessages: {
              TIERS_LOCKED_BY_ENTRIES:
                'This tournament has contest entries — tier definitions are locked to keep existing picks consistent.',
            },
            fallback: 'We could not save the tier definitions.',
          })}
        </Alert>
      ) : null}

      {editable ? (
        <SortableList
          aria-label="Tier definitions"
          className="mt-4"
          items={draft}
          onReorder={(orderedIds) =>
            setDraft((current) => reorderById(current, orderedIds))
          }
          renderItem={(tier, { dragHandleProps }) => (
            <div
              className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3"
              data-testid={`root-admin-golf-tier-def-row-${tier.tierKey}`}
            >
              <Button
                aria-label={`Reorder ${tier.label}`}
                className="shrink-0 cursor-grab px-2"
                size="sm"
                variant="ghost"
                {...dragHandleProps}
              >
                <GripVertical aria-hidden className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Name for ${tier.tierKey}`}
                  className="h-8"
                  data-testid={`root-admin-golf-tier-def-label-${tier.tierKey}`}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((row) =>
                        row.id === tier.id ? { ...row, label: event.target.value } : row,
                      ),
                    )
                  }
                  value={tier.label}
                />
              </div>
              <div className="w-20 shrink-0">
                <Input
                  aria-label={`Pick count for ${tier.label}`}
                  className="h-8"
                  data-testid={`root-admin-golf-tier-def-picks-${tier.tierKey}`}
                  inputMode="numeric"
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((row) =>
                        row.id === tier.id
                          ? { ...row, defaultPickCount: Number(event.target.value) }
                          : row,
                      ),
                    )
                  }
                  value={String(tier.defaultPickCount)}
                />
              </div>
              <Button
                aria-label={`Delete ${tier.label}`}
                data-testid={`root-admin-golf-tier-def-delete-${tier.tierKey}`}
                disabled={draft.length <= 2}
                onClick={() => {
                  setDeleteTarget(tier);
                  setReassignTo(
                    draft.find((row) => row.id !== tier.id)?.tierKey ?? '',
                  );
                }}
                size="sm"
                variant="danger"
              >
                Delete
              </Button>
            </div>
          )}
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {serverDraft.map((tier) => (
            <li
              className="rounded-2xl border border-border bg-card p-3 text-sm"
              key={tier.id}
            >
              <span className="font-medium text-foreground">{tier.label}</span>
              <span className="ml-2 text-muted-foreground">
                {tier.defaultPickCount} pick{tier.defaultPickCount === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && dirty ? (
        <div className="mt-4 flex justify-end gap-2">
          <Button
            data-testid="root-admin-golf-tier-def-discard"
            onClick={() => setDraft(serverDraft)}
            size="sm"
            variant="secondary"
          >
            Discard
          </Button>
          <Button
            data-testid="root-admin-golf-tier-def-save"
            isLoading={saveMutation.isPending && !deleteTarget}
            onClick={() => saveMutation.mutate({ tiers: toBody(draft) })}
            size="sm"
          >
            Save tiers
          </Button>
        </div>
      ) : null}

      <ConfirmationModal
        confirmLabel="Delete tier"
        confirmTestId="root-admin-golf-tier-def-delete-confirm"
        description={
          deleteTarget
            ? orphanCount > 0
              ? `${deleteTarget.label} has ${orphanCount} golfer${orphanCount === 1 ? '' : 's'} assigned. They will move to the tier you choose below.`
              : `Delete ${deleteTarget.label}? It has no golfers assigned.`
            : ''
        }
        errorMessage={
          saveMutation.isError && deleteTarget
            ? extractErrorMessage(saveMutation.error, {
                fallback: 'We could not delete this tier.',
              })
            : undefined
        }
        isConfirmDisabled={orphanCount > 0 && reassignTo === ''}
        isPending={saveMutation.isPending}
        onCancel={() => {
          setDeleteTarget(null);
          setReassignTo('');
        }}
        onConfirm={confirmDelete}
        onOpenChange={(next) => {
          if (!next) {
            setDeleteTarget(null);
            setReassignTo('');
          }
        }}
        open={deleteTarget !== null}
        testId="root-admin-golf-tier-def-delete-modal"
        title="Delete tier"
        tone="danger"
      >
        {orphanCount > 0 ? (
          <FormField label="Move golfers to">
            <Select
              data-testid="root-admin-golf-tier-def-reassign"
              onChange={(event) => setReassignTo(event.target.value)}
              value={reassignTo}
            >
              {draft
                .filter((tier) => tier.id !== deleteTarget?.id)
                .map((tier) => (
                  <option key={tier.tierKey} value={tier.tierKey}>
                    {tier.label}
                  </option>
                ))}
            </Select>
          </FormField>
        ) : null}
      </ConfirmationModal>
    </Tile>
  );
}

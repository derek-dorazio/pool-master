import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { adminUpdateGolfFieldEntries } from '@/lib/api';
import {
  Alert,
  Button,
  Checkbox,
  DataGrid,
  Input,
  LinkButton,
  Select,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  GOLF_FIELD_INACTIVE_REASONS,
  buildGolfFieldPatches,
  golfFieldCellInvalid,
  golfFieldCellValue,
  golfFieldInvalidCount,
  type GolfFieldEntry,
  type GolfFieldInactiveReason,
  type GolfFieldNumericKey,
  type GolfFieldPatch,
  type GolfFieldRowDraft,
} from './golf-field-patch';

export type { GolfFieldEntry } from './golf-field-patch';

type FieldGridMeta = {
  draft: Record<string, GolfFieldRowDraft>;
  setDraft: Dispatch<SetStateAction<Record<string, GolfFieldRowDraft>>>;
};

const NUMERIC_COLUMN_LABEL: Record<GolfFieldNumericKey, string> = {
  worldRanking: 'World rank',
  oddsToWin: 'Odds',
  seedNumber: 'Seed',
  price: 'Price',
};

const columnHelper = createColumnHelper<GolfFieldEntry>();

function patchRowDraft(
  setDraft: FieldGridMeta['setDraft'],
  id: string,
  partial: Partial<GolfFieldRowDraft>,
) {
  setDraft((current) => ({
    ...current,
    [id]: { ...current[id], ...partial },
  }));
}

function numericCell(key: GolfFieldNumericKey) {
  return columnHelper.display({
    id: key,
    header: NUMERIC_COLUMN_LABEL[key],
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as FieldGridMeta;
      const entry = row.original;
      const raw = golfFieldCellValue(entry, draft[entry.sportEventParticipantId], key);
      const invalid = golfFieldCellInvalid(raw, key);
      return (
        <div className="max-w-[7rem]">
          <Input
            aria-invalid={invalid || undefined}
            aria-label={`${NUMERIC_COLUMN_LABEL[key]} for ${entry.participantName}`}
            data-testid={`root-admin-golf-field-${key}-${entry.sportEventParticipantId}`}
            inputMode={key === 'oddsToWin' ? 'decimal' : 'numeric'}
            onChange={(event) =>
              patchRowDraft(setDraft, entry.sportEventParticipantId, {
                [key]: event.target.value,
              })
            }
            value={raw}
          />
        </div>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  });
}

const fieldColumns = [
  columnHelper.accessor('participantName', {
    header: 'Player',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">
          {row.original.participantName}
        </span>
        {row.original.isLeagueRosterMember ? null : (
          <StatusBadge tone="warning">Guest</StatusBadge>
        )}
      </div>
    ),
  }),
  columnHelper.display({
    id: 'active',
    header: 'In field',
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as FieldGridMeta;
      const entry = row.original;
      const rowDraft = draft[entry.sportEventParticipantId];
      const active = rowDraft?.isActive ?? entry.isActive;
      const reason: GolfFieldInactiveReason =
        rowDraft?.inactiveReason ?? entry.inactiveReason ?? 'WITHDRAWN';
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={active}
              data-testid={`root-admin-golf-field-active-${entry.sportEventParticipantId}`}
              onChange={(event) =>
                patchRowDraft(setDraft, entry.sportEventParticipantId, {
                  isActive: event.target.checked,
                })
              }
            />
            <span>{active ? 'In field' : 'Out'}</span>
          </label>
          {active ? null : (
            <Select
              aria-label={`Withdrawal reason for ${entry.participantName}`}
              data-testid={`root-admin-golf-field-reason-${entry.sportEventParticipantId}`}
              onChange={(event) =>
                patchRowDraft(setDraft, entry.sportEventParticipantId, {
                  inactiveReason: event.target.value as GolfFieldInactiveReason,
                })
              }
              value={reason}
            >
              {GOLF_FIELD_INACTIVE_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          )}
        </div>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  numericCell('worldRanking'),
  numericCell('oddsToWin'),
  numericCell('seedNumber'),
  numericCell('price'),
];

/**
 * plans/124 §6.3 — the Field editor grid: per-row draft editing of active state
 * (+ withdrawal reason), world rank, odds, seed, and price, saved in one
 * `adminUpdateGolfFieldEntries` call. Draft holds only edited cells and is
 * cleared on `eventId` change in the render phase (form-state-hazard rule). The
 * patch/validation logic is pure in `golf-field-patch.ts`.
 */
export function GolfFieldGridCard({
  entries,
  eventId,
  fieldError,
  fieldLoading,
  readOnly,
}: {
  entries: GolfFieldEntry[];
  eventId: string;
  fieldError: string | null;
  fieldLoading: boolean;
  readOnly: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-field-page',
  });
  const [draft, setDraft] = useState<Record<string, GolfFieldRowDraft>>({});
  const [draftEventId, setDraftEventId] = useState(eventId);

  if (draftEventId !== eventId) {
    setDraftEventId(eventId);
    setDraft({});
  }

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (patches: GolfFieldPatch[]) => {
      const response = await adminUpdateGolfFieldEntries({
        path: { eventId },
        body: { entries: patches },
      });
      if (!response.data?.entries) {
        throw response.error ?? new Error('Field save response is missing data.');
      }
      return response.data.entries;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.field(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
      QueryKeys.rootAdmin.golf.tiers(eventId),
    ],
    onSuccess: () => setDraft({}),
    onError: (error) => {
      logger.warn(
        { action: 'golf.field.save.failed', err: error },
        'Golf field save was rejected',
      );
    },
  });

  const patches = useMemo(
    () => buildGolfFieldPatches(entries, draft),
    [draft, entries],
  );
  const invalidCount = useMemo(() => golfFieldInvalidCount(draft), [draft]);

  const meta = useMemo<FieldGridMeta>(() => ({ draft, setDraft }), [draft]);

  return (
    <Tile>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Field ({entries.length})
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Tier assignment and pricing per tier are managed on the{' '}
            <LinkButton
              data-testid="root-admin-golf-field-tiers-link"
              size="sm"
              to={`/manage/golf/tournaments/${eventId}/tiers`}
              variant="secondary"
            >
              Tiers page
            </LinkButton>
            .
          </p>
        </div>
      </div>

      {fieldError ? (
        <Alert className="mt-3" data-testid="root-admin-golf-field-load-error" tone="danger">
          {fieldError}
        </Alert>
      ) : null}

      <div className="mt-4">
        <DataGrid
          columns={fieldColumns}
          data={entries}
          emptyMessage={
            fieldLoading
              ? 'Loading field…'
              : 'No golfers in the field yet. Seed from the league roster or add participants.'
          }
          getRowId={(entry) => entry.sportEventParticipantId}
          meta={meta}
          rowTestId={(entry) => `root-admin-golf-field-row-${entry.sportEventParticipantId}`}
          tableTestId="root-admin-golf-field-table"
        />
      </div>

      {!readOnly && (patches.length > 0 || invalidCount > 0) ? (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3"
          data-testid="root-admin-golf-field-dirty-bar"
        >
          <span className="text-sm text-muted-foreground">
            {patches.length} unsaved row{patches.length === 1 ? '' : 's'}
            {invalidCount > 0
              ? ` · ${invalidCount} invalid value${invalidCount === 1 ? '' : 's'}`
              : ''}
          </span>
          <div className="flex gap-2">
            <Button
              data-testid="root-admin-golf-field-discard"
              onClick={() => setDraft({})}
              size="sm"
              variant="secondary"
            >
              Discard
            </Button>
            <Button
              data-testid="root-admin-golf-field-save"
              disabled={patches.length === 0 || invalidCount > 0}
              isLoading={saveMutation.isPending}
              onClick={() => saveMutation.mutate(patches)}
              size="sm"
            >
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      {saveMutation.isError ? (
        <Alert className="mt-3" data-testid="root-admin-golf-field-save-error" tone="danger">
          {extractErrorMessage(saveMutation.error, {
            fallback: 'We could not save these field changes.',
          })}
        </Alert>
      ) : null}
    </Tile>
  );
}

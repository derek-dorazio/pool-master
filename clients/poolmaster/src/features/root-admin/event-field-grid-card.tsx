import {
  formatParticipantStatusLabel,
  getSportDefinition,
  ParticipantInactiveReason,
  type Sport,
} from '@poolmaster/shared/domain';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { updateEventParticipants } from '@/lib/api';
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
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  EVENT_FIELD_INACTIVE_REASONS,
  buildEventFieldPatches,
  eventFieldCellInvalid,
  eventFieldCellValue,
  eventFieldInvalidCount,
  type EventFieldEntry,
  type EventFieldInactiveReason,
  type EventFieldNumericKey,
  type EventFieldPatch,
  type EventFieldRowDraft,
} from './event-field-patch';
import { buildSportEventPath, capitalize } from './manage-navigation';

export type { EventFieldEntry } from './event-field-patch';

type FieldGridMeta = {
  draft: Partial<Record<string, EventFieldRowDraft>>;
  setDraft: Dispatch<SetStateAction<Partial<Record<string, EventFieldRowDraft>>>>;
  /** Released for contests (#431): prices are locked; rank, odds, seed and withdrawals are not. */
  pricesLocked: boolean;
  /** The event's sport: it names the participant column and the reasons a runner is out. */
  sport: Sport;
};

/**
 * The reasons a participant can be marked out of this sport's field. Being knocked out partway
 * (`ELIMINATED`) is offered only for a sport that has a word for it; a race has none.
 */
function inactiveReasonsFor(sport: Sport): readonly EventFieldInactiveReason[] {
  const { eliminated } = getSportDefinition(sport).vocabulary;
  return EVENT_FIELD_INACTIVE_REASONS.filter(
    (reason) => reason !== ParticipantInactiveReason.ELIMINATED || eliminated !== undefined,
  );
}

const NUMERIC_COLUMN_LABEL: Record<EventFieldNumericKey, string> = {
  ranking: 'Ranking',
  oddsToWin: 'Odds',
  seedNumber: 'Seed',
  price: 'Price',
};

const columnHelper = createColumnHelper<EventFieldEntry>();

function patchRowDraft(
  setDraft: FieldGridMeta['setDraft'],
  id: string,
  partial: Partial<EventFieldRowDraft>,
) {
  setDraft((current) => ({
    ...current,
    [id]: { ...current[id], ...partial },
  }));
}

function numericCell(key: EventFieldNumericKey) {
  return columnHelper.display({
    id: key,
    header: NUMERIC_COLUMN_LABEL[key],
    cell: ({ row, table }) => {
      const { draft, setDraft, pricesLocked } = table.options.meta as FieldGridMeta;
      const entry = row.original;
      const raw = eventFieldCellValue(entry, draft[entry.id], key);
      const invalid = eventFieldCellInvalid(raw, key);
      return (
        <div className="max-w-[7rem]">
          <Input
            aria-invalid={invalid || undefined}
            aria-label={`${NUMERIC_COLUMN_LABEL[key]} for ${entry.participant.name}`}
            data-testid={`root-admin-event-field-${key}-${entry.id}`}
            disabled={key === 'price' && pricesLocked}
            inputMode={key === 'oddsToWin' ? 'decimal' : 'numeric'}
            onChange={(event) =>
              patchRowDraft(setDraft, entry.id, {
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
  columnHelper.accessor((entry) => entry.participant.name, {
    id: 'participantName',
    header: ({ table }) =>
      capitalize(getSportDefinition((table.options.meta as FieldGridMeta).sport).vocabulary.participant.one),
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">
          {row.original.participant.name}
        </span>
        {row.original.affiliatedWithSportLeague ? null : (
          <StatusBadge tone="warning">Guest</StatusBadge>
        )}
      </div>
    ),
  }),
  columnHelper.display({
    id: 'active',
    header: 'In field',
    cell: ({ row, table }) => {
      const { draft, setDraft, sport } = table.options.meta as FieldGridMeta;
      const entry = row.original;
      const rowDraft = draft[entry.id];
      const active = rowDraft?.isActive ?? entry.isActive;
      const reason: EventFieldInactiveReason =
        rowDraft?.inactiveReason ?? entry.inactiveReason ?? 'WITHDRAWN';
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={active}
              data-testid={`root-admin-event-field-active-${entry.id}`}
              onChange={(event) =>
                patchRowDraft(setDraft, entry.id, {
                  isActive: event.target.checked,
                })
              }
            />
            <span>{active ? 'In field' : 'Out'}</span>
          </label>
          {active ? null : (
            <Select
              aria-label={`Withdrawal reason for ${entry.participant.name}`}
              data-testid={`root-admin-event-field-reason-${entry.id}`}
              onChange={(event) =>
                patchRowDraft(setDraft, entry.id, {
                  inactiveReason: event.target.value as EventFieldInactiveReason,
                })
              }
              value={reason}
            >
              {inactiveReasonsFor(sport).map((value) => (
                <option key={value} value={value}>
                  {formatParticipantStatusLabel(value, sport)}
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
  numericCell('ranking'),
  numericCell('oddsToWin'),
  numericCell('seedNumber'),
  numericCell('price'),
];

/**
 * plans/124 §6.3 — the Field editor grid: per-row draft editing of active state
 * (+ withdrawal reason), ranking, odds, seed, and price, saved in one
 * `updateEventParticipants` call. Draft holds only edited cells and is
 * cleared on `eventId` change in the render phase (form-state-hazard rule). The
 * patch/validation logic is pure in `event-field-patch.ts`.
 */
export function EventFieldGridCard({
  entries,
  eventId,
  fieldError,
  fieldLoading,
  pricesLocked = false,
  sport,
}: {
  entries: EventFieldEntry[];
  eventId: string;
  sport: Sport;
  fieldError: string | null;
  fieldLoading: boolean;
  pricesLocked?: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-field-page',
  });
  const [draft, setDraft] = useState<Partial<Record<string, EventFieldRowDraft>>>({});
  const [draftEventId, setDraftEventId] = useState(eventId);

  if (draftEventId !== eventId) {
    setDraftEventId(eventId);
    setDraft({});
  }

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (patches: EventFieldPatch[]) => {
      const response = await updateEventParticipants({
        path: { eventId },
        body: { participants: patches },
      });
      if (!response.data?.participants) {
        throwApiError(response.error, 'Field save response is missing data.');
      }
      return response.data.participants;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.field(eventId),
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.rootAdmin.manageSport.tiers(eventId),
    ],
    onSuccess: () => setDraft({}),
    onError: (error) => {
      logger.warn(
        { action: 'event.field.save.failed', err: error },
        'Field save was rejected',
      );
    },
  });

  const patches = useMemo(
    () => buildEventFieldPatches(entries, draft),
    [draft, entries],
  );
  const invalidCount = useMemo(() => eventFieldInvalidCount(draft), [draft]);

  const meta = useMemo<FieldGridMeta>(
    () => ({ draft, setDraft, pricesLocked, sport }),
    [draft, pricesLocked, sport],
  );
  const { event, participant, sportLeague } = getSportDefinition(sport).vocabulary;

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
              data-testid="root-admin-event-field-tiers-link"
              size="sm"
              to={`${buildSportEventPath(sport, eventId)}/tiers`}
              variant="secondary"
            >
              Tiers page
            </LinkButton>
            .
          </p>
        </div>
      </div>

      {fieldError ? (
        <Alert className="mt-3" data-testid="root-admin-event-field-load-error" tone="danger">
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
              : `No ${participant.many} in the field yet. Seed from the ${sportLeague.one} roster or add participants.`
          }
          getRowId={(entry) => entry.id}
          meta={meta}
          rowTestId={(entry) => `root-admin-event-field-row-${entry.id}`}
          tableTestId="root-admin-event-field-table"
        />
      </div>

      {patches.length > 0 || invalidCount > 0 ? (
        <div
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3"
          data-testid="root-admin-event-field-dirty-bar"
        >
          <span className="text-sm text-muted-foreground">
            {patches.length} unsaved row{patches.length === 1 ? '' : 's'}
            {invalidCount > 0
              ? ` · ${invalidCount} invalid value${invalidCount === 1 ? '' : 's'}`
              : ''}
          </span>
          <div className="flex gap-2">
            <Button
              data-testid="root-admin-event-field-discard"
              onClick={() => setDraft({})}
              size="sm"
              variant="secondary"
            >
              Discard
            </Button>
            <Button
              data-testid="root-admin-event-field-save"
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
        <Alert className="mt-3" data-testid="root-admin-event-field-save-error" tone="danger">
          {extractErrorMessage(saveMutation.error, {
            codeMessages: {
              SPORT_EVENT_TIERS_LOCKED: `This ${event.one} has been released for contests, so its prices are locked.`,
            },
            fallback: 'We could not save these field changes.',
          })}
        </Alert>
      ) : null}
    </Tile>
  );
}

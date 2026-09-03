import { useMemo, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { adminReplaceGolfTierAssignments, adminUpdateGolfFieldEntries } from '@/lib/api';
import { Alert, Button, Input, Select, SortableList, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  assignmentsEqual,
  buildTierBoard,
  moveCard,
  nudgeCard,
  reorderColumn,
  toAssignmentsPayload,
  type TierCard,
  type TierColumn,
} from './golf-tier-board-utils';
import type {
  AdminGetGolfTournamentFieldResponses,
  AdminGetGolfTournamentTiersResponses,
} from '@/lib/api';

type TierDto = AdminGetGolfTournamentTiersResponses[200]['tiers'][number];
type FieldEntry =
  AdminGetGolfTournamentFieldResponses[200]['entries'][number];

const TIER_LOCKED_MESSAGE =
  'This tournament has contest entries. Tier and price changes are locked to keep existing picks consistent.';

function isValidPrice(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

function boardIdentity(columns: readonly TierColumn[]): string {
  return JSON.stringify(
    columns.map((column) => [
      column.key,
      column.cards.map((card) => [card.sportEventParticipantId, card.price]),
    ]),
  );
}

function findCard(
  columns: readonly TierColumn[],
  sportEventParticipantId: string,
): TierCard | undefined {
  for (const column of columns) {
    const card = column.cards.find(
      (c) => c.sportEventParticipantId === sportEventParticipantId,
    );
    if (card) {
      return card;
    }
  }
  return undefined;
}

/**
 * plans/124 §6.3 — the right-hand tier board: one column per tier plus
 * "Unassigned". Within-column ordering is drag + keyboard (the shared
 * `SortableList`); cross-tier moves are the "Move to tier" `Select` (the
 * pointer-free equivalent of a cross-column drag, §6.3); up/down buttons are the
 * explicit non-drag reorder. Price is edited inline per card. Assignments and
 * price edits save as two independent mutations so a price failure can't lose a
 * landed assignment change.
 */
export function GolfTierBoard({
  eventId,
  field,
  readOnly,
  tiers,
}: {
  eventId: string;
  field: FieldEntry[];
  readOnly: boolean;
  tiers: TierDto[];
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-tiers-page',
  });

  const serverBoard = useMemo(() => buildTierBoard(tiers, field), [field, tiers]);
  const serverKey = useMemo(() => boardIdentity(serverBoard), [serverBoard]);
  const [board, setBoard] = useState<TierColumn[]>(serverBoard);
  const [boardKey, setBoardKey] = useState(serverKey);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  // Re-seed the local board when the server assignment/price state changes (a
  // save, an auto-assign) — keyed by a stable digest, never on every query
  // object identity, per the form-state-hazard rule.
  if (serverKey !== boardKey) {
    setBoardKey(serverKey);
    setBoard(serverBoard);
    setPriceDraft({});
  }

  const assignmentsDirty = useMemo(
    () => !assignmentsEqual(board, serverBoard),
    [board, serverBoard],
  );
  const priceEdits = useMemo(
    () =>
      Object.entries(priceDraft)
        .filter(([sepId, raw]) => {
          if (!isValidPrice(raw)) return false;
          const card = findCard(serverBoard, sepId);
          return card ? Number(raw) !== card.price : false;
        })
        .map(([sportEventParticipantId, raw]) => ({
          sportEventParticipantId,
          price: Number(raw),
        })),
    [priceDraft, serverBoard],
  );
  const priceInvalid = Object.values(priceDraft).some(
    (raw) => raw.trim() !== '' && !isValidPrice(raw),
  );
  const dirty = assignmentsDirty || priceEdits.length > 0;

  const assignmentsMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await adminReplaceGolfTierAssignments({
        path: { eventId },
        body: { assignments: toAssignmentsPayload(board) },
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
        { action: 'golf.tiers.assignments.save.failed', err: error },
        'Golf tier assignment save was rejected',
      );
    },
  });

  const pricesMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await adminUpdateGolfFieldEntries({
        path: { eventId },
        body: { entries: priceEdits },
      });
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tiers(eventId),
      QueryKeys.rootAdmin.golf.field(eventId),
    ],
    onSuccess: () => setPriceDraft({}),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tiers.prices.save.failed', err: error },
        'Golf tier price save was rejected',
      );
    },
  });

  async function handleSave() {
    if (assignmentsDirty) {
      try {
        await assignmentsMutation.mutateAsync();
      } catch {
        // Assignments failed — its own error Alert covers it; do not attempt
        // the price PATCH so the two steps can't half-land.
        return;
      }
    }
    if (priceEdits.length > 0) {
      try {
        await pricesMutation.mutateAsync();
      } catch {
        // Assignments (if any) already landed + invalidated; the price failure
        // surfaces via pricesMutation.isError with step-aware copy.
      }
    }
  }

  const saving = assignmentsMutation.isPending || pricesMutation.isPending;
  const saveError = assignmentsMutation.isError
    ? extractErrorMessage(assignmentsMutation.error, {
        codeMessages: { TIERS_LOCKED_BY_ENTRIES: TIER_LOCKED_MESSAGE },
        fallback: 'We could not save these tier assignments.',
      })
    : pricesMutation.isError
      ? `Tier assignments saved, but prices could not be saved: ${extractErrorMessage(
          pricesMutation.error,
          {
            codeMessages: { TIERS_LOCKED_BY_ENTRIES: TIER_LOCKED_MESSAGE },
            fallback: 'please retry.',
          },
        )}`
      : null;

  const moveOptions = board.map((column) => ({
    value: column.key,
    label: column.tierKey === null ? 'Unassigned' : column.label,
  }));

  const editable = !readOnly;

  function renderCard(column: TierColumn, card: TierCard, index: number) {
    const priceRaw =
      priceDraft[card.sportEventParticipantId] ??
      (card.price == null ? '' : String(card.price));
    const priceBad = priceRaw.trim() !== '' && !isValidPrice(priceRaw);
    return (
      <div
        className="rounded-2xl border border-border bg-card p-3"
        data-testid={`root-admin-golf-tier-card-${card.sportEventParticipantId}`}
      >
        <p className="truncate font-medium text-foreground">{card.name}</p>
        <p className="text-xs text-muted-foreground">
          Rank {card.worldRanking ?? '—'} · Odds {card.oddsToWin ?? '—'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`price-${card.sportEventParticipantId}`}
          >
            $
          </label>
          <Input
            aria-invalid={priceBad || undefined}
            aria-label={`Price for ${card.name}`}
            className="h-8"
            data-testid={`root-admin-golf-tier-price-${card.sportEventParticipantId}`}
            disabled={!editable}
            id={`price-${card.sportEventParticipantId}`}
            inputMode="numeric"
            onChange={(event) =>
              setPriceDraft((current) => ({
                ...current,
                [card.sportEventParticipantId]: event.target.value,
              }))
            }
            value={priceRaw}
          />
        </div>
        {editable ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select
              aria-label={`Move ${card.name} to tier`}
              className="h-8"
              data-testid={`root-admin-golf-tier-move-${card.sportEventParticipantId}`}
              onChange={(event) =>
                setBoard((current) =>
                  moveCard(current, card.sportEventParticipantId, event.target.value),
                )
              }
              value={column.key}
            >
              {moveOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Button
              aria-label={`Move ${card.name} up`}
              data-testid={`root-admin-golf-tier-up-${card.sportEventParticipantId}`}
              disabled={index === 0}
              onClick={() =>
                setBoard((current) => nudgeCard(current, card.sportEventParticipantId, -1))
              }
              size="sm"
              variant="secondary"
            >
              <span aria-hidden>↑</span>
            </Button>
            <Button
              aria-label={`Move ${card.name} down`}
              data-testid={`root-admin-golf-tier-down-${card.sportEventParticipantId}`}
              disabled={index === column.cards.length - 1}
              onClick={() =>
                setBoard((current) => nudgeCard(current, card.sportEventParticipantId, 1))
              }
              size="sm"
              variant="secondary"
            >
              <span aria-hidden>↓</span>
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Tile>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">Tier assignments</h3>
        {editable && (dirty || priceInvalid) ? (
          <div
            className="flex items-center gap-2"
            data-testid="root-admin-golf-tier-board-dirty-bar"
          >
            <span className="text-sm text-muted-foreground">
              {assignmentsDirty ? 'Tier changes' : ''}
              {assignmentsDirty && priceEdits.length > 0 ? ' · ' : ''}
              {priceEdits.length > 0
                ? `${priceEdits.length} price edit${priceEdits.length === 1 ? '' : 's'}`
                : ''}
              {priceInvalid ? ' · invalid price' : ''}
            </span>
            <Button
              data-testid="root-admin-golf-tier-board-discard"
              onClick={() => {
                setBoard(serverBoard);
                setPriceDraft({});
              }}
              size="sm"
              variant="secondary"
            >
              Discard
            </Button>
            <Button
              data-testid="root-admin-golf-tier-board-save"
              disabled={!dirty || priceInvalid || saving}
              isLoading={saving}
              onClick={() => void handleSave()}
              size="sm"
            >
              Save changes
            </Button>
          </div>
        ) : null}
      </div>

      {saveError ? (
        <Alert className="mt-3" data-testid="root-admin-golf-tier-board-error" tone="danger">
          {saveError}
        </Alert>
      ) : null}

      <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
        {board.map((column) => (
          <TierBoardColumn
            column={column}
            editable={editable}
            key={column.key}
            onReorder={(orderedIds) =>
              setBoard((current) => reorderColumn(current, column.key, orderedIds))
            }
            renderCard={renderCard}
          />
        ))}
      </div>
    </Tile>
  );
}

function TierBoardColumn({
  column,
  editable,
  onReorder,
  renderCard,
}: {
  column: TierColumn;
  editable: boolean;
  onReorder: (orderedIds: string[]) => void;
  renderCard: (column: TierColumn, card: TierCard, index: number) => ReactNode;
}) {
  const items = useMemo(
    () =>
      column.cards.map((card) => ({ ...card, id: card.sportEventParticipantId })),
    [column.cards],
  );

  return (
    <section
      className="w-64 shrink-0 rounded-2xl border border-border bg-muted/20 p-3"
      data-testid={`root-admin-golf-tier-column-${column.key}`}
    >
      <h4 className="text-sm font-semibold text-foreground">
        {column.label}{' '}
        <span className="text-muted-foreground">({column.cards.length})</span>
      </h4>
      {column.cards.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No golfers.</p>
      ) : editable ? (
        <SortableList
          aria-label={`${column.label} golfers`}
          className="mt-3"
          items={items}
          onReorder={onReorder}
          renderItem={(card, { dragHandleProps, index }) => (
            <div className="flex items-start gap-2">
              <Button
                aria-label={`Drag ${card.name} to reorder`}
                className="mt-3 shrink-0 cursor-grab px-2"
                size="sm"
                variant="ghost"
                {...dragHandleProps}
              >
                <GripVertical aria-hidden className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">{renderCard(column, card, index)}</div>
            </div>
          )}
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {column.cards.map((card, index) => (
            <li key={card.sportEventParticipantId}>
              {renderCard(column, card, index)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

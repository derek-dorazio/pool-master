import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { updateEventParticipantGolfRoundScore } from '@/lib/api';
import { Alert, Button, DataGrid, Input, Select, Tile } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { UpdateGolfRoundScoreRequest } from '@/lib/api';
import {
  GOLF_ROUND_SCORE_STATUSES,
  formatGolfRoundStatus,
  type GolfRoundScoreRow,
  type GolfRoundScoreStatus,
} from './golf-admin-utils';
import {
  buildRoundScorePatch,
  isSignedInt,
  isStrokes,
  isThru,
  rowHasInvalid,
  toDateTimeInput,
  type RowDraft,
} from './golf-round-score-patch';

type ScoreRow = GolfRoundScoreRow;
type ScorePatch = UpdateGolfRoundScoreRequest;

type CorrectionsMeta = {
  draft: Record<string, RowDraft>;
  setDraft: Dispatch<SetStateAction<Record<string, RowDraft>>>;
  savingId: string | null;
  onSave: (row: ScoreRow) => void;
};

const columnHelper = createColumnHelper<ScoreRow>();


const correctionColumns = [
  columnHelper.accessor('participantName', {
    header: 'Player',
    cell: ({ getValue }) => (
      <span className="font-medium text-foreground">{getValue()}</span>
    ),
  }),
  columnHelper.display({
    id: 'strokes',
    header: 'Strokes',
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw = draft[entry.sportEventParticipantId]?.strokes ?? String(entry.strokes);
      return (
        <div className="max-w-[6rem]">
          <Input
            aria-invalid={raw.trim() !== '' && !isStrokes(raw) ? true : undefined}
            aria-label={`Strokes for ${entry.participantName}`}
            className="h-8"
            data-testid={`root-admin-golf-scores-strokes-${entry.sportEventParticipantId}`}
            inputMode="numeric"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [entry.sportEventParticipantId]: {
                  ...current[entry.sportEventParticipantId],
                  strokes: event.target.value,
                },
              }))
            }
            value={raw}
          />
        </div>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'scoreToPar',
    header: 'To par',
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw = draft[entry.sportEventParticipantId]?.scoreToPar ?? String(entry.scoreToPar);
      return (
        <div className="max-w-[5rem]">
          <Input
            aria-invalid={raw.trim() !== '' && !isSignedInt(raw) ? true : undefined}
            aria-label={`Score to par for ${entry.participantName}`}
            className="h-8"
            data-testid={`root-admin-golf-scores-to-par-${entry.sportEventParticipantId}`}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [entry.sportEventParticipantId]: {
                  ...current[entry.sportEventParticipantId],
                  scoreToPar: event.target.value,
                },
              }))
            }
            value={raw}
          />
        </div>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'thru',
    header: 'Thru',
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw = draft[entry.sportEventParticipantId]?.thru ?? String(entry.thru);
      return (
        <div className="max-w-[5rem]">
          <Input
            aria-invalid={raw.trim() !== '' && !isThru(raw) ? true : undefined}
            aria-label={`Holes completed for ${entry.participantName}`}
            className="h-8"
            data-testid={`root-admin-golf-scores-thru-${entry.sportEventParticipantId}`}
            inputMode="numeric"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [entry.sportEventParticipantId]: {
                  ...current[entry.sportEventParticipantId],
                  thru: event.target.value,
                },
              }))
            }
            value={raw}
          />
        </div>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'status',
    header: 'Status',
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw =
        draft[entry.sportEventParticipantId]?.status ??
        (GOLF_ROUND_SCORE_STATUSES.includes(entry.status as GolfRoundScoreStatus)
          ? (entry.status as GolfRoundScoreStatus)
          : 'IN_PROGRESS');
      return (
        <Select
          aria-label={`Status for ${entry.participantName}`}
          className="h-8"
          data-testid={`root-admin-golf-scores-status-${entry.sportEventParticipantId}`}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              [entry.sportEventParticipantId]: {
                ...current[entry.sportEventParticipantId],
                status: event.target.value as GolfRoundScoreStatus,
              },
            }))
          }
          value={raw}
        >
          {GOLF_ROUND_SCORE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {formatGolfRoundStatus(value)}
            </option>
          ))}
        </Select>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'completedAt',
    header: 'Completed at',
    cell: ({ row, table }) => {
      const { draft, setDraft } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw = draft[entry.sportEventParticipantId]?.completedAt ?? toDateTimeInput(entry.completedAt);
      return (
        <Input
          aria-invalid={draft[entry.sportEventParticipantId]?.completedAtIncomplete ? true : undefined}
          aria-label={`Completed at for ${entry.participantName}`}
          className="h-8"
          data-testid={`root-admin-golf-scores-completed-at-${entry.sportEventParticipantId}`}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              [entry.sportEventParticipantId]: {
                ...current[entry.sportEventParticipantId],
                completedAt: event.target.value,
                completedAtIncomplete: event.target.validity.badInput,
              },
            }))
          }
          type="datetime-local"
          value={raw}
        />
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
  columnHelper.display({
    id: 'save',
    header: '',
    cell: ({ row, table }) => {
      const meta = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const rowDraft = meta.draft[entry.sportEventParticipantId];
      const dirty = buildRoundScorePatch(entry, rowDraft) !== null;
      const invalid = rowHasInvalid(rowDraft);
      return (
        <Button
          data-testid={`root-admin-golf-scores-save-${entry.sportEventParticipantId}`}
          disabled={!dirty || invalid}
          isLoading={meta.savingId === entry.sportEventParticipantId}
          onClick={() => meta.onSave(entry)}
          size="sm"
        >
          Save
        </Button>
      );
    },
    enableColumnFilter: false,
    enableSorting: false,
  }),
];

/**
 * plans/124 §6.3 Round scores section 2 — inline corrections for one round, saved
 * one row at a time via `updateEventParticipantGolfRoundScore`. #116: a row edits
 * every stored value (strokes, to par, thru, status, completed at) and one save sends
 * the changed ones together; the server stores them as sent and derives none.
 */
export function GolfRoundScoreCorrectionsCard({
  eventId,
  round,
  rows,
  rowsError,
  rowsLoading,
}: {
  eventId: string;
  round: number;
  rows: ScoreRow[];
  rowsError: string | null;
  rowsLoading: boolean;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-scores-page',
  });
  const [draft, setDraft] = useState<Record<string, RowDraft>>({});
  const [draftScope, setDraftScope] = useState(`${eventId}:${round}`);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async ({
      sportEventParticipantId,
      body,
    }: {
      sportEventParticipantId: string;
      body: ScorePatch;
    }) => {
      const response = await updateEventParticipantGolfRoundScore({
        path: { eventId, roundNumber: round, sportEventParticipantId },
        body,
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // Round scores are read from the field (#236).
    invalidates: [QueryKeys.rootAdmin.golf.field(eventId)],
    onSuccess: (_data, variables) =>
      setDraft((current) => {
        const next = { ...current };
        delete next[variables.sportEventParticipantId];
        return next;
      }),
    onError: (error) => {
      logger.warn(
        { action: 'golf.roundScore.correction.failed', err: error },
        'Golf round-score correction was rejected',
      );
    },
  });

  // Reset the per-round draft + stale save error when the round (or tournament)
  // changes, keyed on a stable scope string, in the render phase (not an effect).
  const scope = `${eventId}:${round}`;
  if (draftScope !== scope) {
    setDraftScope(scope);
    setDraft({});
    if (saveMutation.isError) {
      saveMutation.reset();
    }
  }

  const meta = useMemo<CorrectionsMeta>(
    () => ({
      draft,
      setDraft,
      savingId: saveMutation.isPending
        ? saveMutation.variables?.sportEventParticipantId ?? null
        : null,
      onSave: (row) => {
        const body = buildRoundScorePatch(row, draft[row.sportEventParticipantId]);
        if (body) {
          saveMutation.mutate({ sportEventParticipantId: row.sportEventParticipantId, body });
        }
      },
    }),
    [draft, saveMutation],
  );

  return (
    <Tile>
      <h3 className="text-base font-semibold text-foreground">Corrections</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Fix one golfer&rsquo;s round result at a time. Enter every value yourself: changing strokes does not change to par, and completing a round does not set its time.
      </p>

      {rowsError ? (
        <Alert className="mt-3" data-testid="root-admin-golf-scores-corrections-error" tone="danger">
          {rowsError}
        </Alert>
      ) : null}

      {saveMutation.isError ? (
        <Alert className="mt-3" data-testid="root-admin-golf-scores-correction-save-error" tone="danger">
          {extractErrorMessage(saveMutation.error, {
            fallback: 'We could not save that correction.',
          })}
        </Alert>
      ) : null}

      <div className="mt-4">
        <DataGrid
          columns={correctionColumns}
          data={rows}
          emptyMessage={
            rowsLoading
              ? 'Loading scores…'
              : 'No scores recorded for this round yet. Use the bulk load above.'
          }
          getRowId={(row) => row.sportEventParticipantId}
          meta={meta}
          rowTestId={(row) => `root-admin-golf-scores-row-${row.sportEventParticipantId}`}
          tableTestId="root-admin-golf-scores-corrections-table"
        />
      </div>
    </Tile>
  );
}

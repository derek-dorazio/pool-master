import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { adminUpdateGolfRoundScore } from '@/lib/api';
import { Alert, Button, DataGrid, Input, Select, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type {
  AdminGetGolfRoundScoresResponses,
  AdminUpdateGolfRoundScoreData,
} from '@/lib/api';
import {
  GOLF_ROUND_SCORE_STATUSES,
  formatGolfRoundStatus,
  type GolfRoundScoreStatus,
} from './golf-admin-utils';

type ScoreRow = AdminGetGolfRoundScoresResponses[200]['rows'][number];
type ScorePatch = AdminUpdateGolfRoundScoreData['body'];

type RowDraft = { strokes?: string; thru?: string; status?: GolfRoundScoreStatus };
type CorrectionsMeta = {
  draft: Record<string, RowDraft>;
  setDraft: Dispatch<SetStateAction<Record<string, RowDraft>>>;
  savingId: string | null;
  onSave: (row: ScoreRow) => void;
  readOnly: boolean;
};

const columnHelper = createColumnHelper<ScoreRow>();

function isNonNegInt(raw: string): boolean {
  return /^\d+$/.test(raw.trim());
}

/** The changed-fields patch for one correction row, or null when nothing changed. */
export function buildRoundScorePatch(
  row: ScoreRow,
  draft: RowDraft | undefined,
): ScorePatch | null {
  if (!draft) {
    return null;
  }
  const patch: ScorePatch = {};
  if (
    draft.strokes !== undefined &&
    isNonNegInt(draft.strokes) &&
    Number(draft.strokes) !== row.strokes
  ) {
    patch.strokes = Number(draft.strokes);
  }
  if (
    draft.thru !== undefined &&
    isNonNegInt(draft.thru) &&
    Number(draft.thru) !== row.thru
  ) {
    patch.thru = Number(draft.thru);
  }
  if (draft.status !== undefined && draft.status !== row.status) {
    patch.status = draft.status;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function rowHasInvalid(draft: RowDraft | undefined): boolean {
  if (!draft) return false;
  return (
    (draft.strokes !== undefined && draft.strokes.trim() !== '' && !isNonNegInt(draft.strokes)) ||
    (draft.thru !== undefined && draft.thru.trim() !== '' && !isNonNegInt(draft.thru))
  );
}

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
      const { draft, setDraft, readOnly } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw = draft[entry.sportEventParticipantId]?.strokes ?? String(entry.strokes);
      return (
        <div className="max-w-[6rem]">
          <Input
            aria-invalid={raw.trim() !== '' && !isNonNegInt(raw) ? true : undefined}
            aria-label={`Strokes for ${entry.participantName}`}
            className="h-8"
            data-testid={`root-admin-golf-scores-strokes-${entry.sportEventParticipantId}`}
            disabled={readOnly}
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
    id: 'thru',
    header: 'Thru',
    cell: ({ row, table }) => {
      const { draft, setDraft, readOnly } = table.options.meta as CorrectionsMeta;
      const entry = row.original;
      const raw = draft[entry.sportEventParticipantId]?.thru ?? String(entry.thru);
      return (
        <div className="max-w-[5rem]">
          <Input
            aria-invalid={raw.trim() !== '' && !isNonNegInt(raw) ? true : undefined}
            aria-label={`Holes completed for ${entry.participantName}`}
            className="h-8"
            data-testid={`root-admin-golf-scores-thru-${entry.sportEventParticipantId}`}
            disabled={readOnly}
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
      const { draft, setDraft, readOnly } = table.options.meta as CorrectionsMeta;
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
          disabled={readOnly}
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
 * plans/124 §6.3 Round scores section 2 — inline strokes / thru / status
 * corrections for one round, saved one row at a time via
 * `adminUpdateGolfRoundScore`.
 */
export function GolfRoundScoreCorrectionsCard({
  eventId,
  round,
  rows,
  rowsError,
  rowsLoading,
  readOnly,
}: {
  eventId: string;
  round: number;
  rows: ScoreRow[];
  rowsError: string | null;
  rowsLoading: boolean;
  readOnly: boolean;
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
      const response = await adminUpdateGolfRoundScore({
        path: { eventId, round, sportEventParticipantId },
        body,
      });
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.golf.roundScores(eventId, round)],
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
      readOnly,
    }),
    [draft, readOnly, saveMutation],
  );

  return (
    <Tile>
      <h3 className="text-base font-semibold text-foreground">Corrections</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Fix one golfer&rsquo;s round result at a time.
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
          columns={readOnly ? correctionColumns.slice(0, 4) : correctionColumns}
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

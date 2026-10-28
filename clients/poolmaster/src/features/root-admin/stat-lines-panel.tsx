import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { eventSportDefinition, type SportComposite } from '@poolmaster/shared/domain';
import { applyEventGameStatLines, type GameStatLineUploadRequest, type SportEventDto } from '@/lib/api';
import { Alert, Button, DataGrid, Input, SegmentedControl, Tile } from '@/features/shared/ui';
import { SPORT_STAT_LABELS } from '@/features/contests/scoring-family-ui/stat-labels';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  buildStatLineRow,
  draftLine,
  isStatInput,
  statInputValue,
  statLineGridRows,
  type StatLineDraft,
  type StatLineGridRow,
} from './stat-line-grid';
import { useSportEventFieldQuery } from './use-sport-event';

type GridMeta = {
  composite: SportComposite;
  draft: Partial<Record<string, StatLineDraft>>;
  setDraft: Dispatch<SetStateAction<Partial<Record<string, StatLineDraft>>>>;
  savingId: string | null;
  onSave: (row: StatLineGridRow) => void;
};

const columnHelper = createColumnHelper<StatLineGridRow>();

/** The grid's columns: the player, one input per stat the composite counts, its total, and save. */
function statLineColumns(composite: SportComposite) {
  return [
    columnHelper.accessor('playerName', {
      header: 'Player',
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-foreground">{row.original.playerName}</span>
          {row.original.team ? <span className="block text-xs text-muted-foreground">{row.original.team}</span> : null}
        </div>
      ),
    }),
    ...composite.stats.map((stat) => columnHelper.display({
      id: stat,
      header: SPORT_STAT_LABELS[stat].short,
      cell: ({ row, table }) => {
        const { draft, setDraft } = table.options.meta as GridMeta;
        const entry = row.original;
        const raw = statInputValue(entry, draft[entry.sportEventParticipantId], stat);
        return (
          <div className="max-w-[5rem]">
            <Input
              aria-invalid={isStatInput(raw, stat) ? undefined : true}
              aria-label={`${SPORT_STAT_LABELS[stat].long} for ${entry.playerName}`}
              className="h-8"
              data-testid={`root-admin-stat-lines-${stat}-${entry.sportEventParticipantId}`}
              inputMode="numeric"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [entry.sportEventParticipantId]: { ...current[entry.sportEventParticipantId], [stat]: event.target.value },
                }))
              }
              value={raw}
            />
          </div>
        );
      },
      enableColumnFilter: false,
      enableSorting: false,
    })),
    columnHelper.display({
      id: 'composite',
      header: composite.name,
      cell: ({ row, table }) => {
        const { draft } = table.options.meta as GridMeta;
        const entry = row.original;
        const line = draftLine(entry, draft[entry.sportEventParticipantId], composite);
        return (
          <span className="font-semibold tabular-nums" data-testid={`root-admin-stat-lines-total-${entry.sportEventParticipantId}`}>
            {line === undefined ? '–' : composite.score(line)}
          </span>
        );
      },
      enableColumnFilter: false,
      enableSorting: false,
    }),
    columnHelper.display({
      id: 'save',
      header: '',
      cell: ({ row, table }) => {
        const meta = table.options.meta as GridMeta;
        const entry = row.original;
        return (
          <Button
            data-testid={`root-admin-stat-lines-save-${entry.sportEventParticipantId}`}
            disabled={buildStatLineRow(entry, meta.draft[entry.sportEventParticipantId], composite) === null}
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
}

/**
 * A stat pool event's results (#935): each game's box score, one game at a time, with a row per
 * player in the field. The box scores are loaded with the event's sport data file; here an admin
 * checks them and corrects one player's line at a time. A save sends the player's whole line for
 * the game, so clearing every stat removes it. Every contest on the event rescores from the lines.
 */
export function StatLinesPanel({ event }: { event: SportEventDto }) {
  const eventId = event.id;
  const definition = eventSportDefinition(event);
  const composite = definition.composite;
  const logger = getLogger().child({ feature: 'root-admin-stat-lines' });
  const [game, setGame] = useState(1);
  const [draft, setDraft] = useState<Partial<Record<string, StatLineDraft>>>({});
  const [draftScope, setDraftScope] = useState(`${eventId}:${game}`);
  const fieldQuery = useSportEventFieldQuery(eventId);

  const saveMutation = useInvalidatingMutation({
    mutationFn: async ({ row }: { sportEventParticipantId: string; row: GameStatLineUploadRequest['rows'][number] }) => {
      const response = await applyEventGameStatLines({ path: { eventId, roundNumber: game }, body: { rows: [row] } });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.field(eventId)],
    onSuccess: (_data, variables) =>
      setDraft((current) => {
        const next = { ...current };
        delete next[variables.sportEventParticipantId];
        return next;
      }),
    onError: (error) => {
      logger.warn({ action: 'statLines.correction.failed', err: error }, 'Stat line correction was rejected');
    },
  });

  // A new game (or event) starts with no draft and no stale save error, reset in the render phase.
  const scope = `${eventId}:${game}`;
  if (draftScope !== scope) {
    setDraftScope(scope);
    setDraft({});
    if (saveMutation.isError) {
      saveMutation.reset();
    }
  }

  const games = event.rounds ?? 0;
  const gameOptions = useMemo(
    () => Array.from({ length: games }, (_, index) => ({ value: String(index + 1), label: definition.roundLabel(index + 1, games) })),
    [definition, games],
  );
  const rows = useMemo(() => statLineGridRows(fieldQuery.data ?? [], game), [fieldQuery.data, game]);
  const columns = useMemo(() => (composite ? statLineColumns(composite) : []), [composite]);
  const meta = useMemo<GridMeta | null>(
    () => (composite
      ? {
          composite,
          draft,
          setDraft,
          savingId: saveMutation.isPending ? saveMutation.variables.sportEventParticipantId : null,
          onSave: (row) => {
            const body = buildStatLineRow(row, draft[row.sportEventParticipantId], composite);
            if (body) {
              saveMutation.mutate({ sportEventParticipantId: row.sportEventParticipantId, row: body });
            }
          },
        }
      : null),
    [composite, draft, saveMutation],
  );

  if (!composite || !meta) {
    return null;
  }

  return (
    <div className="space-y-6" data-testid={`stat-lines-panel-${eventId}`}>
      {gameOptions.length > 0 ? (
        <SegmentedControl aria-label="Game" onChange={(value) => setGame(Number(value))} options={gameOptions} value={String(game)} />
      ) : (
        <Alert data-testid="root-admin-stat-lines-no-games" tone="info">
          This event has no games scheduled yet.
        </Alert>
      )}

      {gameOptions.length > 0 ? (
        <Tile>
          <h3 className="title-card text-base text-foreground">Box score</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Each game&rsquo;s box score is loaded with the event&rsquo;s sport data file. Fix one player&rsquo;s line at a time: saving replaces their whole line for the game, and clearing every stat removes it. Leave a stat blank for zero.
          </p>

          {fieldQuery.isError ? (
            <Alert className="mt-3" data-testid="root-admin-stat-lines-field-error" tone="danger">
              {extractErrorMessage(fieldQuery.error, { fallback: 'We could not load the players and their stats.' })}
            </Alert>
          ) : null}
          {saveMutation.isError ? (
            <Alert className="mt-3" data-testid="root-admin-stat-lines-save-error" tone="danger">
              {extractErrorMessage(saveMutation.error, { fallback: 'We could not save that line.' })}
            </Alert>
          ) : null}

          <div className="mt-4">
            <DataGrid
              columns={columns}
              data={rows}
              emptyMessage={fieldQuery.isLoading ? 'Loading players...' : 'No players in the field yet.'}
              getRowId={(row) => row.sportEventParticipantId}
              meta={meta}
              rowTestId={(row) => `root-admin-stat-lines-row-${row.sportEventParticipantId}`}
              tableTestId="root-admin-stat-lines-table"
            />
          </div>
        </Tile>
      ) : null}
    </div>
  );
}

import { PARTICIPANT_SCORING_DEFINITIONS } from '@poolmaster/shared/domain';
import { applyEventGolfRoundScores, previewEventGolfRoundScores } from '@/lib/api';
import { BulkUploadPanel, PanelCard, StatusBadge, UploadPreviewTable } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { GolfRoundScorePreviewResponse } from '@/lib/api';
import {
  GOLF_ROUND_SCORE_UPLOAD_HEADERS,
  formatGolfRoundStatus,
  parseGolfRoundScoreUpload,
  type GolfRoundScoreUploadRow,
} from './sport-admin-utils';

type PreviewRow = GolfRoundScorePreviewResponse['rows'][number];

const RESOLUTION_TONE: Record<PreviewRow['resolution'], 'active' | 'warning' | 'danger'> = {
  MATCHED: 'active',
  AMBIGUOUS: 'warning',
  UNRESOLVED: 'danger',
};

const CHANGE_TONE: Record<PreviewRow['change'], 'info' | 'success' | 'neutral' | 'warning'> = {
  CREATE: 'success',
  UPDATE: 'info',
  UNCHANGED: 'neutral',
  SKIPPED: 'warning',
};

const CHANGE_LABEL: Record<PreviewRow['change'], string> = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  UNCHANGED: 'UNCHANGED',
  SKIPPED: 'Not stored (no strokes)',
};

/**
 * One side of a preview row's change: strokes, to par and status. To par is shown because the
 * admin enters it separately from strokes, so a to-par-only correction must read as a
 * change. A row with no strokes shows a dash, never "null".
 */
function describeValues(values: PreviewRow['before']): string {
  if (!values) return '—';
  const strokes = values.strokes ?? '—';
  const toPar = PARTICIPANT_SCORING_DEFINITIONS.GOLF_RELATIVE_TO_PAR_TOTAL.format(values.scoreToPar);
  return `${strokes} (${toPar})·${formatGolfRoundStatus(values.status)}`;
}

function describeRow(row: PreviewRow['row']): string {
  return row.playerName ?? row.externalId ?? row.participantId ?? 'Unnamed row';
}

/**
 * plans/124 §6.3 Round scores section 1 — bulk paste / upload / preview / apply
 * for one round, built on the shared {@link BulkUploadPanel}.
 */
export function GolfRoundScoreUploadCard({
  eventId,
  round,
  fieldPlayers,
}: {
  eventId: string;
  round: number;
  fieldPlayers: Array<{ externalId?: string; playerName: string }>;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-scores-page',
  });

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfRoundScoreUploadRow[]) => {
      const response = await previewEventGolfRoundScores({
        path: { eventId, roundNumber: round },
        body: { rows },
      });
      if (!response.data?.rows) {
        throwApiError(response.error, 'Round-score preview response is missing data.');
      }
      return response.data.rows;
    },
    invalidates: [],
    onError: (error) => {
      logger.warn(
        { action: 'golf.roundScore.preview.failed', err: error },
        'Golf round-score preview was rejected',
      );
    },
  });

  const applyMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfRoundScoreUploadRow[]) => {
      const response = await applyEventGolfRoundScores({
        path: { eventId, roundNumber: round },
        body: { rows },
      });
      if (response.error) {
        throwApiError(response.error);
      }
      return response.data;
    },
    // Round scores are read from the field (#236).
    invalidates: [QueryKeys.rootAdmin.manageSport.field(eventId)],
    onError: (error) => {
      logger.warn(
        { action: 'golf.roundScore.apply.failed', err: error },
        'Golf round-score apply was rejected',
      );
    },
  });

  // Prefill the template with one row per field golfer (externalId and playerName
  // populated, score cells blank) so the admin only fills in numbers (plans/124
  // §6.3). #236: the field row embeds the participant, so its externalId is known.
  const templateRows =
    fieldPlayers.length > 0
      ? fieldPlayers.map((golfer) => [golfer.externalId ?? '', golfer.playerName, '', '', '', ''])
      : undefined;
  const templateSampleRow = ['ext-123', 'Rory McIlroy', 70, -2, 18, 'COMPLETED'];

  return (
    <PanelCard headingLevel={3} padded title="Bulk load">
      <p className="text-sm text-muted-foreground">
        Paste or upload this round&rsquo;s scores, preview how each row resolves and
        changes, then apply.
      </p>
      <div className="mt-4">
        {/* Remount the panel per round so a pasted/previewed batch can never be
            applied to a different round than it was validated against. */}
        <BulkUploadPanel<GolfRoundScoreUploadRow, PreviewRow>
          key={`${eventId}:${round}`}
          apply={(rows) => applyMutation.mutateAsync(rows).then(() => undefined)}
          applyError={
            applyMutation.isError
              ? extractErrorMessage(applyMutation.error, {
                  fallback: 'We could not apply these scores.',
                })
              : null
          }
          applyLabel="Apply scores"
          formatNote="Columns: externalId or playerName (one required), strokes, scoreToPar, thru (optional), status (IN_PROGRESS / COMPLETED / DNF / DSQ / MISSED_CUT). Rows left with no score are skipped."
          isApplyPending={applyMutation.isPending}
          isPreviewPending={previewMutation.isPending}
          parse={parseGolfRoundScoreUpload}
          preview={(rows) => previewMutation.mutateAsync(rows)}
          previewError={
            previewMutation.isError
              ? extractErrorMessage(previewMutation.error, {
                  fallback: 'We could not preview these scores.',
                })
              : null
          }
          renderPreview={(rows) => (
            <UploadPreviewTable
              change={{
                before: (entry) => describeValues(entry.before),
                after: (entry) => describeValues(entry.after),
                badge: (entry) => <StatusBadge tone={CHANGE_TONE[entry.change]}>{CHANGE_LABEL[entry.change]}</StatusBadge>,
              }}
              describeRow={(entry) => describeRow(entry.row)}
              match={(entry) => entry.participantName || '—'}
              matchHeader="Player"
              resolution={(entry) => <StatusBadge tone={RESOLUTION_TONE[entry.resolution]}>{entry.resolution}</StatusBadge>}
              rows={rows}
              testId="root-admin-golf-scores-upload-preview-table"
            />
          )}
          templateFilename={`golf-round-${round}-scores-template.csv`}
          templateHeaders={GOLF_ROUND_SCORE_UPLOAD_HEADERS}
          templateRows={templateRows}
          templateSampleRow={templateSampleRow}
          testId="root-admin-golf-scores-upload"
          unresolvedCount={(rows) =>
            rows.filter((row) => row.resolution !== 'MATCHED').length
          }
          unresolvedNotice={(count) =>
            `${count} row${count === 1 ? '' : 's'} could not be matched to a golfer in the field. Fix or remove ${
              count === 1 ? 'it' : 'them'
            } before applying.`
          }
        />
      </div>
    </PanelCard>
  );
}

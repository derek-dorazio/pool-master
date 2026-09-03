import {
  adminApplyGolfRoundScores,
  adminPreviewGolfRoundScores,
} from '@/lib/api';
import { BulkUploadPanel, StatusBadge, Tile } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminPreviewGolfRoundScoresResponses } from '@/lib/api';
import {
  GOLF_ROUND_SCORE_UPLOAD_HEADERS,
  formatGolfRoundStatus,
  parseGolfRoundScoreUpload,
  type GolfRoundScoreUploadRow,
} from './golf-admin-utils';

type PreviewRow = AdminPreviewGolfRoundScoresResponses[200]['rows'][number];

const RESOLUTION_TONE: Record<PreviewRow['resolution'], 'active' | 'warning' | 'danger'> = {
  MATCHED: 'active',
  AMBIGUOUS: 'warning',
  UNRESOLVED: 'danger',
};

const CHANGE_TONE: Record<PreviewRow['change'], 'info' | 'success' | 'neutral'> = {
  CREATE: 'success',
  UPDATE: 'info',
  UNCHANGED: 'neutral',
};

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
  fieldPlayers: Array<{ playerName: string }>;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-scores-page',
  });

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfRoundScoreUploadRow[]) => {
      const response = await adminPreviewGolfRoundScores({
        path: { eventId, round },
        body: { rows },
      });
      if (!response.data?.rows) {
        throw response.error ?? new Error('Round-score preview response is missing data.');
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
      const response = await adminApplyGolfRoundScores({
        path: { eventId, round },
        body: { rows },
      });
      if (response.error) {
        throw response.error;
      }
      return response.data;
    },
    invalidates: [QueryKeys.rootAdmin.golf.roundScores(eventId, round)],
    onError: (error) => {
      logger.warn(
        { action: 'golf.roundScore.apply.failed', err: error },
        'Golf round-score apply was rejected',
      );
    },
  });

  // Prefill the template with one row per field golfer (playerName populated,
  // score cells blank) so the admin only fills in numbers (plans/124 §6.3). The
  // field DTO carries no externalId, so playerName is the identifier used here.
  const templateRows =
    fieldPlayers.length > 0
      ? fieldPlayers.map((golfer) => ['', golfer.playerName, '', '', '', ''])
      : undefined;
  const templateSampleRow = ['ext-123', 'Rory McIlroy', 70, -2, 18, 'COMPLETED'];

  return (
    <Tile>
      <h3 className="text-base font-semibold text-foreground">Bulk load</h3>
      <p className="mt-1 text-sm text-muted-foreground">
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
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table
                className="min-w-full text-left text-sm"
                data-testid="root-admin-golf-scores-upload-preview-table"
              >
                <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Row</th>
                    <th className="px-4 py-2">Resolution</th>
                    <th className="px-4 py-2">Player</th>
                    <th className="px-4 py-2">Before → After</th>
                    <th className="px-4 py-2">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry, index) => (
                    <tr className="border-t border-border" key={`${describeRow(entry.row)}-${index}`}>
                      <td className="px-4 py-2">{describeRow(entry.row)}</td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={RESOLUTION_TONE[entry.resolution]}>
                          {entry.resolution}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-2">{entry.participantName || '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {entry.before.strokes}·{formatGolfRoundStatus(entry.before.status)} →{' '}
                        <span className="text-foreground">
                          {entry.after.strokes}·{formatGolfRoundStatus(entry.after.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={CHANGE_TONE[entry.change]}>
                          {entry.change}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
    </Tile>
  );
}

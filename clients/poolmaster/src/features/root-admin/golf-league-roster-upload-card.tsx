import {
  adminApplyGolfLeagueRosterUpload,
  adminPreviewGolfLeagueRosterUpload,
} from '@/lib/api';
import {
  BulkUploadPanel,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { AdminPreviewGolfLeagueRosterUploadResponses } from '@/lib/api';
import {
  GOLF_ROSTER_UPLOAD_HEADERS,
  parseGolfRosterUpload,
  type GolfRosterUploadRow,
} from './golf-admin-utils';

type RosterPreviewRow =
  AdminPreviewGolfLeagueRosterUploadResponses[200]['rows'][number];

const RESOLUTION_TONE: Record<RosterPreviewRow['resolution'], 'active' | 'warning' | 'danger'> = {
  MATCHED: 'active',
  AMBIGUOUS: 'warning',
  UNRESOLVED: 'danger',
};

function describeRow(row: RosterPreviewRow['row']): string {
  return (
    row.playerName ??
    row.externalId ??
    row.participantId ??
    'Unnamed row'
  );
}

/**
 * plans/124 §6.3 Tour Home — bulk paste / upload / preview / apply for the tour
 * roster's world rankings, built on the shared {@link BulkUploadPanel}. The
 * week-to-week ranking maintenance path; per-row edits live in the roster grid.
 */
export function GolfLeagueRosterUploadCard({ leagueId }: { leagueId: string }) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-league-home-page',
  });

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfRosterUploadRow[]) => {
      const response = await adminPreviewGolfLeagueRosterUpload({
        path: { leagueId },
        body: { rows },
      });
      if (!response.data?.rows) {
        throw response.error ?? new Error('Roster preview response is missing data.');
      }
      return response.data.rows;
    },
    invalidates: [],
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.roster.preview.failed', err: error },
        'Golf tour roster preview was rejected',
      );
    },
  });

  const applyMutation = useInvalidatingMutation({
    mutationFn: async (rows: GolfRosterUploadRow[]) => {
      const response = await adminApplyGolfLeagueRosterUpload({
        path: { leagueId },
        body: { rows },
      });
      if (!response.data?.entries) {
        throw response.error ?? new Error('Roster apply response is missing data.');
      }
      return response.data.entries;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.leagueRoster(leagueId),
      QueryKeys.rootAdmin.golf.tours,
    ],
    onError: (error) => {
      logger.warn(
        { action: 'golf.tour.roster.apply.failed', err: error },
        'Golf tour roster apply was rejected',
      );
    },
  });

  return (
    <Tile>
      <h3 className="text-base font-semibold text-foreground">
        Bulk-update world rankings
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste or upload the current rankings, preview how each row resolves to a
        golfer, then apply.
      </p>
      <div className="mt-4">
        <BulkUploadPanel<GolfRosterUploadRow, RosterPreviewRow>
          apply={(rows) => applyMutation.mutateAsync(rows).then(() => undefined)}
          applyError={
            applyMutation.isError
              ? extractErrorMessage(applyMutation.error, {
                  fallback: 'We could not apply this roster upload.',
                })
              : null
          }
          applyLabel="Apply rankings"
          formatNote="Columns: externalId or playerName (one is required), plus worldRanking."
          isApplyPending={applyMutation.isPending}
          isPreviewPending={previewMutation.isPending}
          parse={parseGolfRosterUpload}
          preview={(rows) => previewMutation.mutateAsync(rows)}
          previewError={
            previewMutation.isError
              ? extractErrorMessage(previewMutation.error, {
                  fallback: 'We could not preview this roster upload.',
                })
              : null
          }
          renderPreview={(rows) => (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table
                className="min-w-full text-left text-sm"
                data-testid="root-admin-golf-league-roster-upload-preview-table"
              >
                <thead className="bg-[var(--table-header-surface)] text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Row</th>
                    <th className="px-4 py-2">Resolution</th>
                    <th className="px-4 py-2">Golfer</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr className="border-t border-border" key={`${describeRow(row.row)}-${index}`}>
                      <td className="px-4 py-2">{describeRow(row.row)}</td>
                      <td className="px-4 py-2">
                        <StatusBadge tone={RESOLUTION_TONE[row.resolution]}>
                          {row.resolution}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-2">
                        {row.participantName || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          templateFilename="golf-tour-roster-template.csv"
          templateHeaders={GOLF_ROSTER_UPLOAD_HEADERS}
          templateSampleRow={['dj-2011', 'Dustin Johnson', 12]}
          testId="root-admin-golf-league-roster-upload"
          unresolvedCount={(rows) =>
            rows.filter((row) => row.resolution !== 'MATCHED').length
          }
          unresolvedNotice={(count) =>
            `${count} row${count === 1 ? '' : 's'} could not be matched to a golfer. Fix or remove ${
              count === 1 ? 'it' : 'them'
            } before applying.`
          }
        />
      </div>
    </Tile>
  );
}

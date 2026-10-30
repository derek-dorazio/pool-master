import {
  applyParticipantLeagueAffiliationUpload,
  previewParticipantLeagueAffiliationUpload,
} from '@/lib/api';
import { BulkUploadPanel, PanelCard, StatusBadge, UploadPreviewTable } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import type { ParticipantLeagueAffiliationUploadPreviewResponse } from '@/lib/api';
import { sportPathSegment } from '@poolmaster/shared/domain';
import {
  ROSTER_UPLOAD_HEADERS,
  parseRosterUpload,
  type RosterUploadRow,
} from './sport-admin-utils';
import { capitalize } from './manage-navigation';
import { useSportLeagueNoun } from './use-sport-catalog';
import { useManagedSport } from './use-managed-sport';

type RosterPreviewRow = ParticipantLeagueAffiliationUploadPreviewResponse['rows'][number];

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
 * A tour's page: bulk paste / upload / preview / apply for the tour
 * roster's rankings, built on the shared {@link BulkUploadPanel}. The
 * week-to-week ranking maintenance path; per-row edits live in the roster grid.
 */
export function SportLeagueRosterUploadCard({ leagueId }: { leagueId: string }) {
  const { sport, definition } = useManagedSport();
  const { participant } = definition.vocabulary;
  const sportLeague = useSportLeagueNoun(sport, leagueId);
  const logger = getLogger().child({
    feature: 'root-admin-sport-league-home-page',
  });

  const previewMutation = useInvalidatingMutation({
    mutationFn: async (rows: RosterUploadRow[]) => {
      const response = await previewParticipantLeagueAffiliationUpload({
        path: { sportLeagueId: leagueId },
        body: { rows },
      });
      if (!response.data?.rows) {
        throwApiError(response.error, 'Roster preview response is missing data.');
      }
      return response.data.rows;
    },
    invalidates: [],
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.roster.preview.failed', err: error },
        'Sport league roster preview was rejected',
      );
    },
  });

  const applyMutation = useInvalidatingMutation({
    mutationFn: async (rows: RosterUploadRow[]) => {
      const response = await applyParticipantLeagueAffiliationUpload({
        path: { sportLeagueId: leagueId },
        body: { rows },
      });
      if (!response.data?.affiliations) {
        throwApiError(response.error, 'Roster apply response is missing data.');
      }
      return response.data.affiliations;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.leagueRoster(leagueId),
      QueryKeys.rootAdmin.manageSport.leagues,
    ],
    onError: (error) => {
      logger.warn(
        { action: 'sportLeague.roster.apply.failed', err: error },
        'Sport league roster apply was rejected',
      );
    },
  });

  return (
    <PanelCard headingLevel={3} padded title="Bulk-update rankings">
      <p className="text-sm text-muted-foreground">
        {`Paste or upload the current rankings, preview how each row resolves to a ${participant.one}, then apply.`}
      </p>
      <BulkUploadPanel<RosterUploadRow, RosterPreviewRow>
        apply={(rows) => applyMutation.mutateAsync(rows).then(() => undefined)}
        applyError={
          applyMutation.isError
            ? extractErrorMessage(applyMutation.error, {
                fallback: 'We could not apply this roster upload.',
              })
            : null
        }
        applyLabel="Apply rankings"
        formatNote="Columns: externalId or playerName (one is required), plus ranking."
        isApplyPending={applyMutation.isPending}
        isPreviewPending={previewMutation.isPending}
        parse={parseRosterUpload}
        preview={(rows) => previewMutation.mutateAsync(rows)}
        previewError={
          previewMutation.isError
            ? extractErrorMessage(previewMutation.error, {
                fallback: 'We could not preview this roster upload.',
              })
            : null
        }
        renderPreview={(rows) => (
          <UploadPreviewTable
            describeRow={(row) => describeRow(row.row)}
            match={(row) => row.participantName || '—'}
            matchHeader={capitalize(participant.one)}
            resolution={(row) => <StatusBadge tone={RESOLUTION_TONE[row.resolution]}>{row.resolution}</StatusBadge>}
            rows={rows}
            testId="root-admin-sport-league-roster-upload-preview-table"
          />
        )}
        templateFilename={`${sportPathSegment(sport)}-${sportLeague.one}-roster-template.csv`}
        templateHeaders={ROSTER_UPLOAD_HEADERS}
        testId="root-admin-sport-league-roster-upload"
        unresolvedCount={(rows) =>
          rows.filter((row) => row.resolution !== 'MATCHED').length
        }
        unresolvedNotice={(count) =>
          `${count} row${count === 1 ? '' : 's'} could not be matched to a ${participant.one}. Fix or remove ${
            count === 1 ? 'it' : 'them'
          } before applying.`
        }
      />
    </PanelCard>
  );
}

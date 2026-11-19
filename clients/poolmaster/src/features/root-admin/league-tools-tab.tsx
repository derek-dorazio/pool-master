import { LinkButton, SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';
import { useLeaguePage } from './league-page-context';
import { buildSportPath } from './manage-navigation';
import { SportLeagueCalendarCard } from './sport-league-calendar-card';
import { SportLeagueRosterUploadCard } from './sport-league-roster-upload-card';

/**
 * The League page's Tools tab (#1866), on a league no provider syncs: the correction tools for
 * events and participants a sync would otherwise keep (rules/ux-rules.md §12 item 16). Its event
 * calendar adds, clones and imports events; Add participant adds one by hand; the upload sets
 * ranks from a file.
 */
export function LeagueToolsTab() {
  const { sportLeague } = useLeaguePage();
  return (
    <div className="space-y-6" data-testid="root-admin-league-tools-tab">
      <SportLeagueCalendarCard sportLeague={sportLeague} />
      <SectionCard testId="root-admin-league-add-participants" title="Add participants">
        <SectionRows>
          <SectionRow
            actions={(
              <LinkButton
                data-testid="root-admin-league-add-participant"
                size="sm"
                to={`${buildSportPath(sportLeague.sport)}/participants/new?sportLeague=${sportLeague.id}`}
                variant="secondary"
              >
                Add participant
              </LinkButton>
            )}
            name="Add a participant"
          />
        </SectionRows>
      </SectionCard>
      <SportLeagueRosterUploadCard leagueId={sportLeague.id} />
    </div>
  );
}

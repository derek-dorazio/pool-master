import type { SportEventDto } from '@/lib/api';
import {
  LinkButton,
  SettingsRow,
  SettingsSection,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { buildGolfTournamentPath } from './manage-navigation';

/**
 * The tournament's properties as labelled rows, with one Edit for all of them
 * (rules/ux-rules.md §12 rules 5 and 6). The tour and event year are fixed at creation.
 */
export function GolfTournamentDetailsSection({
  tourName,
  tournament,
}: {
  tourName: string | undefined;
  tournament: SportEventDto;
}) {
  return (
    <SettingsSection
      action={(
        <LinkButton
          data-testid="root-admin-golf-tournament-home-edit"
          size="sm"
          to={`${buildGolfTournamentPath(tournament.id)}/edit`}
          variant="secondary"
        >
          Edit
        </LinkButton>
      )}
      testId="root-admin-golf-tournament-details"
      title="Details"
    >
      <SettingsRow label="Venue" value={tournament.venue || 'Not set'} />
      <SettingsRow label="Location" value={tournament.location || 'Not set'} />
      <SettingsRow label="Starts" value={formatDateTimeDisplay(tournament.startDate)} />
      <SettingsRow label="Ends" value={formatDateTimeDisplay(tournament.endDate)} />
      <SettingsRow label="Rounds" value={tournament.rounds ?? 'Not set'} />
      <SettingsRow label="Par per round" value={tournament.roundsPar ?? 'From scores'} />
      <SettingsRow
        label="Tour"
        value={(
          <LinkButton
            data-testid="root-admin-golf-tournament-home-tour-link"
            size="sm"
            to={`/manage/golf/leagues/${tournament.sportLeagueId}`}
            variant="ghost"
          >
            {tourName ?? 'Open tour'}
          </LinkButton>
        )}
      />
      <SettingsRow label="Event year" value={tournament.eventYear} />
    </SettingsSection>
  );
}

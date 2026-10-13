import { getSportDefinition } from '@poolmaster/shared/domain';
import type { SportEventDto } from '@/lib/api';
import {
  LinkButton,
  SettingsRow,
  SettingsSection,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { buildSportEventPath, buildSportLeaguePath, capitalize } from './manage-navigation';
import { getScoringFamilyAdminUi } from './scoring-family-admin';

/**
 * The event's properties as labelled rows, with one Edit for all of them
 * (rules/ux-rules.md §12 rules 5 and 6). The sport league and event year are fixed at creation.
 * Par per round shows only for a family that scores unplayed rounds against it.
 */
export function GolfTournamentDetailsSection({
  tourName,
  tournament,
}: {
  tourName: string | undefined;
  tournament: SportEventDto;
}) {
  const { vocabulary } = getSportDefinition(tournament.sport);
  const { scoresUnplayedRoundsAgainstPar } = getScoringFamilyAdminUi(tournament.sport);
  return (
    <SettingsSection
      action={(
        <LinkButton
          data-testid="root-admin-golf-tournament-home-edit"
          size="sm"
          to={`${buildSportEventPath(tournament.sport, tournament.id)}/edit`}
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
      <SettingsRow label={capitalize(vocabulary.round.many)} value={tournament.rounds ?? 'Not set'} />
      {scoresUnplayedRoundsAgainstPar ? (
        <SettingsRow label="Par per round" value={tournament.roundsPar ?? 'From scores'} />
      ) : null}
      <SettingsRow
        label={capitalize(vocabulary.sportLeague.one)}
        value={(
          <LinkButton
            data-testid="root-admin-golf-tournament-home-tour-link"
            size="sm"
            to={buildSportLeaguePath(tournament.sport, tournament.sportLeagueId)}
            variant="ghost"
          >
            {tourName ?? `Open ${vocabulary.sportLeague.one}`}
          </LinkButton>
        )}
      />
      <SettingsRow label="Event year" value={tournament.eventYear} />
    </SettingsSection>
  );
}

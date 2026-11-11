import { getSportDefinition } from '@poolmaster/shared/domain';
import type { SportEventDto } from '@/lib/api';
import {
  formatDateTimeDisplay,
  LinkButton,
  SectionCard,
  SettingsRow,
  SettingsRows,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { buildSportEventPath, buildSportLeaguePath } from './manage-navigation';
import { getScoringFamilyAdminUi } from './scoring-family-admin';
import { useSportLeagueNoun } from './use-sport-catalog';
import { upperFirst } from '@/lib/upper-first';

/**
 * The event's properties as labelled rows, with one Edit for all of them
 * (rules/ux-rules.md §12 rules 5 and 6). The sport league and event year are fixed at creation.
 * Par per round shows only for a family that scores unplayed rounds against it.
 */
export function SportEventDetailsSection({
  sportLeagueName,
  tournament,
}: {
  sportLeagueName: string | undefined;
  tournament: SportEventDto;
}) {
  const displayPreferences = useDisplayPreferences();
  const { vocabulary } = getSportDefinition(tournament.sport);
  const sportLeagueNoun = useSportLeagueNoun(tournament.sport, tournament.sportLeagueId);
  const { scoresUnplayedRoundsAgainstPar } = getScoringFamilyAdminUi(tournament);
  return (
    <SectionCard
      trailing={(
        <LinkButton
          data-testid="root-admin-sport-event-home-edit"
          size="sm"
          to={`${buildSportEventPath(tournament.sport, tournament.id)}/edit`}
          variant="secondary"
        >
          Edit
        </LinkButton>
      )}
      testId="root-admin-sport-event-details"
      title="Details"
    >
      <SettingsRows>
        <SettingsRow label="Venue" value={tournament.venue || 'Not set'} />
        <SettingsRow label="Location" value={tournament.location || 'Not set'} />
        <SettingsRow label="Starts" value={formatDateTimeDisplay(tournament.startDate, displayPreferences)} />
        <SettingsRow label="Ends" value={formatDateTimeDisplay(tournament.endDate, displayPreferences)} />
        <SettingsRow label={upperFirst(vocabulary.round.many)} value={tournament.rounds ?? 'Not set'} />
        {scoresUnplayedRoundsAgainstPar ? (
          <SettingsRow label="Par per round" value={tournament.roundsPar ?? 'From scores'} />
        ) : null}
        <SettingsRow
          label={upperFirst(sportLeagueNoun.one)}
          value={(
            <LinkButton
              data-testid="root-admin-sport-event-home-tour-link"
              size="sm"
              to={buildSportLeaguePath(tournament.sport, tournament.sportLeagueId)}
              variant="ghost"
            >
              {sportLeagueName ?? `Open ${sportLeagueNoun.one}`}
            </LinkButton>
          )}
        />
        <SettingsRow label="Event year" value={tournament.eventYear} />
      </SettingsRows>
    </SectionCard>
  );
}

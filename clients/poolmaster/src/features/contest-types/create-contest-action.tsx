import { Link } from 'react-router';
import type { ContestConfigTemplateDto, LeagueDto } from '@/lib/api';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemText,
  DropdownMenuLabel,
  DropdownMenuTriggerSlot,
  LinkButton,
  Text,
} from '@/features/shared/ui';
import { buildLeagueAdminContestCreateFromTemplatePath } from '@/features/leagues/league-routing';

const CREATE_IN = 'Create contest in';

/**
 * Create contest on a way to play's template (#1104), for a viewer who runs a league: one league
 * opens straight on it, several are each a choice. Nothing for anyone else. `layout="inline"` is
 * the opened tile's action, "Create contest" or a button per league; `"compact"` is the closed
 * tile's "+ Create" (#1701), named "Create a {type} contest", opening a menu of leagues when there
 * are several.
 */
export function CreateContestAction({ layout = 'inline', leagues, template, testId, typeName }: {
  layout?: 'compact' | 'inline';
  leagues: readonly LeagueDto[];
  template: ContestConfigTemplateDto | undefined;
  testId: string;
  /** The way to play, for the compact button's name: "Tiered", "Clutch Card". */
  typeName: string;
}) {
  if (!template || leagues.length === 0) {
    return null;
  }
  const pathIn = (league: LeagueDto) => buildLeagueAdminContestCreateFromTemplatePath(league.leagueCode, template.id);
  if (layout === 'compact') {
    const name = `Create a ${typeName} contest`;
    if (leagues.length === 1) {
      return <LinkButton aria-label={name} data-testid={`${testId}-quick-create`} size="sm" to={pathIn(leagues[0])}>+ Create</LinkButton>;
    }
    return (
      <DropdownMenu>
        <DropdownMenuTriggerSlot>
          <Button aria-label={name} data-testid={`${testId}-quick-create`} size="sm">+ Create</Button>
        </DropdownMenuTriggerSlot>
        <DropdownMenuContent align="end" testId={`${testId}-quick-create-menu`} width="md">
          <DropdownMenuLabel>{CREATE_IN}</DropdownMenuLabel>
          {leagues.map((league) => (
            <DropdownMenuItem asChild key={league.id}>
              <Link data-testid={`${testId}-quick-create-${league.leagueCode}`} to={pathIn(league)}>
                <DropdownMenuItemText name={league.name} />
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (leagues.length === 1) {
    return (
      <LinkButton data-testid={`${testId}-create`} size="sm" to={pathIn(leagues[0])}>
        Create contest
      </LinkButton>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-create`}>
      <Text size="inherit" tone="muted">{CREATE_IN}</Text>
      {leagues.map((league) => (
        <LinkButton
          data-testid={`${testId}-create-${league.leagueCode}`}
          key={league.id}
          size="sm"
          to={pathIn(league)}
          variant="secondary"
        >
          {league.name}
        </LinkButton>
      ))}
    </div>
  );
}

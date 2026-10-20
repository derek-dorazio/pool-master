import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { Sport } from '@poolmaster/shared/domain';
import { listSportLeagues, type ContestConfigTemplateDto, type SportEventDto } from '@/lib/api';
import { useLeagueContextGuard } from '@/features/leagues/league-context-guard';
import {
  buildLeagueAdminContestCreateFromTemplatePath,
} from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { contestEventsForTemplate } from '@/features/contests/contest-template-events';
import { sportEventsQueryOptions } from '@/features/contests/sport-events-query';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import { ErrorState, LoadingState, PageHeader, SectionHeader } from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { buildLeagueContestCatalog } from './contest-catalog';
import { ContestTypeTileCard } from './contest-type-tile';
import { SPORT_BLURBS } from './sport-blurbs';

/**
 * Contest types (#803): every contest the league could run, grouped by sport and sport league,
 * read from the contest templates. A commissioner of an active league gets a "Create this
 * contest" link on each, opening Create contest on that template; every other member sees the
 * same menu without them.
 */
export function LeagueContestTypesPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'league-contest-types-page' }), []);
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const canCreate = viewer.isCommissioner && league?.isActive === true;

  const templatesQuery = useActiveContestTemplatesQuery();
  const sportLeaguesQuery = useQuery({
    queryKey: QueryKeys.sportLeagues.list(),
    queryFn: async () => {
      const response = await listSportLeagues();
      if (!response.data?.sportLeagues) {
        throwApiError(response.error, 'Sport league list response is missing data.');
      }
      return response.data.sportLeagues;
    },
    retry: false,
  });
  const catalog = useMemo(() => buildLeagueContestCatalog(
    templatesQuery.data ?? [],
    new Map((sportLeaguesQuery.data ?? []).map((sportLeague) => [sportLeague.id, sportLeague.name])),
  ), [sportLeaguesQuery.data, templatesQuery.data]);

  // A commissioner's create links need each sport's events: a contest type with none coming up
  // says so instead of linking.
  const sports = useMemo(() => catalog.map(({ sport }) => sport), [catalog]);
  const eventQueries = useQueries({ queries: sports.map((sport) => sportEventsQueryOptions(sport, canCreate)) });
  const eventsBySport = new Map<Sport, SportEventDto[] | undefined>(sports.map((sport, index) => [sport, eventQueries[index]?.data]));

  const isError = templatesQuery.isError || sportLeaguesQuery.isError;
  useEffect(() => {
    if (isError) {
      logger.warn({ action: 'contestTypes.load.failed', data: { leagueCode } }, 'Contest types page failed to load the contest types');
    }
  }, [isError, leagueCode, logger]);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading contest types...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  // While a sport's events load, its links stand; once they arrive, a type with no event says so.
  const createPathFor = canCreate
    ? (template: ContestConfigTemplateDto) => {
      const events = eventsBySport.get(template.sport);
      return events === undefined || contestEventsForTemplate(events, template).length
        ? buildLeagueAdminContestCreateFromTemplatePath(league.leagueCode, template.id)
        : null;
    }
    : undefined;

  return (
    <section className="space-y-8" data-testid="league-contest-types-page">
      <PageHeader
        description={canCreate
          ? `Every contest you can run in ${league.name}. Pick one to start setting it up.`
          : `Every contest ${league.name} can run. Ask your commissioner for the ones you'd like to play.`}
        title="Contest types"
      />

      {templatesQuery.isLoading || sportLeaguesQuery.isLoading ? (
        <LoadingState body="Loading contest types..." />
      ) : isError ? (
        <ErrorState body="We couldn't load the contest types." title="Contest types unavailable" />
      ) : (
        <div className="space-y-10">
          {catalog.map((sport) => (
            <section className="space-y-5" data-testid={`contest-types-sport-${sport.sport}`} key={sport.sport}>
              <SectionHeader description={SPORT_BLURBS[sport.sport]} title={sport.name} />
              {sport.groups.map((group) => (
                <div className="space-y-3" key={group.sportLeagueId ?? 'every-event'}>
                  <h4 className="text-sm font-semibold uppercase text-muted-foreground">{group.name}</h4>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {group.tiles.map((tile) => <ContestTypeTileCard createPathFor={createPathFor} key={tile.key} tile={tile} />)}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

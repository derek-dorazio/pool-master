import { SPORTS_BY_POPULARITY, SUPPORTED_SPORTS, getSportDefinition, sportLeagueDefinitionOf, type SelectionType, type Sport, type SportDefinition } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, SportLeagueDto } from '@/lib/api';

/**
 * One contest type on the contest types pages (#803): a format as one sport league offers it, on
 * one kind of event. It leads with its default template and lists the league's other templates of
 * that format as variations.
 */
export interface ContestTypeTile {
  key: string;
  selectionType: SelectionType;
  /**
   * Whether another tile of its section has the same format on another kind of event (the NFL's
   * weekly and playoff Survivor), so the tile names its kind of event beside its format.
   */
  sharesFormat?: boolean;
  featured: ContestConfigTemplateDto;
  variations: ContestConfigTemplateDto[];
}

/** A sport league's contest types on Contest types: its own templates and its sport's every-event ones. */
export interface ContestCatalogLeague {
  sportLeagueId: string;
  /** What the page calls it, as How to Play does: "NCAA Men's Hockey", not "NCAA Division I Men". */
  name: string;
  /** Its name in the page's link: `?sport=golf&league=pga-tour`. */
  slug: string;
  /** The season league it is a playoff round of (#1701), or null. */
  parentSportLeagueId: string | null;
  tiles: ContestTypeTile[];
}

export interface ContestCatalogSport<Group> {
  sport: Sport;
  name: string;
  groups: Group[];
}

/** The default first, then by sort order, then by key, so a page reads the same on every load. */
function byFeaturedOrder(left: ContestConfigTemplateDto, right: ContestConfigTemplateDto) {
  return Number(right.isDefault) - Number(left.isDefault)
    || left.sortOrder - right.sortOrder
    || left.templateKey.localeCompare(right.templateKey);
}

function groupBy<Item>(items: readonly Item[], keyOf: (item: Item) => string) {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

/**
 * One tile per format and kind of event, in the sport's format order, each led by the default of
 * the templates `preferred` puts first, the format's other templates as its variations. `key`
 * names the sport league, so a sport-wide type under two leagues is two tiles.
 */
function toTiles(
  key: string,
  templates: readonly ContestConfigTemplateDto[],
  selectionTypes: readonly SelectionType[],
  preferred: (template: ContestConfigTemplateDto) => boolean,
): ContestTypeTile[] {
  return groupBy(templates, (template) => `${template.eventType ?? 'any'}/${template.selectionType}`)
    .map((group) => {
      const [featured, ...variations] = [...group].sort((left, right) => Number(preferred(right)) - Number(preferred(left)) || byFeaturedOrder(left, right)) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
      return {
        key: `${key}/${featured.eventType ?? 'any'}/${featured.selectionType}`,
        selectionType: featured.selectionType,
        featured,
        variations,
      };
    })
    .sort((left, right) => selectionTypes.indexOf(left.selectionType) - selectionTypes.indexOf(right.selectionType)
      || byFeaturedOrder(left.featured, right.featured))
    .map((tile, _index, tiles) => ({ ...tile, sharesFormat: tiles.some((other) => other !== tile && other.selectionType === tile.selectionType) }));
}

/** How many contest types sport league sections list together: the number beside a sport on Contest types. */
export function contestTypeCount(leagues: readonly Pick<ContestCatalogLeague, 'tiles'>[]) {
  return leagues.reduce((count, league) => count + league.tiles.length, 0);
}

/**
 * The league contest types page's catalog (#1716): each sport in the platform's order, a section
 * for each of its active sport leagues in display order, listing every contest type a contest in
 * that league can be created from: its own templates and its sport's every-event ones, one tile
 * per format and kind of event, its own leading. A contest is always created in a sport league,
 * so there is no section for every event. A sport league with none is left out, as is a sport
 * with no sport league.
 */
export function buildLeagueContestCatalog(
  templates: readonly ContestConfigTemplateDto[],
  sportLeagues: readonly SportLeagueDto[],
): ContestCatalogSport<ContestCatalogLeague>[] {
  return SUPPORTED_SPORTS.flatMap((sport) => {
    const sportTemplates = templates.filter((template) => template.sport === sport);
    const groups = activeSportLeaguesOf(sport, sportLeagues)
      .map((sportLeague) => {
        const definition = sportLeagueDefinitionOf(sport, sportLeague);
        return {
          sportLeagueId: sportLeague.id,
          name: sportLeague.displayName ?? sportLeague.name,
          slug: catalogSlug(sportLeague.name),
          parentSportLeagueId: sportLeague.parentSportLeagueId,
          tiles: toTiles(sportLeague.id, offeredIn(sportLeague, definition, sportTemplates), definition.selectionTypes, ownedBy(sportLeague)),
        };
      })
      .filter((league) => league.tiles.length > 0);
    return groups.length ? [{ sport, name: getSportDefinition(sport).name, groups }] : [];
  });
}

/** A sport league on the public How to Play page: the formats it offers, its own and its sport's. */
export interface PublicCatalogLeague {
  sportLeagueId: string;
  /** What the page calls it beside other sports' leagues: "NCAA Men's Basketball", not "NCAA Division I Men". */
  name: string;
  /** Its name in the page's link: `?sport=basketball&league=wnba`. */
  slug: string;
  /** The season league it is a playoff round of (#1701: the NHL for the Stanley Cup Final), or null. */
  parentSportLeagueId: string | null;
  /** What it plays: its sport's definition, or a stat pool's for a championship stat pool league (#936). */
  definition: SportDefinition;
  groups: ContestTypeTile[];
}

export interface PublicCatalogSport extends ContestCatalogSport<ContestTypeTile> {
  leagues: PublicCatalogLeague[];
}

/** A name as the page's link spells it: `NCAA Division I Men` is `ncaa-division-i-men`, `Copa América` is `copa-america`. */
export function catalogSlug(name: string) {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * One tile per format, in the sport's format order, each led by the default of the templates
 * `preferred` puts first, with no variations.
 */
function toFormatTiles(
  key: string,
  templates: readonly ContestConfigTemplateDto[],
  selectionTypes: readonly SelectionType[],
  preferred: (template: ContestConfigTemplateDto) => boolean,
): ContestTypeTile[] {
  return groupBy(templates, (template) => template.selectionType)
    .map((group) => {
      const [featured] = [...group].sort((left, right) => Number(preferred(right)) - Number(preferred(left)) || byFeaturedOrder(left, right)) as [ContestConfigTemplateDto, ...ContestConfigTemplateDto[]];
      return { key: `${key}/${featured.selectionType}`, selectionType: featured.selectionType, featured, variations: [] };
    })
    .sort((left, right) => selectionTypes.indexOf(left.selectionType) - selectionTypes.indexOf(right.selectionType));
}

/** Sport leagues in their display order, the NFL before the College Football Playoff; unordered ones after, by name. */
function bySportLeagueDisplayOrder(left: SportLeagueDto, right: SportLeagueDto) {
  return (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER)
    || (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name);
}

/** A sport's active sport leagues, in display order. */
function activeSportLeaguesOf(sport: Sport, sportLeagues: readonly SportLeagueDto[]) {
  return sportLeagues
    .filter((sportLeague) => sportLeague.sport === sport && sportLeague.isActive)
    .sort(bySportLeagueDisplayOrder);
}

/**
 * The templates a contest in a sport league can be created from: its own and its sport's
 * every-event ones, in the formats it plays (a World Series stat pool takes none of baseball's brackets).
 */
function offeredIn(sportLeague: SportLeagueDto, definition: SportDefinition, sportTemplates: readonly ContestConfigTemplateDto[]) {
  return sportTemplates.filter((template) => (template.sportLeagueId === null || template.sportLeagueId === sportLeague.id)
    && definition.selectionTypes.includes(template.selectionType));
}

/** Whether a template is the sport league's own, which leads its format over the sport's. */
function ownedBy(sportLeague: SportLeagueDto) {
  return (template: ContestConfigTemplateDto) => template.sportLeagueId === sportLeague.id;
}

/**
 * The public How to Play page's catalog: each sport, the most popular first, with its formats,
 * one tile each, led by the format's default of the first sport league to offer it; then each of
 * its active sport leagues in display order, with the formats it offers, its own templates leading
 * its sport's, and the definition it plays (a stat pool's for the World Series). A sport league that offers none is left out, as is a sport with no templates.
 */
export function buildPublicContestCatalog(
  templates: readonly ContestConfigTemplateDto[],
  sportLeagues: readonly SportLeagueDto[],
): PublicCatalogSport[] {
  return SPORTS_BY_POPULARITY.flatMap((sport) => {
    const definition = getSportDefinition(sport);
    const sportTemplates = templates.filter((template) => template.sport === sport);
    const groups = toFormatTiles(sport, sportTemplates, definition.selectionTypes, () => false);
    const leagues = activeSportLeaguesOf(sport, sportLeagues)
      .map((sportLeague) => {
        const leagueDefinition = sportLeagueDefinitionOf(sport, sportLeague);
        return {
          sportLeagueId: sportLeague.id,
          name: sportLeague.displayName ?? sportLeague.name,
          slug: catalogSlug(sportLeague.name),
          parentSportLeagueId: sportLeague.parentSportLeagueId,
          definition: leagueDefinition,
          groups: toFormatTiles(
            `${sport}/${sportLeague.id}`,
            offeredIn(sportLeague, leagueDefinition, sportTemplates),
            leagueDefinition.selectionTypes,
            ownedBy(sportLeague),
          ),
        };
      })
      .filter((league) => league.groups.length > 0);
    return groups.length ? [{ sport, name: definition.name, groups, leagues }] : [];
  });
}

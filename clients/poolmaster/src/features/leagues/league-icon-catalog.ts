import type { LeagueIconKey } from '@poolmaster/shared/domain';
import { LeagueIconKey as LeagueIconKeyEnum } from '@poolmaster/shared/domain';

export const leagueIconSpriteHref = new URL(
  '../../assets/images/league-icons.svg',
  import.meta.url,
).href;

export const LEAGUE_ICON_OPTIONS: Array<{
  key: LeagueIconKey;
  label: string;
  symbolId: string;
}> = [
  { key: LeagueIconKeyEnum.GOLF_FLAG, label: 'Golf Flag', symbolId: 'league-icon-golf-flag' },
  { key: LeagueIconKeyEnum.GOLF_BALL, label: 'Golf Ball', symbolId: 'league-icon-golf-ball' },
  { key: LeagueIconKeyEnum.FOOTBALL, label: 'Football', symbolId: 'league-icon-football' },
  { key: LeagueIconKeyEnum.FOOTBALL_HELMET, label: 'Football Helmet', symbolId: 'league-icon-football-helmet' },
  { key: LeagueIconKeyEnum.BASKETBALL, label: 'Basketball', symbolId: 'league-icon-basketball' },
  { key: LeagueIconKeyEnum.BASKETBALL_HOOP, label: 'Basketball Hoop', symbolId: 'league-icon-basketball-hoop' },
  { key: LeagueIconKeyEnum.CHECKERED_FLAG, label: 'Checkered Flag', symbolId: 'league-icon-checkered-flag' },
  { key: LeagueIconKeyEnum.RACING_WHEEL, label: 'Racing Wheel', symbolId: 'league-icon-racing-wheel' },
  { key: LeagueIconKeyEnum.TENNIS_BALL, label: 'Tennis Ball', symbolId: 'league-icon-tennis-ball' },
  { key: LeagueIconKeyEnum.TENNIS_RACKET, label: 'Tennis Racket', symbolId: 'league-icon-tennis-racket' },
  { key: LeagueIconKeyEnum.HORSESHOE, label: 'Horseshoe', symbolId: 'league-icon-horseshoe' },
  { key: LeagueIconKeyEnum.SOCCER_BALL, label: 'Soccer Ball', symbolId: 'league-icon-soccer-ball' },
  { key: LeagueIconKeyEnum.HOCKEY_STICK, label: 'Hockey Stick', symbolId: 'league-icon-hockey-stick' },
  { key: LeagueIconKeyEnum.HOCKEY_PUCK, label: 'Hockey Puck', symbolId: 'league-icon-hockey-puck' },
  { key: LeagueIconKeyEnum.BASEBALL, label: 'Baseball', symbolId: 'league-icon-baseball' },
  { key: LeagueIconKeyEnum.BASEBALL_BAT, label: 'Baseball Bat', symbolId: 'league-icon-baseball-bat' },
  { key: LeagueIconKeyEnum.FIGHT_GLOVE, label: 'Fight Glove', symbolId: 'league-icon-fight-glove' },
  { key: LeagueIconKeyEnum.TROPHY, label: 'Trophy', symbolId: 'league-icon-trophy' },
  { key: LeagueIconKeyEnum.WHISTLE, label: 'Whistle', symbolId: 'league-icon-whistle' },
  { key: LeagueIconKeyEnum.STOPWATCH, label: 'Stopwatch', symbolId: 'league-icon-stopwatch' },
];

const leagueIconByKey = new Map(LEAGUE_ICON_OPTIONS.map((icon) => [icon.key, icon]));

export function getLeagueIconOption(iconKey: LeagueIconKey | undefined) {
  return iconKey ? leagueIconByKey.get(iconKey) ?? leagueIconByKey.get(LeagueIconKeyEnum.TROPHY)! : leagueIconByKey.get(LeagueIconKeyEnum.TROPHY)!;
}

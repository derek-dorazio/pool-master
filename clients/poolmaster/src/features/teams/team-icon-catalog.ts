import type { TeamIconKey } from '@poolmaster/shared/domain';
import { TeamIconKey as TeamIconKeyEnum } from '@poolmaster/shared/domain';

export const teamIconSpriteHref = new URL(
  '../../assets/images/team-icons.svg',
  import.meta.url,
).href;

const TEAM_ICON_BASES = [
  { key: 'CAPTAIN_SMILE', label: 'Captain Smile', symbolId: 'team-icon-captain-smile' },
  { key: 'CAPTAIN_WINK', label: 'Captain Wink', symbolId: 'team-icon-captain-wink' },
  { key: 'CHAMPION_BEARD', label: 'Champion Beard', symbolId: 'team-icon-champion-beard' },
  { key: 'MAVERICK_MASK', label: 'Maverick Mask', symbolId: 'team-icon-maverick-mask' },
  { key: 'STARFACE', label: 'Starface', symbolId: 'team-icon-starface' },
  { key: 'HELMET_STRIPE', label: 'Helmet Stripe', symbolId: 'team-icon-helmet-stripe' },
  { key: 'HELMET_BOLT', label: 'Helmet Bolt', symbolId: 'team-icon-helmet-bolt' },
  { key: 'HELMET_HORN', label: 'Helmet Horn', symbolId: 'team-icon-helmet-horn' },
  { key: 'HELMET_WING', label: 'Helmet Wing', symbolId: 'team-icon-helmet-wing' },
  { key: 'HELMET_GRID', label: 'Helmet Grid', symbolId: 'team-icon-helmet-grid' },
  { key: 'GOLF_BAG', label: 'Golf Bag', symbolId: 'team-icon-golf-bag' },
  { key: 'WHISTLE_BADGE', label: 'Whistle Badge', symbolId: 'team-icon-whistle-badge' },
  { key: 'STOPWATCH_BADGE', label: 'Stopwatch Badge', symbolId: 'team-icon-stopwatch-badge' },
  { key: 'MEGAPHONE', label: 'Megaphone', symbolId: 'team-icon-megaphone' },
  { key: 'FOAM_FINGER', label: 'Foam Finger', symbolId: 'team-icon-foam-finger' },
  { key: 'BULL_HEAD', label: 'Bull Head', symbolId: 'team-icon-bull-head' },
  { key: 'LUCKY_DUCK', label: 'Lucky Duck', symbolId: 'team-icon-lucky-duck' },
  { key: 'TURBO_TURTLE', label: 'Turbo Turtle', symbolId: 'team-icon-turbo-turtle' },
  { key: 'FIRE_PIZZA', label: 'Fire Pizza', symbolId: 'team-icon-fire-pizza' },
  { key: 'BANANA_BAT', label: 'Banana Bat', symbolId: 'team-icon-banana-bat' },
] as const;

const TEAM_ICON_THEMES = [
  {
    key: 'SUNSET',
    label: 'Sunset',
    themeClass: 'team-icon-theme-sunset',
  },
  {
    key: 'FIELD',
    label: 'Field',
    themeClass: 'team-icon-theme-field',
  },
  {
    key: 'OCEAN',
    label: 'Ocean',
    themeClass: 'team-icon-theme-ocean',
  },
  {
    key: 'MIDNIGHT',
    label: 'Midnight',
    themeClass: 'team-icon-theme-midnight',
  },
  {
    key: 'CANDY',
    label: 'Candy',
    themeClass: 'team-icon-theme-candy',
  },
] as const;

export const TEAM_ICON_OPTIONS: Array<{
  key: TeamIconKey;
  label: string;
  symbolId: string;
  themeClass: string;
}> = TEAM_ICON_BASES.flatMap((base) =>
  TEAM_ICON_THEMES.map((theme) => ({
    key: TeamIconKeyEnum[`${base.key}_${theme.key}` as keyof typeof TeamIconKeyEnum],
    label: `${base.label} ${theme.label}`,
    symbolId: base.symbolId,
    themeClass: theme.themeClass,
  })),
);

const teamIconByKey = new Map(TEAM_ICON_OPTIONS.map((icon) => [icon.key, icon]));

export function getTeamIconOption(iconKey: TeamIconKey | undefined) {
  return iconKey
    ? teamIconByKey.get(iconKey) ?? teamIconByKey.get(TeamIconKeyEnum.CAPTAIN_SMILE_FIELD)!
    : teamIconByKey.get(TeamIconKeyEnum.CAPTAIN_SMILE_FIELD)!;
}

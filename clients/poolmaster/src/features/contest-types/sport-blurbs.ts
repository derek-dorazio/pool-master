import type { Sport } from '@poolmaster/shared/domain';
import { STAT_POOL_CONTEST_TYPE } from '@/features/contests/scoring-family-ui/stat-pool-copy';

/**
 * Each sport's one line on the How to Play page (#803): what its pools are like. A `Record` over
 * the sports, so a new sport gains its line with its definition.
 */
export const SPORT_BLURBS: Record<Sport, string> = {
  GOLF: 'Pick golfers for a tournament and count their best scores, from one event to a season of majors.',
  HORSE_RACING: 'Back horses in the big races, from a sweep on the Derby to a stable bought under a salary cap.',
  AUTO_RACING: 'Formula 1, NASCAR and IndyCar: pick drivers and score the points they finish in.',
  CYCLING: 'Pick riders for the WorldTour\'s races and score where they finish.',
  RUNNING: 'Pick runners for the World Marathon Majors and score where they finish.',
  BASKETBALL: `March Madness and playoff brackets, survivor pools, and squares on the big games. A ${STAT_POOL_CONTEST_TYPE} on the NBA's conference finals or Finals, or the men's Final Four's semifinals and title game: pick stars and score their points, rebounds and assists each game.`,
  AMERICAN_FOOTBALL: `Weekly pick'em and survivor, playoff brackets, and squares on the big game. A ${STAT_POOL_CONTEST_TYPE} on Championship Weekend, the Super Bowl or the College Football Playoff's semifinals and title game: pick stars and score their touchdowns, yards and catches.`,
  HOCKEY: `NHL, PWHL and college playoff brackets, survivor pools, and squares on the big games. A Stanley Cup Final ${STAT_POOL_CONTEST_TYPE}: pick stars and score their goals, assists and shots each game.`,
  BASEBALL: `MLB postseason brackets and survivor pools, from the Wild Card round to the World Series. A World Series ${STAT_POOL_CONTEST_TYPE}: pick stars and score their total bases, runs, RBI, walks and steals each game.`,
  SOCCER: 'World Cup, Euros, Copa América, Champions League, MLS, NWSL and college playoffs: brackets, tiered and budget picks, sweepstakes, survivor, and squares on the big games. Premier League weeks: pick\'em with draw picks, and Last Man Standing survivor. Group matchdays: pick\'em with draw picks.',
  TENNIS: 'The four Grand Slams and the NCAA singles championships, men\'s and women\'s draws: tiered and budget picks, full-draw brackets, sweepstakes and survivor.',
};

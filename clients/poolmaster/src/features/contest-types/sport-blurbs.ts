import type { Sport } from '@poolmaster/shared/domain';

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
  BASKETBALL: 'March Madness and playoff brackets, survivor pools, and squares on the big games.',
  AMERICAN_FOOTBALL: 'Weekly pick\'em and survivor, playoff brackets, and squares on the big game.',
  HOCKEY: 'NHL, PWHL and college playoff brackets, survivor pools, and squares on the big games.',
  BASEBALL: 'MLB postseason brackets and survivor pools, from the Wild Card round to the World Series.',
  SOCCER: 'World Cup, Euros, Copa América and Champions League: brackets, sweepstakes, survivor, and squares on the final. Premier League weeks and group matchdays: pick\'em with draw picks, and Last Man Standing.',
  TENNIS: 'The four Grand Slams, men\'s and women\'s draws: tiered and budget picks, full-draw brackets, sweepstakes and survivor.',
};

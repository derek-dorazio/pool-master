/**
 * How a sport's results are stored and turned into a participant's score. Several sports share
 * one family (tennis and March Madness are both head to head), and each family owns one
 * set of result extension tables. A family is added with the code that serves it.
 */
export const ScoringFamily = {
  /** Lowest total wins, counted in strokes: golf. */
  STROKE_PLAY: 'STROKE_PLAY',
  /** Points by finishing place from the contest's points table: horse racing (#622). */
  FINISH_POSITION: 'FINISH_POSITION',
  /**
   * Results are matches, who beat whom (#698): basketball's bracket now, later pick'em seasons.
   * Its knockout scoring definition (points per round won plus an upset bonus) is #699.
   */
  HEAD_TO_HEAD: 'HEAD_TO_HEAD',
  /**
   * A championship stat pool's (#932): each game is a round, and a player's round scores the
   * sport's composite of their stats (`SportComposite`), more is better. Results are stat lines.
   * No sport scores by it on its own; a sport league names it (`SportLeague.scoringFamily`).
   */
  COMPOSITE: 'COMPOSITE',
} as const;
export type ScoringFamily = (typeof ScoringFamily)[keyof typeof ScoringFamily];

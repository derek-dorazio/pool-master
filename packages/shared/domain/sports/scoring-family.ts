/**
 * How a sport's results are stored and turned into a participant's score. Several sports share
 * one family (tennis and March Madness are both knockout advancement), and each family owns one
 * set of result extension tables. A family is added with the code that serves it.
 */
export const ScoringFamily = {
  /** Lowest total wins, counted in strokes: golf. */
  STROKE_PLAY: 'STROKE_PLAY',
} as const;
export type ScoringFamily = (typeof ScoringFamily)[keyof typeof ScoringFamily];

/** What a plan does with the features in a list: has them, or takes them away. */
export enum FeatureMark {
  /** A primary-blue tick and the feature in the body colour. */
  INCLUDED = 'INCLUDED',
  /** A muted dash and the feature muted, for what a lower plan hides. */
  REMOVED = 'REMOVED',
}

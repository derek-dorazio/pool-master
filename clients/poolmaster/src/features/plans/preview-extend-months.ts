/** How far a root admin can move a Premium preview's end, in months from today (#986). */
export const PREVIEW_EXTEND_MONTHS = [1, 3, 6, 12] as const;

export type PreviewExtendMonths = (typeof PREVIEW_EXTEND_MONTHS)[number];

/** One choice as a picker shows it: "1 month from today", "6 months from today". */
export function previewExtendMonthsLabel(months: number): string {
  return months === 1 ? '1 month from today' : `${String(months)} months from today`;
}

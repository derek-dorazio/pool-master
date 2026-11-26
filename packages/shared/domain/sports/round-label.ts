/** The games a side must win to take a best-of series: more than half of them. */
export function seriesWinsNeeded(seriesLength: number): number {
  return Math.floor(seriesLength / 2) + 1;
}

/** The year shown: the one in the link when it is offered, else the newest. Null with no year to show. */
export function chooseContestHistoryYear(years: readonly number[], yearParam: string | null): number | null {
  const asked = Number(yearParam);
  return years.includes(asked) ? asked : years[0] ?? null;
}

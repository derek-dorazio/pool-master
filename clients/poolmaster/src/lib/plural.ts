/** A count with its noun: "1 member", "3 members"; `many` for a plural that is not `one` + "s". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

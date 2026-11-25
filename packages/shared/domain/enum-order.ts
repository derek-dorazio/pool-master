import { enumLabel } from '../display-strings/display-strings';
import type { SharedEnumName, SharedEnums } from '../display-strings/display-strings-module';

/**
 * The natural order of a shared enum, declared on the enum itself in `enums.ts` (#1841), so
 * every list, grid and sort shows its values the same way and no consumer keeps an order of
 * its own (`rules/domain-model-conventions-rules.md`).
 *
 * An order is one of two kinds:
 * - `explicit`: a position for every value. The map is exhaustive over the enum, so adding a
 *   value without a place fails the type check.
 * - `alphabetical`: the enum has no natural order; its values sort A to Z by the words the
 *   display-string module gives them (`enumLabel`), so the order follows the reader's language
 *   (`rules/ux-rules.md` §16 *Display Strings*).
 */
export type ExplicitEnumOrder<V extends string> = {
  readonly kind: 'explicit';
  readonly orderIndex: Readonly<Record<V, number>>;
};
export type AlphabeticalEnumOrder<V extends string = string> = {
  readonly kind: 'alphabetical';
  /** The enum whose display strings the values sort by. */
  readonly enumName: SharedEnumName;
  /** Types the values the order is used with; never set. */
  readonly values?: V;
};
export type EnumOrder<V extends string> = ExplicitEnumOrder<V> | AlphabeticalEnumOrder<V>;

/** An order giving every value its place; lower comes first. */
export function explicitOrder<V extends string>(orderIndex: Readonly<Record<V, number>>): ExplicitEnumOrder<V> {
  return { kind: 'explicit', orderIndex };
}

/** An enum with no natural order: A to Z by its display strings. */
export function alphabeticalOrder<E extends SharedEnumName>(enumName: E): AlphabeticalEnumOrder<SharedEnums[E]> {
  return { kind: 'alphabetical', enumName };
}

/**
 * Compares two values of an enum by its declared order. An alphabetical order compares the
 * values' display strings in `locale` (`en-US` when none), ignoring case and accents; `label`
 * replaces them only where a screen still keeps its own words (allowlisted, #1955).
 */
export function compareByEnumOrder<V extends string>(
  order: EnumOrder<V>,
  label?: (value: V) => string,
  locale?: string | null,
): (left: V, right: V) => number {
  if (order.kind === 'explicit') {
    return (left, right) => order.orderIndex[left] - order.orderIndex[right];
  }
  const words =
    label ?? ((value: V) => enumLabel(order.enumName, value as SharedEnums[SharedEnumName], { locale: locale ?? undefined }));
  return (left, right) => words(left).localeCompare(words(right), locale ?? undefined, { sensitivity: 'base' });
}

/** An explicit order's values, first to last. */
export function explicitOrderValues<V extends string>(order: ExplicitEnumOrder<V>): V[] {
  return (Object.keys(order.orderIndex) as V[]).sort((left, right) => order.orderIndex[left] - order.orderIndex[right]);
}

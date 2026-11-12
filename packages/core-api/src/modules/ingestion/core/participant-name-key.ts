/** The suffixes a player's name may carry in one source and not another. */
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** A participant's name folded for linking by name, and the suffix the fold left off, if any. */
export interface FoldedParticipantName {
  key: string;
  suffix: string | null;
}

/**
 * A participant's name folded for linking by name (#1664), so one player written two ways by two
 * sources reads the same: accents dropped ("Dončić" is "doncic"), case ignored, punctuation
 * dropped ("P.J." is "pj", "O'Neal" is "oneal"), hyphens and runs of space read as one space, and
 * a trailing Jr., Sr., II, III or IV left off ("Jaren Jackson Jr." is "jaren jackson") while at
 * least two words remain. The suffix left off is kept beside the key, so a Jr. is never taken for
 * a Sr. of the same name (`sameParticipantName`). A letter that is its own letter rather than one
 * with a mark, such as "ø" or "ł", stays as it is.
 */
export function foldParticipantName(name: string): FoldedParticipantName {
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/[\s-]+/u)
    .filter((word) => word.length > 0);
  const suffix = words.length > 2 && NAME_SUFFIXES.has(words[words.length - 1]) ? words.pop() ?? null : null;
  return { key: words.join(' '), suffix };
}

/** The folded name alone (`foldParticipantName`). */
export function participantNameKey(name: string): string {
  return foldParticipantName(name).key;
}

/**
 * Whether two folded names are one participant's: the same key, and no two different suffixes. A
 * suffix only one side carries is the spelling difference linking forgives; "Jr." against "Sr."
 * (or "II" against "III") is a father and a son.
 */
export function sameParticipantName(one: FoldedParticipantName, other: FoldedParticipantName): boolean {
  return one.key === other.key && (one.suffix === null || other.suffix === null || one.suffix === other.suffix);
}

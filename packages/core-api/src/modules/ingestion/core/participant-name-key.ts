/** The suffixes a player's name may carry in one source and not another. */
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/**
 * A participant's name folded for linking by name (#1664), so one player written two ways by two
 * sources reads the same: accents dropped ("Dončić" is "doncic"), case ignored, punctuation
 * dropped ("P.J." is "pj", "O'Neal" is "oneal"), hyphens and runs of space read as one space, and
 * a trailing Jr., Sr., II, III or IV left off ("Jaren Jackson Jr." is "jaren jackson") while at
 * least two words remain. A letter that is its own letter rather than one with a mark, such as
 * "ø" or "ł", stays as it is.
 */
export function participantNameKey(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/[\s-]+/u)
    .filter((word) => word.length > 0);
  if (words.length > 2 && NAME_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

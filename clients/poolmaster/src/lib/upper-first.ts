/** A word with its first letter in upper case, for a heading or column name: "golfer" → "Golfer". */
export function upperFirst(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

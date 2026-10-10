/**
 * Money as budget contests show it (#93): whole dollars, grouped, such as "$50,000". Prices and
 * salary caps are whole dollars; cents appear only if a value carries them.
 */
const DOLLARS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatDollars(value: number) {
  return DOLLARS.format(value);
}

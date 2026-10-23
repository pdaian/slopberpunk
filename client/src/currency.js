// Currency stays in integer thousandths in content, saves, and network messages.
// GPL-3.0-or-later.
export const GOLD_SCALE = 1000;

// Ungrouped decimals also work in price inputs. Unit-price comparisons use six places.
export function formatGold(units, fractionDigits = 3) {
  return (units / GOLD_SCALE).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: fractionDigits });
}

// Parse the digits separately so fractional bids and gifts never lose a unit to rounding.
export function parseGold(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^(?:[0-9]+(?:\.[0-9]{0,3})?|\.[0-9]{1,3})$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const units = Number(whole) * GOLD_SCALE + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(units) ? units : null;
}

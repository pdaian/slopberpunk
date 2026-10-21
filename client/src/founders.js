// First Signal Halo: account entitlement, early XP, and original mesh. GPL-3.0-or-later.
export const FOUNDER_LIMIT = 1000;
export function hasFounderHalo(character) {
  return Number.isInteger(character?.founderHalo) && character.founderHalo >= 1 && character.founderHalo <= FOUNDER_LIMIT;
}
export function founderBoostActive(character) {
  return hasFounderHalo(character) && character.level >= 1 && character.level < 10;
}
export function founderXpReward(character, amount, rules) {
  if (!hasFounderHalo(character) || character.level >= 10) return { xp: amount, remainder: 0 };
  const cost = level => rules.xp.base + level * rules.xp.perLevel;
  // Level zero is the prologue. Only the part of a reward earned after it qualifies.
  const prologue = character.level === 0 ? Math.min(amount, Math.max(0, cost(0) - character.xp)) : 0;
  let toTen = character.level >= 1 ? -character.xp : 0;
  for (let level = Math.max(1, character.level); level < 10; level++) toTen += cost(level);
  if (toTen <= 0) return { xp: amount, remainder: 0 };
  const remainder = character.level === 0 ? 0 : Math.max(0, Math.min(19, Math.trunc(character.founderXpRemainder || 0)));
  // One bonus XP per 20 base XP; preserve small rewards without rounding up.
  const eligible = Math.min(amount - prologue, Math.ceil((toTen * 20 - remainder) / 21));
  const bonus = Math.min(Math.floor((eligible + remainder) / 20), toTen - eligible);
  return { xp: amount + bonus, remainder: eligible + bonus >= toTen ? 0 : (eligible + remainder) % 20 };
}
export function founderOfferView(offer, account) {
  if (hasFounderHalo(account)) return { status: `YOURS · EDITION ${String(account.founderHalo).padStart(4, '0')} / 1,000`, action: 'VIEW YOUR CHARACTERS ↗' };
  if (!offer || offer.limit !== FOUNDER_LIMIT || !Number.isInteger(offer.remaining) || offer.remaining < 0 || offer.remaining > FOUNDER_LIMIT) {
    return { status: 'Availability unconfirmed · connect to the account server.', action: account ? 'VIEW YOUR CHARACTERS ↗' : 'CHECK SIGNUP AVAILABILITY ↗' };
  }
  if (offer.remaining === 0) return { status: 'SIGNUP LIMIT REACHED · 1,000 ACCOUNTS', action: account ? 'VIEW YOUR CHARACTERS ↗' : 'CREATE AN ACCOUNT ↗' };
  return { status: `${offer.remaining.toLocaleString('en-US')} / 1,000 editions available · awarded on account creation.`, action: account ? 'VIEW YOUR CHARACTERS ↗' : 'SIGN UP FOR THE HALO ↗' };
}
export function founderHaloParts(time = 0) {
  const parts = [];
  // Floating black-chrome crown, six luminous fins, and a counter-rotating cyan orbit.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, x = Math.sin(angle), z = Math.cos(angle);
    parts.push({ center: [x * .48, 2.38, z * .48], size: [.27, .09, .09], color: '#252030', emissive: .18, yaw: angle });
    if (i % 2 === 0) parts.push({ center: [x * .48, 2.52, z * .48], size: [.065, .28, .065], color: '#ff54b8', emissive: 1, yaw: angle });
    const orbit = angle - time * .35;
    parts.push({ center: [Math.sin(orbit) * .7, 2.38 + Math.cos(orbit) * .12, Math.cos(orbit) * .7], size: [.19, .035, .045], color: '#86f5ed', emissive: 1, yaw: orbit });
  }
  parts.push({ center: [0, 2.57, .48], size: [.12, .34, .09], color: '#ffd0eb', emissive: 1, yaw: 0 });
  return parts;
}

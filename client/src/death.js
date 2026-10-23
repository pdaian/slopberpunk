// Presentation only; the server validates every recovery action. GPL-3.0-or-later.
import { distance } from './math.js';

export const isSpirit = c => c.health <= 0 && Boolean(c.death?.released);
export function recoveryView(c, data, world, now) {
  const death = c.death;
  if (!death || c.health > 0) return null;
  const graveyard = data.world.graveyards.find(g => g.id === death.graveyard);
  const spirit = isSpirit(c), rules = data.rules.death;
  return {
    spirit, graveyard,
    wait: Math.max(0, Math.ceil(death.releaseAt - now / 1000)),
    distance: Math.ceil(distance(c.position, death.corpse)),
    canReclaim: spirit && distance(c.position, death.corpse) <= rules.reclaimRadius && world.lineOfSight(c.position, death.corpse),
    atHealer: spirit && Boolean(graveyard) && distance(c.position, graveyard.position) <= data.rules.interactionRadius && world.lineOfSight(c.position, graveyard.position),
    healerCost: Math.min(c.gold, rules.healerLossCap, Math.ceil(c.gold * rules.healerLossFraction)),
  };
}

export function bearing(from, to, yaw = 0) {
  const angle = Math.atan2(to[0] - from[0], -(to[2] - from[2])) + yaw;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][(Math.round(angle / (Math.PI / 4)) % 8 + 8) % 8];
}

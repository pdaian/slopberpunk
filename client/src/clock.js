// One real UTC day, shared by HUD, sky, surface light and atmospheric scattering.
export const DAY_MS = 86_400_000;
export class WorldClock {
  constructor(wall = () => Date.now(), monotonic = () => performance.now()) {
    this.wall = wall; this.monotonic = monotonic; this.epoch = wall(); this.anchor = monotonic(); this.synchronized = false;
  }
  sync(serverTime) {
    if (!Number.isFinite(serverTime) || serverTime <= 0) return;
    this.epoch = serverTime; this.anchor = this.monotonic(); this.synchronized = true;
  }
  now() { return this.synchronized ? this.epoch + this.monotonic() - this.anchor : this.wall(); }
  reset() { this.synchronized = false; }
}
export function daylight(epoch) {
  const phase = ((epoch % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS;
  const angle = (phase - .25) * Math.PI * 2;
  const altitude = Math.sin(angle), light = Math.max(0, Math.min(1, (altitude + .12) / .45));
  const dawn = Math.max(0, 1 - Math.abs(altitude) / .25);
  return { phase, light, dawn, sun: [Math.cos(angle), altitude, .25],
    fog: [.065 + light * .19 + dawn * .05, .09 + light * .225, .15 + light * .25],
    label: light < .1 ? 'NIGHT' : dawn > .25 ? (phase < .5 ? 'DAWN' : 'DUSK') : 'DAY' };
}
export function clockLabel(epoch) {
  const date = new Date(epoch);
  return `SERVER ${date.toISOString().slice(11, 19)} UTC · ${daylight(epoch).label}`;
}

// Sloperberpunk — GPL-3.0-or-later. See LICENSE.
import { random, distance } from './math.js';

export class World {
  constructor(data) {
    this.data = data;
    this.buildings = [];
    this.cells = new Map();
    const g = data.buildingGrid, rand = random(data.seed);
    for (let x = g.min; x <= g.max; x++) for (let z = g.min; z <= g.max; z++) {
      const px = x * g.spacing + g.spacing / 2, pz = z * g.spacing + g.spacing / 2;
      if (Math.hypot(px, pz) < g.excludeCenter) continue;
      const w = g.widthMin + rand() * (g.widthMax - g.widthMin);
      const d = g.widthMin + rand() * (g.widthMax - g.widthMin);
      const h = g.heightMin + rand() * (g.heightMax - g.heightMin);
      const b = { x: px, z: pz, w, d, h, shade: Math.floor(rand() * 4), accent: Math.floor(rand() * 4), seed: Math.floor(rand() * 999999) };
      this.buildings.push(b);
      this.cells.set(`${x},${z}`, b);
    }
  }
  collides(x, y, z, radius = .65) {
    const s = this.data.buildingGrid.spacing, cx = Math.floor(x / s), cz = Math.floor(z / s);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const b = this.cells.get(`${i},${j}`);
      if (b && y < b.h && y + 2.1 > 0 && Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius) return true;
    }
    return Math.abs(x) > this.data.bounds || Math.abs(z) > this.data.bounds;
  }
  floorAt(x, z, previousY, nextY) {
    let floor = 0;
    for (const p of this.data.platforms) if (Math.abs(x - p.position[0]) <= p.size[0] / 2 && Math.abs(z - p.position[2]) <= p.size[2] / 2 && previousY >= p.position[1] - .05 && nextY <= p.position[1]) floor = Math.max(floor, p.position[1]);
    const s=this.data.buildingGrid.spacing,b=this.cells.get(`${Math.floor(x/s)},${Math.floor(z/s)}`);
    if(b&&Math.abs(x-b.x)<=b.w/2&&Math.abs(z-b.z)<=b.d/2&&previousY>=b.h-.05&&nextY<=b.h)floor=Math.max(floor,b.h);
    return floor;
  }
  district(pos) {
    const biome = this.biomeAt(pos);
    if (biome) return biome;
    if (Math.max(Math.abs(pos[0]), Math.abs(pos[2])) > this.data.cityRadius) return this.data.districts.at(-1);
    if (pos[1] > 20) return this.data.districts.find(d => d.id === 'skybridge');
    return this.data.districts.slice(0, -1).reduce((a, b) => distance(pos, a.center) < distance(pos, b.center) ? a : b);
  }
  biomeAt(pos) {
    return this.data.biomes?.find(b => Math.hypot(pos[0] - b.center[0], pos[2] - b.center[2]) <= b.radius);
  }
  lineOfSight(from, to) {
    const steps = Math.ceil(distance(from, to) / 2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.collides(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t, 0)) return false;
    }
    return true;
  }
}

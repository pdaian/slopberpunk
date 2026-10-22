// Sloperberpunk — GPL-3.0-or-later. See LICENSE.
import { random, distance } from './math.js';

// The server builds these same boxes from the map's interior recipe.
export function buildingSolids(b, config) {
  const solids = [], add = (center, size, kind = 'wall') => solids.push({center: [b.x + center[0], center[1], b.z + center[2]], size, kind});
  if (!b.interior) {
    add([0, b.h / 2, 0], [b.w, b.h, b.d]);
    return solids;
  }
  const {height: h, wall: t, doorWidth: door, doorHeight} = config;
  add([0, (b.h + h) / 2, 0], [b.w, b.h - h, b.d], 'upper');
  for (const side of [-1, 1]) {
    add([side * (b.w - t) / 2, h / 2, 0], [t, h, b.d]);
    for (const wing of [-1, 1]) add([wing * (b.w + door) / 4, h / 2, side * (b.d - t) / 2], [(b.w - door) / 2, h, t]);
    add([0, (h + doorHeight) / 2, side * (b.d - t) / 2], [door, h - doorHeight, t]);
  }
  for (const item of b.interior.furniture) add(item.center, item.size, item.kind);
  return solids;
}

export class World {
  constructor(data) {
    this.data = data;
    this.buildings = [];
    this.cells = new Map();
    this.discovered = new Set();
    const g = data.buildingGrid, rand = random(data.seed);
    for (let x = g.min; x <= g.max; x++) for (let z = g.min; z <= g.max; z++) {
      const px = x * g.spacing + g.spacing / 2, pz = z * g.spacing + g.spacing / 2;
      if (Math.hypot(px, pz) < g.excludeCenter) continue;
      const w = g.widthMin + rand() * (g.widthMax - g.widthMin);
      const d = g.widthMin + rand() * (g.widthMax - g.widthMin);
      const h = g.heightMin + rand() * (g.heightMax - g.heightMin);
      const b = { x: px, z: pz, w, d, h, shade: Math.floor(rand() * 4), accent: Math.floor(rand() * 4), seed: Math.floor(rand() * 999999) };
      b.interior = data.interiors?.rooms.length && b.seed % 5 !== 0 ? data.interiors.rooms[b.seed % data.interiors.rooms.length] : null;
      b.solids = buildingSolids(b, data.interiors);
      this.buildings.push(b);
      this.cells.set(`${x},${z}`, b);
    }
  }
  collides(x, y, z, radius = .65, height = 2.1) {
    const s = this.data.buildingGrid.spacing, cx = Math.floor(x / s), cz = Math.floor(z / s);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const b = this.cells.get(`${i},${j}`);
      if (b && b.solids.some(s => y < s.center[1] + s.size[1] / 2 && y + height > s.center[1] - s.size[1] / 2 && Math.abs(x - s.center[0]) < s.size[0] / 2 + radius && Math.abs(z - s.center[2]) < s.size[2] / 2 + radius)) return true;
    }
    return Math.abs(x) > this.data.bounds || Math.abs(z) > this.data.bounds;
  }
  floorAt(x, z, previousY, nextY) {
    let floor = 0;
    for (const p of this.data.platforms) if (Math.abs(x - p.position[0]) <= p.size[0] / 2 && Math.abs(z - p.position[2]) <= p.size[2] / 2 && previousY >= p.position[1] - .05 && nextY <= p.position[1]) floor = Math.max(floor, p.position[1]);
    const s=this.data.buildingGrid.spacing,b=this.cells.get(`${Math.floor(x/s)},${Math.floor(z/s)}`);
    if(b)for(const solid of b.solids){const top=solid.center[1]+solid.size[1]/2;if(Math.abs(x-solid.center[0])<=solid.size[0]/2&&Math.abs(z-solid.center[2])<=solid.size[2]/2&&previousY>=top-.05&&nextY<=top)floor=Math.max(floor,top);}
    return floor;
  }
  ceilingAt(x, z, previousY, nextY, radius = .65, height = 2.1) {
    let ceiling = Infinity;
    const s = this.data.buildingGrid.spacing, cx = Math.floor(x / s), cz = Math.floor(z / s);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      for (const solid of this.cells.get(`${i},${j}`)?.solids || []) {
        const bottom = solid.center[1] - solid.size[1] / 2;
        if (Math.abs(x - solid.center[0]) < solid.size[0] / 2 + radius && Math.abs(z - solid.center[2]) < solid.size[2] / 2 + radius && previousY + height <= bottom + .001 && nextY + height >= bottom) ceiling = Math.min(ceiling, bottom - height);
      }
    }
    return ceiling;
  }
  interiorAt(pos) {
    const s = this.data.buildingGrid.spacing, b = this.cells.get(`${Math.floor(pos[0] / s)},${Math.floor(pos[2] / s)}`);
    return b?.interior && pos[1] < this.data.interiors.height && Math.abs(pos[0] - b.x) < b.w / 2 && Math.abs(pos[2] - b.z) < b.d / 2 ? b : null;
  }
  reveal(pos) {
    const s = this.data.cellSize, cx = Math.floor(pos[0] / s), cz = Math.floor(pos[2] / s);
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) if (Math.hypot(x - cx, z - cz) <= 2) this.discovered.add(`${x},${z}`);
  }
  isDiscovered(pos) { return this.discovered.has(`${Math.floor(pos[0] / this.data.cellSize)},${Math.floor(pos[2] / this.data.cellSize)}`); }
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
    // Actor positions are feet. Test a torso-height ray against exact wall boxes;
    // fixed-distance samples can skip a thin wall at an oblique angle.
    const a=[from[0],from[1]+1.05,from[2]],b=[to[0],to[1]+1.05,to[2]],s=this.data.buildingGrid.spacing;
    for(let x=Math.floor(Math.min(a[0],b[0])/s)-1;x<=Math.floor(Math.max(a[0],b[0])/s)+1;x++)for(let z=Math.floor(Math.min(a[2],b[2])/s)-1;z<=Math.floor(Math.max(a[2],b[2])/s)+1;z++){
      for(const solid of this.cells.get(`${x},${z}`)?.solids||[]){
        let enter=0,leave=1;
        for(let axis=0;axis<3;axis++){
          const low=solid.center[axis]-solid.size[axis]/2,high=solid.center[axis]+solid.size[axis]/2,d=b[axis]-a[axis];
          if(Math.abs(d)<1e-9){if(a[axis]<=low||a[axis]>=high){leave=-1;break;}}
          else{const t0=(low-a[axis])/d,t1=(high-a[axis])/d;enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));}
        }
        if(enter<leave)return false;
      }
    }
    return true;
  }
}

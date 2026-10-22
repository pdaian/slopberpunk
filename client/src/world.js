// Sloperberpunk — GPL-3.0-or-later. See LICENSE.
import { random } from './math.js';

export function validRoute(r,bounds) {
  if(!r||![r.start,r.end].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)&&Math.abs(p[0])<=bounds&&Math.abs(p[2])<=bounds&&p[1]>=0&&p[1]<=256)||!Number.isFinite(r.width)||r.width<2||r.width>40||!['stairs','ramp','hill'].includes(r.kind))return false;
  const dx=r.end[0]-r.start[0],dz=r.end[2]-r.start[2],rise=Math.abs(r.end[1]-r.start[1]);
  return (dx===0)!==(dz===0)&&rise/Math.hypot(dx,dz)<=.5&&(r.kind!=='stairs'||Number.isInteger(r.steps)&&r.steps>0&&r.steps<=2048&&rise/r.steps<=.4);
}

// Routes are axis-aligned. Their endpoints are walking heights, not mesh centers.
export function routeHeight(route, x, z) {
  const axis = route.start[0] === route.end[0] ? 2 : 0, cross = 2 - axis;
  const position = [x, 0, z], delta = route.end[axis] - route.start[axis];
  const t = (position[axis] - route.start[axis]) / delta;
  if (t < 0 || t > 1 || Math.abs(position[cross] - route.start[cross]) > route.width / 2) return null;
  const progress = route.kind === 'stairs' ? Math.ceil(t * route.steps - 1e-9) / route.steps : t;
  return route.start[1] + (route.end[1] - route.start[1]) * progress;
}

export function buildingRoutes(b, config) {
  if (!b.interior) return [];
  return [0, 1].map(floor => {
    const side = floor === 0 ? 1 : -1, x = b.x + side * (b.w / 2 - 2.9);
    return {id: `${b.id}-stairs-${floor}`, name: `${b.identity?.name || 'Building'} stairs`, kind: 'stairs',
      start: [x, floor * config.height, b.z - side * (b.d / 2 - 4)], end: [x, (floor + 1) * config.height, b.z + side * (b.d / 2 - 4)], width: 3.8, steps: 32, indoor: true};
  });
}

export function buildingIdentity(b, data) {
  const district = data.districts.slice(0, -1).reduce((a, d) => Math.hypot(b.x-a.center[0],b.z-a.center[2]) < Math.hypot(b.x-d.center[0],b.z-d.center[2]) ? a : d);
  const profile = data.architecture?.[district.id];
  if (!profile) return {name: b.interior?.name || 'Service building', address: `${b.x}, ${b.z}`, district: district.id, upper: ['Shared room', 'Residents’ room']};
  const use = profile.uses[b.seed % profile.uses.length], street = profile.streets[Math.abs(Math.floor(b.z / 80)) % profile.streets.length];
  const address = `${1 + (Math.floor(b.x / 80) - data.buildingGrid.min) * 2 + (Math.floor(b.z / 80) - data.buildingGrid.min) * 54} ${street}`;
  return {...use, address, district: district.id, material: profile.materials[b.shade % profile.materials.length], trim: profile.trim, upper: profile.upper,
    purpose:b.interior?use.purpose:`This is the stockroom for ${use.name}. Deliveries go to the side bay; there is no public counter.`,
    name: `${use.name}${b.interior?'':' stores'} · ${address}`};
}

// The server builds these same boxes from the map's interior recipe.
export function buildingSolids(b, config) {
  const solids = [], add = (center, size, kind = 'wall') => solids.push({center: [b.x + center[0], center[1], b.z + center[2]], size, kind});
  if (!b.interior) {
    add([0, b.h / 2, 0], [b.w, b.h, b.d]);
    return solids;
  }
  const {height: h, wall: t, doorWidth: door, doorHeight} = config;
  const base = h * 3, split = base + (b.h - base) * .55, setback = b.seed % 4 * .08;
  add([0, (base + split) / 2, 0], [b.w, split - base, b.d], 'upper');
  add([0, (split + b.h) / 2, 0], [b.w * (1-setback), b.h - split, b.d * (1-setback)], 'upper');
  for (let floor = 0; floor < 3; floor++) {
    const y = floor * h;
    for (const side of [-1, 1]) {
      add([side * (b.w - t) / 2, y + h / 2, 0], [t, h, b.d]);
      for (const wing of [-1, 1]) add([wing * (b.w + door) / 4, y + h / 2, side * (b.d - t) / 2], [(b.w - door) / 2, h, t]);
      add([0, y + (h + doorHeight) / 2, side * (b.d - t) / 2], [door, h - doorHeight, t]);
      // Upper windows are glazed; only street doors are walk-through openings.
      if (floor) add([0, y + doorHeight / 2, side * (b.d - t) / 2], [door, doorHeight, t], 'window');
    }
    if (floor) {
      const side = floor === 1 ? 1 : -1;
      add([-side * 2.5, y - .175, 0], [b.w - 5, .35, b.d], 'floor');
      for (const end of [-1, 1]) add([side * (b.w / 2 - 2.5), y - .175, end * (b.d / 2 - 2)], [5, .35, 4], 'floor');
    }
    const room=floor?(config.upperRooms?.[floor-1]||b.interior):b.interior;
    for (const item of room.furniture) add([item.center[0], y + item.center[1], item.center[2]], item.size, item.kind);
  }
  return solids;
}

export class World {
  constructor(data) {
    this.data = data;
    this.buildings = [];
    this.cells = new Map();
    this.routes = [...(data.routes || [])];
    if(this.routes.length>128||this.routes.some(r=>!validRoute(r,data.bounds)))throw new Error('Invalid city stairs, ramp, or hill. Check route endpoints, width, and slope.');
    this.routeCells = new Map();
    this.discovered = new Set();
    const g = data.buildingGrid, rand = random(data.seed);
    for (let x = g.min; x <= g.max; x++) for (let z = g.min; z <= g.max; z++) {
      const px = x * g.spacing + g.spacing / 2, pz = z * g.spacing + g.spacing / 2;
      if (Math.hypot(px, pz) < g.excludeCenter) continue;
      const w = g.widthMin + rand() * (g.widthMax - g.widthMin);
      const d = g.widthMin + rand() * (g.widthMax - g.widthMin);
      const h = g.heightMin + rand() * (g.heightMax - g.heightMin);
      const b = { x: px, z: pz, w, d, h, shade: Math.floor(rand() * 4), accent: Math.floor(rand() * 4), seed: Math.floor(rand() * 999999) };
      b.id = `building-${x}-${z}`;
      b.interior = data.interiors?.rooms.length && b.seed % 5 !== 0 ? data.interiors.rooms[b.seed % data.interiors.rooms.length] : null;
      b.identity = buildingIdentity(b, data);
      b.solids = buildingSolids(b, data.interiors);
      b.routes = buildingRoutes(b, data.interiors);
      this.routes.push(...b.routes);
      this.buildings.push(b);
      this.cells.set(`${x},${z}`, b);
    }
    for (const route of this.routes) {
      const padding = route.width / 2, s = g.spacing;
      for (let x=Math.floor((Math.min(route.start[0],route.end[0])-padding)/s);x<=Math.floor((Math.max(route.start[0],route.end[0])+padding)/s);x++) for(let z=Math.floor((Math.min(route.start[2],route.end[2])-padding)/s);z<=Math.floor((Math.max(route.start[2],route.end[2])+padding)/s);z++) {
        const key=`${x},${z}`;if(!this.routeCells.has(key))this.routeCells.set(key,[]);this.routeCells.get(key).push(route);
      }
    }
  }
  routesAt(x,z) { const s=this.data.buildingGrid.spacing;return this.routeCells.get(`${Math.floor(x/s)},${Math.floor(z/s)}`)||[]; }
  collides(x, y, z, radius = .65, height = 2.1) {
    const s = this.data.buildingGrid.spacing, cx = Math.floor(x / s), cz = Math.floor(z / s);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
      const b = this.cells.get(`${i},${j}`);
      if (b && b.solids.some(s => y < s.center[1] + s.size[1] / 2 && y + height > s.center[1] - s.size[1] / 2 && Math.abs(x - s.center[0]) < s.size[0] / 2 + radius && Math.abs(z - s.center[2]) < s.size[2] / 2 + radius)) return true;
    }
    for (const route of this.routesAt(x,z)) { const top=routeHeight(route,x,z);if(top!==null&&y<top-1e-7&&y+height>(route.kind==='hill'?0:top-.35))return true; }
    return Math.abs(x) > this.data.bounds || Math.abs(z) > this.data.bounds;
  }
  floorAt(x, z, previousY, nextY) {
    let floor = 0;
    for (const p of this.data.platforms) if (Math.abs(x - p.position[0]) <= p.size[0] / 2 && Math.abs(z - p.position[2]) <= p.size[2] / 2 && previousY >= p.position[1] - .05 && nextY <= p.position[1]) {
      const opening=this.routesAt(x,z).some(r=>{const y=routeHeight(r,x,z);return r.end[1]===p.position[1]&&r.start[1]<r.end[1]&&y!==null&&y>=p.position[1]-3.5&&y<p.position[1];});
      if(!opening)floor=Math.max(floor,p.position[1]);
    }
    const s=this.data.buildingGrid.spacing,b=this.cells.get(`${Math.floor(x/s)},${Math.floor(z/s)}`);
    if(b)for(const solid of b.solids){const top=solid.center[1]+solid.size[1]/2;if(Math.abs(x-solid.center[0])<=solid.size[0]/2&&Math.abs(z-solid.center[2])<=solid.size[2]/2&&previousY>=top-.05&&nextY<=top)floor=Math.max(floor,top);}
    for(const route of this.routesAt(x,z)){const top=routeHeight(route,x,z);if(top!==null&&previousY>=top-.05&&nextY<=top)floor=Math.max(floor,top);}
    return floor;
  }
  // Only grounded movement may follow a rising surface; jumping keeps its arc.
  stepPosition(position, axis, amount, grounded, radius=.65, height=2.1, step=.42) {
    const next=[...position];next[axis]+=amount;
    if(grounded){
      const floor=this.floorAt(next[0],next[2],position[1]+step,position[1]-.55);
      if(floor>=position[1]-.55&&floor<=position[1]+step)next[1]=floor;
    }
    return this.collides(...next,radius,height)?null:next;
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
    for(const route of this.routesAt(x,z)){
      const top=routeHeight(route,x,z);if(top===null)continue;
      const bottom=route.kind==='hill'?0:top-.35;
      if(previousY+height<=bottom+.001&&nextY+height>=bottom)ceiling=Math.min(ceiling,bottom-height);
    }
    return ceiling;
  }
  interiorAt(pos) {
    const s = this.data.buildingGrid.spacing, b = this.cells.get(`${Math.floor(pos[0] / s)},${Math.floor(pos[2] / s)}`);
    return b?.interior && pos[1] >= 0 && pos[1] < this.data.interiors.height * 3 && Math.abs(pos[0] - b.x) < b.w / 2 && Math.abs(pos[2] - b.z) < b.d / 2 ? b : null;
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
    return this.data.districts.slice(0, -1).reduce((a, b) => Math.hypot(pos[0]-a.center[0],pos[2]-a.center[2]) < Math.hypot(pos[0]-b.center[0],pos[2]-b.center[2]) ? a : b);
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
    // A ray is linear between stair boundaries; test each such interval exactly.
    const routes=new Set(),minX=Math.floor(Math.min(a[0],b[0])/s),maxX=Math.floor(Math.max(a[0],b[0])/s),minZ=Math.floor(Math.min(a[2],b[2])/s),maxZ=Math.floor(Math.max(a[2],b[2])/s);
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)for(const route of this.routeCells.get(`${x},${z}`)||[])routes.add(route);
    for(const route of routes)if(routeBlocksRay(route,a,b))return false;
    return true;
  }
}

export function routeBlocksRay(route,a,b) {
  const axis=route.start[0]===route.end[0]?2:0,cross=2-axis,count=route.kind==='stairs'?route.steps:1;
  for(let i=0;i<count;i++){
    const from=route.start[axis]+(route.end[axis]-route.start[axis])*i/count,to=route.start[axis]+(route.end[axis]-route.start[axis])*(i+1)/count;
    let enter=0,leave=1;
    const slope=route.kind==='stairs'?0:(route.end[1]-route.start[1])/(route.end[axis]-route.start[axis]);
    const top=route.start[1]+(route.end[1]-route.start[1])*(i+1)/count;
    const intercept=route.kind==='stairs'?top:route.start[1]-slope*route.start[axis];
    const planes=[[a[axis],b[axis]-a[axis],Math.min(from,to),Math.max(from,to)], [a[cross],b[cross]-a[cross],route.start[cross]-route.width/2,route.start[cross]+route.width/2], [a[1]-slope*a[axis],b[1]-a[1]-slope*(b[axis]-a[axis]),route.kind==='hill'?-Infinity:intercept-.35,intercept]];
    if(route.kind==='hill')planes.push([a[1],b[1]-a[1],0,Infinity]);
    for(const [origin,delta,low,high]of planes){if(Math.abs(delta)<1e-9){if(origin<=low||origin>=high){leave=-1;break;}}else{const t0=(low-origin)/delta,t1=(high-origin)/delta;enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));}}
    if(enter<leave)return true;
  }
  return false;
}

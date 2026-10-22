// Editable mesh primitives. Y is up; forward is +Z. GPL-3.0-or-later.
import { color } from './math.js';

const faces = [
  [[1,0,0], [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
  [[-1,0,0], [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
  [[0,1,0], [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],
  [[0,-1,0], [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],
  [[0,0,1], [[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]]],
  [[0,0,-1], [[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]]]
];
export function box(vertices, center, size, hex, glow = 0, yaw = 0) {
  const col = Array.isArray(hex) ? hex : color(hex), cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (const [normal, corners] of faces) for (const i of [0,1,2,0,2,3]) {
    const v = corners[i], x = v[0] * size[0] / 2, z = v[2] * size[2] / 2;
    vertices.push(center[0] + x * cs + z * sn, center[1] + v[1] * size[1] / 2, center[2] - x * sn + z * cs,
      normal[0] * cs + normal[2] * sn, normal[1], -normal[0] * sn + normal[2] * cs, ...col, glow);
  }
}
export function pane(vertices, center, size, hex, glow, face, yaw = 0) {
  const [normal,corners] = faces[face], col = color(hex), cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (const i of [0,1,2,0,2,3]) {
    const v = corners[i], x = v[0] * size[0] / 2, z = v[2] * size[2] / 2;
    vertices.push(center[0]+x*cs+z*sn, center[1]+v[1]*size[1]/2, center[2]-x*sn+z*cs,
      normal[0]*cs+normal[2]*sn, normal[1], -normal[0]*sn+normal[2]*cs, ...col, glow);
  }
}
function triangle(v, a, b, c, center, col, glow, yaw) {
  const ab = b.map((x,i)=>x-a[i]), ac = c.map((x,i)=>x-a[i]);
  let n = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]];
  if (n.reduce((sum,x,i)=>sum+x*(a[i]+b[i]+c[i]),0) < 0) { [b,c]=[c,b]; n=n.map(x=>-x); }
  const length = Math.hypot(...n); if (length < 1e-10) return;
  n=n.map(x=>x/length);
  const cs=Math.cos(yaw), sn=Math.sin(yaw);
  for (const p of [a,b,c]) v.push(center[0]+p[0]*cs+p[2]*sn, center[1]+p[1], center[2]-p[0]*sn+p[2]*cs,
    n[0]*cs+n[2]*sn, n[1], -n[0]*sn+n[2]*cs, ...col, glow);
}

// A walking slab with a continuous slope, or a filled embankment down to ground.
export function slope(v, start, end, width, hex, filled = false) {
  const length=Math.hypot(end[0]-start[0],end[2]-start[2]),yaw=Math.atan2(end[0]-start[0],end[2]-start[2]);
  const low=filled?[0,0]:[start[1]-.35,end[1]-.35];
  const y=(start[1]+end[1]+low[0]+low[1])/4,center=[(start[0]+end[0])/2,y,(start[2]+end[2])/2],col=color(hex);
  const p=[[-width/2,low[0]-y,-length/2],[width/2,low[0]-y,-length/2],[width/2,low[1]-y,length/2],[-width/2,low[1]-y,length/2],[-width/2,start[1]-y,-length/2],[width/2,start[1]-y,-length/2],[width/2,end[1]-y,length/2],[-width/2,end[1]-y,length/2]];
  for(const face of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])for(const ids of [[0,1,2],[0,2,3]])triangle(v,...ids.map(i=>p[face[i]]),center,col,0,yaw);
}
export function bevelBox(v, center, size, hex, glow = 0, yaw = 0, bevel = .12, taper = 1) {
  const [x,y,z]=size.map(n=>n/2), r=Math.min(bevel,x*.4,y*.4,z*.4), col=Array.isArray(hex)?hex:color(hex);
  const ring=(hx,hz,h,b)=>[[hx-b,h,hz],[-hx+b,h,hz],[-hx,h,hz-b],[-hx,h,-hz+b],[-hx+b,h,-hz],[hx-b,h,-hz],[hx,h,-hz+b],[hx,h,hz-b]];
  const rings=[ring((x-r)*taper,(z-r)*taper,-y,r*.3),ring(x*taper,z*taper,-y+r,r),ring(x,z,y-r,r),ring(x-r,z-r,y,r*.3)];
  const tri=(a,b,c)=>triangle(v,a,b,c,center,col,glow,yaw);
  for(let j=0;j<3;j++)for(let i=0;i<8;i++){const k=(i+1)%8;tri(rings[j][i],rings[j+1][i],rings[j+1][k]);tri(rings[j][i],rings[j+1][k],rings[j][k]);}
  for(let i=1;i<7;i++){tri(rings[0][0],rings[0][i],rings[0][i+1]);tri(rings[3][0],rings[3][i+1],rings[3][i]);}
}
export function ellipsoid(v, center, size, hex, glow = 0, yaw = 0, segments = 12) {
  const col=Array.isArray(hex)?hex:color(hex), rings=Math.max(4,segments/2), cs=Math.cos(yaw), sn=Math.sin(yaw);
  const point=(i,j)=>{const a=i/segments*Math.PI*2,b=j/rings*Math.PI;return [Math.sin(b)*Math.cos(a),Math.cos(b),Math.sin(b)*Math.sin(a)];};
  const vertex=p=>{
    const q=p.map((n,i)=>n*size[i]/2), n=p.map((x,i)=>x/size[i]), len=Math.hypot(...n);
    v.push(center[0]+q[0]*cs+q[2]*sn,center[1]+q[1],center[2]-q[0]*sn+q[2]*cs,
      (n[0]*cs+n[2]*sn)/len,n[1]/len,(-n[0]*sn+n[2]*cs)/len,...col,glow);
  };
  for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
    const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
    if(j>0)for(const p of [a,b,c])vertex(p);
    if(j<rings-1)for(const p of [a,c,d])vertex(p);
  }
}

export function transformMesh(out, mesh, position, yaw = 0, pitch = 0, roll = 0, tint = null, glow = null, scale = 1) {
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitch),sx=Math.sin(pitch),cz=Math.cos(roll),sz=Math.sin(roll);
  const a=cz*cy,b=-cx*sz*cy+sx*sy,d=sx*sz*cy+cx*sy,e=sz,f=cx*cz,g=-sx*cz,h=-cz*sy,j=cx*sz*sy+sx*cy,k=-sx*sz*sy+cx*cy;
  for(let i=0;i<mesh.length;i+=10){
    const x=mesh[i]*scale,y=mesh[i+1]*scale,z=mesh[i+2]*scale,nx=mesh[i+3],ny=mesh[i+4],nz=mesh[i+5];
    out.push(a*x+b*y+d*z+position[0],e*x+f*y+g*z+position[1],h*x+j*y+k*z+position[2],
      a*nx+b*ny+d*nz,e*nx+f*ny+g*nz,h*nx+j*ny+k*nz,tint?tint[0]:mesh[i+6],tint?tint[1]:mesh[i+7],tint?tint[2]:mesh[i+8],glow??mesh[i+9]);
  }
}

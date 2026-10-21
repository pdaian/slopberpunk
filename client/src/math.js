// Sloperberpunk — GPL-3.0-or-later. See LICENSE.
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const mix3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
export function color(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
}
export function random(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
export function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function lookAt(eye, target) {
  let z = eye.map((v, i) => v - target[i]);
  let n = Math.hypot(...z) || 1; z = z.map(v => v / n);
  let x = [z[2], 0, -z[0]]; n = Math.hypot(...x) || 1; x = x.map(v => v / n);
  const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
  const dot = v => -v.reduce((s, a, i) => s + a * eye[i], 0);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, dot(x), dot(y), dot(z), 1]);
}
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
export function project(point, matrix, width, height) {
  const p = [...point, 1];
  const v = [0, 1, 2, 3].map(r => p.reduce((s, n, c) => s + n * matrix[c * 4 + r], 0));
  if (v[3] <= 0) return null;
  return [(v[0] / v[3] * .5 + .5) * width, (-v[1] / v[3] * .5 + .5) * height, v[2] / v[3]];
}

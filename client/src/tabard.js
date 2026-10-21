// Shared pixel heraldry for the editor and the original character mesh.
import { escapeHtml as esc } from './icons.js';
const emblems = {
  signal: ['00100','10101','10101','10101','00100'],
  star: ['00100','01110','11111','01110','00100'],
  tower: ['10101','11111','01110','01010','01110']
};
export function tabardParts(value) {
  const t = value || {}, base = /^#[0-9a-f]{6}$/i.test(t.base) ? t.base : '#284d42', trim = /^#[0-9a-f]{6}$/i.test(t.trim) ? t.trim : '#c7ed99';
  const parts = [{ x: 0, y: 0, w: .68, h: .88, color: base }];
  if (t.pattern === 'split') parts.push({ x: -.17, y: 0, w: .34, h: .88, color: trim });
  else if (t.pattern === 'cross') parts.push({ x: 0, y: 0, w: .13, h: .88, color: trim }, { x: 0, y: .1, w: .68, h: .13, color: trim });
  else parts.push({ x: -.25, y: 0, w: .07, h: .88, color: trim }, { x: .25, y: 0, w: .07, h: .88, color: trim });
  // A dark inset preserves emblem contrast even with identical chosen colors.
  parts.push({ x: 0, y: .07, w: .36, h: .36, color: '#102019' });
  for (const [y, row] of (emblems[t.emblem] || emblems.signal).entries()) for (let x = 0; x < row.length; x++) if (row[x] === '1') parts.push({ x: (x - 2) * .055, y: .07 + (2 - y) * .055, w: .054, h: .054, color: trim });
  return parts;
}
export function tabardPreview(value) {
  return `<svg class="tabard-preview" viewBox="-40 -48 80 96" role="img" aria-label="Guild tabard preview">${tabardParts(value).map(p => `<rect x="${(p.x-p.w/2)*100}" y="${(-p.y-p.h/2)*100}" width="${p.w*100}" height="${p.h*100}" fill="${esc(p.color)}"/>`).join('')}</svg>`;
}

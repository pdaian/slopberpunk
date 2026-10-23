// Original line-art symbols. GPL-3.0-or-later.
const paths={
  bolt:'<path d="M18 3 5 18h9l-2 11 15-17h-10z"/>',
  pulse:'<path d="M2 17h6l4-11 6 21 5-13h7"/><path d="M5 7V4h3m16 0h3v3M5 25v3h3m16 0h3v-3"/>',
  cross:'<path d="M12 4h8v8h8v8h-8v8h-8v-8H4v-8h8z"/>',
  shield:'<path d="m16 3 11 5v9c0 7-11 12-11 12S5 24 5 17V8z"/><path d="m10 16 4 4 8-9"/>',
  target:'<circle cx="16" cy="16" r="9"/><path d="M16 1v9m0 12v9M1 16h9m12 0h9m-9-9L10 22"/>',
  orbit:'<ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(45 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(-45 16 16)"/><circle cx="16" cy="16" r="2"/>',
  human:'<path d="M10 13V8l6-4 6 4v5l-6 5zM5 29v-7l11-4 11 4v7M11 10h10m-5 8v10"/>',
  lattice:'<path d="m16 3 10 6v14l-10 6-10-6V9zM6 9l10 7 10-7M6 23l10-7 10 7M16 3v13m0 0v13"/>',
  revenant:'<path d="M9 25 5 16 9 7l7-4 7 4 4 9-4 9-7 4zM10 13l4 3-3 4m11-7-4 3 3 4M13 24h6M16 3v5"/>',
  bloom:'<path d="M16 29V16m0 4C3 20 3 7 3 7s13 0 13 13zm0-4C16 3 29 3 29 3s0 13-13 13zM9 28l7-5 7 5"/>',
  relay:'<path d="M5 22 16 4l11 18H5zm11-10v17M2 28h28M8 9l-5 8m21-8 5 8"/>',
  covenant:'<path d="m16 2 12 14-12 14L4 16zM4 16h24M16 2l5 14-5 14-5-14z"/>',
  foundry:'<path d="M4 27V13l8 5v-8l8 6V4h7v23zM8 23h16"/>',
  choir:'<circle cx="16" cy="16" r="12"/><path d="M10 10v12m6-17v22m6-17v12M4 28 28 4"/>',
  map:'<path d="m3 7 8-3 10 4 8-3v22l-8 3-10-4-8 3zM11 4v22M21 8v22"/>',
  medkit:'<path d="M6 10h20v18H6zM11 10V5h10v5M16 14v10m-5-5h10"/>'
};
export function icon(name){return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="bevel" aria-hidden="true">${paths[name]||paths.orbit}</svg>`;}
export function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

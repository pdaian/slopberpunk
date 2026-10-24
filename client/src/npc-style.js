// Original modular streetwear and stable civilian identities. GPL-3.0-or-later.
// These are presentation recipes, never player equipment or collectible unlocks.
export const NPC_WARDROBE = {
  upper: ['bomber', 'racer', 'trench', 'poncho', 'cropped', 'hoodie', 'kimono', 'tailcoat', 'puffer', 'moto', 'vest', 'duster', 'cape', 'varsity', 'bolero', 'anorak'],
  lower: ['slim', 'cargo', 'wide', 'flare', 'shorts', 'pleated', 'asymmetric', 'joggers'],
  shoes: ['runners', 'combat boots', 'platforms', 'split toes', 'high tops', 'pointed boots'],
  finish: ['matte weave', 'liquid satin', 'patent vinyl', 'brushed chrome', 'oil-slick foil'],
  accessory: ['visor', 'headphones', 'sling', 'scarf', 'harness', 'earrings', 'respirator', 'satchel'],
  hair: ['crop', 'swept', 'crest', 'bob', 'twin knots', 'braid', 'cap', 'undercut'],
  pattern: ['piping', 'chevrons', 'circuit', 'split stripe', 'checks', 'sunburst', 'ladder', 'patchwork'],
  palettes: [
    { name: 'Afterhours', primary: '#322443', secondary: '#131c2c', energy: '#ff70ce', metal: '#dfc5ec' },
    { name: 'Poolside', primary: '#36a8af', secondary: '#ef86b9', energy: '#a4fff1', metal: '#c9ecea' },
    { name: 'Taxi', primary: '#f4bb39', secondary: '#222733', energy: '#faffb0', metal: '#e3d5b0' },
    { name: 'Ceramic', primary: '#e5e8de', secondary: '#3f4f6e', energy: '#89cfff', metal: '#e2edfa' },
    { name: 'Infrared', primary: '#bc3655', secondary: '#242131', energy: '#ffab73', metal: '#e6bab0' },
    { name: 'Acid', primary: '#c5e547', secondary: '#3a2359', energy: '#ff8df3', metal: '#d7e1b0' },
    { name: 'Violet Hour', primary: '#7756bf', secondary: '#1b323e', energy: '#70f1ee', metal: '#bfc9ec' },
    { name: 'Copper Static', primary: '#bb7954', secondary: '#254448', energy: '#a2ffe5', metal: '#edc294' },
    { name: 'Bubblegum', primary: '#ee91b3', secondary: '#692f6b', energy: '#c0fffa', metal: '#f7d3e6' },
    { name: 'Petrol', primary: '#204c61', secondary: '#acbcd0', energy: '#ff7c9d', metal: '#b8e5eb' },
    { name: 'Champagne', primary: '#d6bd83', secondary: '#3b2c3f', energy: '#d1a5ff', metal: '#ffe7b4' },
    { name: 'Signal Blue', primary: '#426fe1', secondary: '#ee804e', energy: '#f7f5b0', metal: '#c9d9fa' }
  ]
};

export function identityHash(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ h >>> 16, 0x7feb352d);
  h = Math.imul(h ^ h >>> 15, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
}

const dispositions = [
  ['quietly observant', .25, .8, .6], ['warm and practical', .8, .7, .9],
  ['dryly funny', .6, .55, .5], ['restless and outspoken', .8, .25, .45],
  ['meticulous', .4, .65, .55], ['easygoing', .7, .9, .65],
  ['guarded but considerate', .2, .55, .8], ['bold and theatrical', .95, .4, .6]
];
const interests = [
  { name: 'old synth records', line: 'Found a recording with the crowd louder than the band. Kept it anyway.', reply: 'That is the part they always cut from the remasters.' },
  { name: 'repairing vintage clothes', line: 'This seam is older than either of us. I matched the thread this time.', reply: 'Leave one old stitch in. Let it have a history.' },
  { name: 'rooftop gardening', line: 'My cuttings finally rooted. I kept checking them every morning.', reply: 'Save one for me. I have a jar on the windowsill.' },
  { name: 'street photography', line: 'The stairwell looked beautiful before the sign switched off.', reply: 'Show me later. I only ever see it on the way to work.' },
  { name: 'night markets', line: 'Someone at the night market recognized a jacket I sold years ago.', reply: 'Did you tell them, or let it belong to someone else?' },
  { name: 'tiny radio builds', line: 'My receiver picks up the lift motor better than the music.', reply: 'Move the antenna off the handrail. Mine did that too.' },
  { name: 'community cooking', line: 'I wrote the recipe down, but the measurements are all different cups.', reply: 'Bring the cups. We will work it out together.' },
  { name: 'dance nights', line: 'I stayed for one last track. That was three tracks before closing.', reply: 'You always say one. Was the walk home worth it?' },
  { name: 'handmade jewelry', line: 'I made these from the contacts of a dead relay.', reply: 'That explains the tiny numbers. I thought they were dates.' },
  { name: 'local history', line: 'My neighbor remembers when this passage had an open roof.', reply: 'Ask if they want to record it. Do not assume they do.' },
  { name: 'skating the upper decks', line: 'They finally smoothed the joint by the west railing.', reply: 'Check the far end first. There was still a loose strip yesterday.' },
  { name: 'repairing arcade cabinets', line: 'The cabinet works again. Still has somebody else’s high score.', reply: 'Leave it there. Give the next person something to chase.' }
];
const ambitions = [
  'I am saving for a room with a window that opens.', 'I want to put on a small show for the block.',
  'I am teaching someone my trade, slowly.', 'I am trying to get my evenings back.',
  'I want to visit the basin when I can take a full day off.', 'I am putting a little aside for my family.',
  'I am learning to make things I used to buy.', 'I want a workshop where friends can borrow the tools.',
  'I am trying to finish something without turning it into another job.', 'I want to reopen the old club with an earlier last set.',
  'I am making a map of places you can sit without buying anything.', 'I am trying to keep one day a week free.'
];
const habits = [
  'checks every pocket before leaving', 'keeps handwritten reminders', 'polishes a favorite buckle',
  'counts the beat with one hand', 'straightens cuffs while thinking', 'checks the time twice',
  'listens before answering', 'fidgets with an old ear cuff', 'notices repairs other people miss',
  'holds on to reusable packaging', 'looks up at the sky between shifts', 'stretches after a long wait'
];
const signatureCuts = { iri: 'racer', sera: 'tailcoat', bram: 'moto', ves: 'poncho', archivist: 'duster', merchant: 'vest', mara: 'anorak', tovin: 'cape', ada: 'cropped', ilex: 'kimono', nella: 'bomber', elin: 'trench', merek: 'varsity', sable: 'hoodie', ivo: 'puffer' };
const workCuts = { cook: 'bomber', courier: 'racer', technician: 'moto', medic: 'vest', archivist: 'tailcoat', gardener: 'anorak', commuter: 'trench' };

export function npcIdentity(id, role = 'neighbor') {
  const sample = key => identityHash(`${id}:${key}`);
  const pick = (key, items) => items[sample(key) % items.length];
  const [temperament, social, patience, care] = pick('temperament', dispositions);
  const trait = (key, base) => Math.max(.05, Math.min(.95, base + (sample(key) / 4294967296 - .5) * .3));
  const personality = {
    temperament, interest: pick('interest', interests), ambition: pick('ambition', ambitions), habit: pick('habit', habits),
    sociability: trait('social', social), patience: trait('patience', patience), care: trait('care', care),
    assertiveness: sample('assertiveness') / 4294967296, phase: sample('gesture') % 628 / 100
  };
  const outfit = Object.fromEntries(['upper', 'lower', 'shoes', 'finish', 'accessory', 'hair', 'pattern'].map(key => [key, pick(key, NPC_WARDROBE[key])]));
  outfit.upper = signatureCuts[id] || (sample('workwear') % 3 === 0 && workCuts[role]) || outfit.upper;
  outfit.palette = sample('palette') % NPC_WARDROBE.palettes.length;
  outfit.hairColor = pick('hairColor', ['#171e2b', '#e6d8c0', '#a44b68', '#67c7c2', '#9c78d8', '#d57648', '#b2bd62', '#8097b0']);
  outfit.skin = sample('skin') % 8;
  return { outfit, personality };
}

export const outfitKey = outfit => ['upper', 'lower', 'shoes', 'finish', 'accessory', 'hair', 'pattern', 'palette', 'hairColor', 'skin'].map(key => outfit[key]).join(':');
export const outfitDescription = outfit => `${NPC_WARDROBE.palettes[outfit.palette].name} ${outfit.upper}, ${outfit.finish}, ${outfit.lower} bottoms and ${outfit.shoes}; ${outfit.accessory}.`;

export function outfitParts(outfit, race = 'human') {
  const parts = [], p = NPC_WARDROBE.palettes[outfit.palette];
  // [8,13) is an opaque clothing material in the shared scene shader.
  const fabric = 8 + NPC_WARDROBE.finish.indexOf(outfit.finish), dark = '#18212e';
  const skins = { lattice: ['#8299ad', '#b9cddd'], revenant: ['#8b778e', '#bcabb7'], bloom: ['#6e8871', '#adbd8e'] }[race] || ['#593c35', '#735042', '#8b6250', '#a2745d', '#b88b70', '#c99e85', '#dfb79c', '#ebccb0'];
  const skin = skins[outfit.skin % skins.length];
  const add = (joint, center, size, color = p.primary, extra = {}) => parts.push({ joint, center, size, color, shape: 'bevel', emissive: fabric, ...extra });
  const trim = (joint, center, size, extra = {}) => add(joint, center, size, p.energy, { emissive: .65, shape: 'box', detailOnly: true, ...extra });
  const metal = (joint, center, size, extra = {}) => add(joint, center, size, p.metal, { emissive: 11, ...extra });
  const bare = (joint, center, size) => add(joint, center, size, skin, { emissive: 8 });
  const cut = outfit.upper, cropped = ['cropped', 'bolero'].includes(cut), puff = ['bomber', 'puffer', 'varsity'].includes(cut);
  const width = ['poncho', 'cape'].includes(cut) ? .96 : puff ? .84 : .72;
  add('body', [0, .28, 0], [.64, .64, .38], p.secondary, { taper: .82, emissive: 8 });
  add('body', [0, cropped ? .48 : .32, -.015], [width, cropped ? .28 : .59, puff ? .51 : .43], p.primary, { taper: puff ? .92 : .8 });
  add('body', [0, .02, .015], [.66, .09, .45], dark, { emissive: 8 });
  metal('body', [.12, .02, .257], [.13, .075, .035]);
  bare('body', [0, .67, 0], [.22, .18, .23]);
  add('head', [0, .09, 0], [.36, .43, .32], skin, { shape: 'round', emissive: 8 });
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'left' : 'right';
    const sleeve = !['vest', 'bolero'].includes(cut), short = ['kimono', 'cropped'].includes(cut);
    add(side + 'Arm', [0, -.14, 0], [puff ? .34 : cut === 'kimono' ? .4 : .27, short ? .28 : .36, puff ? .36 : .3], sleeve ? cut === 'varsity' ? p.secondary : p.primary : skin, { emissive: sleeve ? fabric : 8 });
    add(side + 'Forearm', [0, -.15, 0], [cut === 'kimono' ? .32 : .24, .3, .26], short || !sleeve ? skin : p.primary, { emissive: short || !sleeve ? 8 : fabric });
    bare(side + 'Forearm', [0, -.34, .02], [.19, .15, .22]);
    metal(side + 'Forearm', [0, -.265, 0], [.255, .045, .28]);
    trim(side + 'Arm', [s * .145, -.15, .09], [.025, .23, .045]);
    const lower = outfit.lower, wide = ['wide', 'pleated'].includes(lower), shorts = lower === 'shorts', asym = lower === 'asymmetric' && s > 0;
    add(side + 'Thigh', [0, shorts ? -.14 : -.22, 0], [wide ? .37 : .29, shorts ? .28 : .46, wide ? .37 : .31], p.secondary, { taper: lower === 'joggers' ? 1.1 : 1 });
    if (shorts) bare(side + 'Thigh', [0, -.36, 0], [.25, .2, .28]);
    add(side + 'Shin', [0, -.24, 0], [wide ? .34 : lower === 'flare' ? .37 : .23, .44, wide || lower === 'flare' ? .34 : .25], shorts || asym ? skin : p.secondary, { taper: lower === 'flare' ? 1.4 : lower === 'joggers' ? .7 : 1, emissive: shorts || asym ? 8 : fabric });
    if (lower === 'cargo') add(side + 'Thigh', [s * .17, -.22, .02], [.12, .23, .27], p.primary);
    if (lower === 'joggers') add(side + 'Shin', [0, -.43, 0], [.27, .075, .28], p.primary);
    if (lower === 'pleated') for (let i = 0; i < 3; i++) add(side + 'Coat', [(i - 1) * .12, -.22, .2], [.14, .5, .16], i % 2 ? p.secondary : p.primary, { taper: 1.25 });
    if (lower === 'asymmetric' && s < 0) metal(side + 'Thigh', [0, -.1, .17], [.27, .17, .05]);
    trim(side + 'Thigh', [s * .14, -.2, .16], [.025, .34, .025]);
    const shoe = outfit.shoes, platform = shoe === 'platforms', boot = ['combat boots', 'pointed boots', 'high tops'].includes(shoe);
    add(side + 'Foot', [0, -.005, .13], [platform ? .36 : .3, platform ? .23 : .17, shoe === 'pointed boots' ? .62 : .48], shoe === 'runners' ? p.secondary : p.primary, { taper: shoe === 'pointed boots' ? .6 : 1 });
    add(side + 'Foot', [0, -.08, .13], [platform ? .38 : .32, platform ? .12 : .055, .5], dark, { emissive: 8 });
    if (boot) add(side + 'Shin', [0, -.36, 0], [.28, shoe === 'combat boots' ? .3 : .19, .29], p.primary);
    if (shoe === 'split toes') add(side + 'Foot', [s * .075, .06, .33], [.045, .035, .18], dark, { emissive: 8 });
    trim(side + 'Foot', [0, -.065, .385], [.26, .025, .025]);
    if (['trench', 'duster', 'tailcoat'].includes(cut)) {
      const length = cut === 'duster' ? .85 : cut === 'tailcoat' ? .7 : .59;
      add(side + 'Coat', [0, -length / 2, -.1], [.42, length, .22], p.primary, { taper: 1.2 });
      trim(side + 'Coat', [s * .18, -length / 2, .02], [.025, length * .9, .025]);
    }
  }
  // Every cut changes structure, not just paint or a descriptive label.
  if (['bomber', 'puffer'].includes(cut)) for (let i = 0; i < (cut === 'puffer' ? 4 : 2); i++) add('body', [0, .15 + i * .13, .25], [width * .94, .11, .09], i % 2 ? p.secondary : p.primary);
  if (['racer', 'moto', 'trench', 'tailcoat'].includes(cut)) for (const s of [-1, 1]) add('body', [s * .18, .49, .24], [.18, .3, .065], cut === 'moto' ? p.metal : p.secondary, { roll: s * .32, emissive: cut === 'moto' ? 11 : fabric });
  if (cut === 'racer') add('body', [.26, .32, .245], [.1, .52, .055], p.energy, { emissive: 8 });
  if (cut === 'poncho') for (const s of [-1, 1]) add('body', [s * .28, .27, .16], [.48, .67, .28], s < 0 ? p.primary : p.secondary, { roll: s * .18, taper: 1.3 });
  if (cut === 'hoodie') { add('body', [0, .68, -.11], [.57, .4, .41], p.primary);add('body', [0, .16, .245], [.47, .2, .07], p.secondary); }
  if (cut === 'kimono') for (const s of [-1, 1]) add('body', [s * .13, .35, .25], [.16, .56, .055], p.secondary, { roll: s * .42 });
  if (cut === 'cape') add('leftCoat', [-.1, .02, -.21], [.66, 1.2, .13], p.secondary, { roll: -.16 });
  if (cut === 'cropped') add('body', [0, .56, .25], [.66, .07, .06], p.secondary);
  if (cut === 'bolero') for (const s of [-1, 1]) add('body', [s * .3, .49, .19], [.2, .32, .16], p.primary, { roll: s * .4 });
  if (cut === 'vest') for (const s of [-1, 1]) add('body', [s * .22, .22, .245], [.2, .23, .1], p.secondary);
  if (cut === 'varsity') add('body', [-.22, .43, .27], [.16, .19, .035], p.metal, { emissive: 8 });
  if (cut === 'anorak') { add('body', [0, .18, .28], [.58, .24, .12], p.secondary);add('body', [0, .63, -.035], [.51, .18, .43], p.primary); }
  if (cut === 'duster') add('body', [0, .65, -.04], [.51, .24, .44], p.secondary);
  const pattern = NPC_WARDROBE.pattern.indexOf(outfit.pattern);
  for (let i = 0; i < 3; i++) trim('body', [(pattern % 3 - 1) * .18 + (pattern === 5 ? (i - 1) * .1 : 0), .2 + i * .115, .325], [pattern % 2 ? .2 : .035, pattern % 2 ? .025 : .09, .025], { roll: pattern === 1 ? (i % 2 ? -.7 : .7) : pattern === 6 ? .35 : 0 });
  // Hair and headwear remain visible at the cheap box LOD.
  add('head', [0, .29, -.03], [.39, .13, .32], outfit.hairColor, { emissive: 8 });
  const hair = outfit.hair;
  if (hair === 'swept' || hair === 'undercut') add('head', [hair === 'swept' ? .06 : -.08, .33, .015], [.3, .15, .34], outfit.hairColor, { roll: .28, emissive: 8 });
  if (hair === 'crest') add('head', [0, .41, -.01], [.09, .29, .34], outfit.hairColor, { emissive: 8 });
  if (hair === 'bob') for (const s of [-1, 1]) add('head', [s * .195, .1, -.03], [.105, .4, .31], outfit.hairColor, { emissive: 8 });
  if (hair === 'twin knots') for (const s of [-1, 1]) add('head', [s * .2, .35, -.08], [.2, .2, .2], outfit.hairColor, { shape: 'round', emissive: 8 });
  if (hair === 'braid') for (let i = 0; i < 3; i++) add('head', [i % 2 * .035, .12 - i * .15, -.21], [.12, .18, .12], outfit.hairColor, { emissive: 8 });
  if (hair === 'cap') { add('head', [0, .32, 0], [.44, .16, .37], p.secondary);add('head', [0, .26, .21], [.44, .045, .26], p.primary); }
  const a = outfit.accessory;
  if (a === 'visor') { add('head', [0, .15, .19], [.41, .11, .06], dark, { emissive: 11 });trim('head', [0, .15, .225], [.34, .035, .02], { detailOnly: false }); }
  if (a === 'headphones') { for (const s of [-1, 1]) metal('head', [s * .235, .12, -.015], [.1, .23, .22]);metal('head', [0, .37, -.03], [.48, .045, .08]); }
  if (a === 'sling' || a === 'satchel') { add('body', [a === 'sling' ? .06 : -.33, a === 'sling' ? .31 : -.08, .31], [a === 'sling' ? .43 : .3, .25, .13], p.secondary);metal('body', [0, .35, .34], [.06, .65, .045], { roll: -.55 }); }
  if (a === 'scarf') { add('body', [0, .64, .02], [.48, .16, .4], p.secondary);add('body', [-.23, .35, .3], [.18, .52, .07], p.secondary); }
  if (a === 'harness') for (const s of [-1, 1]) metal('body', [s * .18, .33, .3], [.065, .59, .055], { roll: s * .15 });
  if (a === 'earrings') for (const s of [-1, 1]) metal('head', [s * .22, -.015, .08], [.055, .22, .055]);
  if (a === 'respirator') { add('head', [0, -.04, .17], [.29, .13, .09], p.secondary);for (const s of [-1, 1]) metal('head', [s * .13, -.04, .23], [.09, .1, .08]); }
  // Eyes and subtle facial hardware keep uncovered faces readable.
  for (const s of [-1, 1]) add('head', [s * .09, .13, .166], [.045, .025, .015], dark, { emissive: 8, shape: 'box', detailOnly: true });
  metal('head', [.17, .025, .14], [.025, .1, .035], { detailOnly: true });
  return parts;
}

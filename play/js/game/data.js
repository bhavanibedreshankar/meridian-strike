// Static game data: fictional league, teams, tiers, difficulty profiles, cosmetics.
// All names, clubs, and branding are original — no resemblance to real leagues, clubs, or athletes.

export const LEAGUE_NAME = 'Meridian League';

const FIRST = ['Aro', 'Bex', 'Cael', 'Dario', 'Ezel', 'Falk', 'Giro', 'Hale', 'Ivo', 'Joss', 'Kade', 'Luth',
  'Miro', 'Nyle', 'Oren', 'Pax', 'Quill', 'Rive', 'Soren', 'Tave', 'Ulric', 'Vane', 'Wren', 'Xylo', 'Yorick', 'Zephyr'];
const LAST = ['Ashvale', 'Brandt', 'Corvo', 'Dunmore', 'Ellison', 'Fenwick', 'Garrick', 'Holt', 'Ironwood',
  'Jarvis', 'Kestrel', 'Lockwood', 'Marsh', 'Northgate', 'Osprey', 'Pellar', 'Quintrell', 'Redmane', 'Stroud',
  'Thorne', 'Umber', 'Vasser', 'Wilder', 'Yarrow'];

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function generateSquadNames(teamIndex) {
  const rnd = seededRandom(1000 + teamIndex * 77);
  const names = [];
  const used = new Set();
  while (names.length < 11) {
    const n = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
    if (!used.has(n)) { used.add(n); names.push(n); }
  }
  return names;
}

// kit: [shirt, shorts, socks] hex colors. gkKit distinct.
export const TEAMS = [
  { id: 'aurora', name: 'Aurora Wanderers', short: 'AUR', rating: 78, kit: [0x2e9df2, 0xffffff, 0x2e9df2], kit2: [0xf2f2f2, 0x123, 0xdddddd], gkKit: [0xd6ce27, 0x222222, 0xd6ce27] },
  { id: 'ironforge', name: 'Ironforge Athletic', short: 'IRN', rating: 82, kit: [0xd42b2b, 0x1a1a1a, 0xd42b2b], kit2: [0xececec, 0x333333, 0xececec], gkKit: [0x39c46a, 0x111111, 0x39c46a] },
  { id: 'solace', name: 'Solace City', short: 'SOL', rating: 75, kit: [0xffffff, 0x0c2a5e, 0xffffff], kit2: [0xff8a2a, 0x222222, 0xff8a2a], gkKit: [0xbf4fd1, 0x111111, 0xbf4fd1] },
  { id: 'northgate', name: 'Northgate United', short: 'NGU', rating: 80, kit: [0x14a05a, 0xffffff, 0x14a05a], kit2: [0x11151d, 0x11151d, 0x2a3450], gkKit: [0xe07820, 0x111111, 0xe07820] },
  { id: 'vespera', name: 'Vespera FC', short: 'VSP', rating: 73, kit: [0x6b2fb3, 0xffffff, 0x6b2fb3], kit2: [0xf5e642, 0x333333, 0xf5e642], gkKit: [0x2ec4c4, 0x111111, 0x2ec4c4] },
  { id: 'cindral', name: 'Cindral Rovers', short: 'CIN', rating: 77, kit: [0xff7f1f, 0x14213d, 0xff7f1f], kit2: [0xdfe8f5, 0x14213d, 0xdfe8f5], gkKit: [0x8bd42b, 0x111111, 0x8bd42b] },
  { id: 'thalassa', name: 'Thalassa Port', short: 'THA', rating: 71, kit: [0x0e6f74, 0xffffff, 0x0e6f74], kit2: [0xf2c14e, 0x0e6f74, 0xf2c14e], gkKit: [0xd14f8c, 0x111111, 0xd14f8c] },
  { id: 'brava', name: 'Brava Meridian', short: 'BRV', rating: 84, kit: [0x101418, 0xe8c547, 0x101418], kit2: [0xe8c547, 0x101418, 0xe8c547], gkKit: [0x4287f5, 0x111111, 0x4287f5] },
];

export const TIERS = [
  { name: 'Amateur', winsToPromote: 3, stadium: 'small', lighting: 'day', crowdDensity: 0.35, rewardHint: '100 coins per win' },
  { name: 'Semi-Pro', winsToPromote: 5, stadium: 'medium', lighting: 'dusk', crowdDensity: 0.6, rewardHint: '180 coins per win' },
  { name: 'Professional', winsToPromote: 8, stadium: 'large', lighting: 'floodlit', crowdDensity: 0.85, rewardHint: '300 coins per win' },
  { name: 'Elite', winsToPromote: Infinity, stadium: 'grand', lighting: 'floodlit', crowdDensity: 1.0, rewardHint: '500 coins per win' },
];

// Difficulty is what makes tiers feel different: reaction latency, decision quality,
// positioning discipline, pass/shot error, pressing, GK reflexes — not just speed.
export const DIFFICULTY = [
  { // Amateur
    name: 'Amateur', reactionMs: 650, decisionIntervalMs: 1100, bestChoiceProb: 0.45,
    passErrorRad: 0.22, shotErrorRad: 0.16, positionDiscipline: 0.45, pressingDist: 6,
    gkReflexMs: 420, gkDiveSkill: 0.55, offsideAwareness: 0.3, tackleAggression: 0.35,
    supportRunProb: 0.25, speedMult: 0.92,
  },
  { // Semi-Pro
    name: 'Semi-Pro', reactionMs: 450, decisionIntervalMs: 850, bestChoiceProb: 0.62,
    passErrorRad: 0.14, shotErrorRad: 0.11, positionDiscipline: 0.65, pressingDist: 9,
    gkReflexMs: 330, gkDiveSkill: 0.7, offsideAwareness: 0.55, tackleAggression: 0.5,
    supportRunProb: 0.45, speedMult: 0.97,
  },
  { // Professional
    name: 'Professional', reactionMs: 300, decisionIntervalMs: 620, bestChoiceProb: 0.78,
    passErrorRad: 0.08, shotErrorRad: 0.07, positionDiscipline: 0.82, pressingDist: 12,
    gkReflexMs: 250, gkDiveSkill: 0.83, offsideAwareness: 0.78, tackleAggression: 0.68,
    supportRunProb: 0.65, speedMult: 1.0,
  },
  { // Elite
    name: 'Elite', reactionMs: 180, decisionIntervalMs: 450, bestChoiceProb: 0.92,
    passErrorRad: 0.045, shotErrorRad: 0.045, positionDiscipline: 0.95, pressingDist: 16,
    gkReflexMs: 180, gkDiveSkill: 0.93, offsideAwareness: 0.93, tackleAggression: 0.85,
    supportRunProb: 0.85, speedMult: 1.04,
  },
];

export const FORMATIONS = {
  '4-4-2': [ // [x fraction of own half toward opponent (-1 own goal .. 1 opp goal), z fraction of width]
    { r: 'GK', x: -0.96, z: 0 },
    { r: 'DF', x: -0.62, z: -0.62 }, { r: 'DF', x: -0.68, z: -0.22 }, { r: 'DF', x: -0.68, z: 0.22 }, { r: 'DF', x: -0.62, z: 0.62 },
    { r: 'MF', x: -0.18, z: -0.68 }, { r: 'MF', x: -0.25, z: -0.22 }, { r: 'MF', x: -0.25, z: 0.22 }, { r: 'MF', x: -0.18, z: 0.68 },
    { r: 'FW', x: 0.28, z: -0.18 }, { r: 'FW', x: 0.28, z: 0.18 },
  ],
  '4-3-3': [
    { r: 'GK', x: -0.96, z: 0 },
    { r: 'DF', x: -0.62, z: -0.6 }, { r: 'DF', x: -0.68, z: -0.2 }, { r: 'DF', x: -0.68, z: 0.2 }, { r: 'DF', x: -0.62, z: 0.6 },
    { r: 'MF', x: -0.3, z: -0.35 }, { r: 'MF', x: -0.22, z: 0 }, { r: 'MF', x: -0.3, z: 0.35 },
    { r: 'FW', x: 0.3, z: -0.55 }, { r: 'FW', x: 0.36, z: 0 }, { r: 'FW', x: 0.3, z: 0.55 },
  ],
  '5-3-2': [
    { r: 'GK', x: -0.96, z: 0 },
    { r: 'DF', x: -0.58, z: -0.7 }, { r: 'DF', x: -0.68, z: -0.35 }, { r: 'DF', x: -0.72, z: 0 }, { r: 'DF', x: -0.68, z: 0.35 }, { r: 'DF', x: -0.58, z: 0.7 },
    { r: 'MF', x: -0.22, z: -0.4 }, { r: 'MF', x: -0.28, z: 0 }, { r: 'MF', x: -0.22, z: 0.4 },
    { r: 'FW', x: 0.3, z: -0.16 }, { r: 'FW', x: 0.3, z: 0.16 },
  ],
};

export const MENTALITIES = {
  defensive: { lineShift: -0.16, pressBoost: 0.8, supportBoost: 0.7 },
  balanced: { lineShift: 0, pressBoost: 1.0, supportBoost: 1.0 },
  attacking: { lineShift: 0.16, pressBoost: 1.15, supportBoost: 1.35 },
};

// Visual definitions for purchasable cosmetics (server owns prices/ownership).
export const KIT_VISUALS = {
  kit_default: null, // team's own kit
  kit_volt: [0xd8ff1f, 0x101010, 0xd8ff1f],
  kit_royal: [0x2743d1, 0xe8c547, 0x2743d1],
  kit_obsidian: [0x17131c, 0x3c2a5e, 0x17131c],
};
export const STADIUM_VISUALS = {
  stadium_default: null,
  stadium_sunset: { sky: 0xff9a5e, horizon: 0xffd9a0, lighting: 'dusk' },
  stadium_neon: { sky: 0x0a0a2a, horizon: 0x36f, lighting: 'floodlit', accent: 0x36e0ff },
};
export const CELEBRATIONS = ['celebration_default', 'celebration_knee_slide', 'celebration_backflip', 'celebration_robot'];

export const AD_BRANDS = ['VOLTA COLA', 'AERONEX', 'MERIDIAN LEAGUE', 'KESTREL SPORTS', 'LUMENBANK', 'ORBIT TELECOM'];

export const PITCH = { length: 105, width: 68, goalWidth: 7.32, goalHeight: 2.44, boxLength: 16.5, boxWidth: 40.3, sixLength: 5.5, sixWidth: 18.32, penaltySpot: 11, circleR: 9.15 };

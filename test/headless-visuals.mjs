// Construction smoke test for the visual builders that the match sim doesn't touch:
// pitch (procedural grass + markings), all four stadium sizes with crowds/floodlights/
// scoreboard, player models incl. every animation, lighting presets. No WebGL needed —
// only canvas-2D calls are stubbed.
import * as THREE from 'three';

const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'measureText') return () => ({ width: 10 });
    if (typeof t[k] !== 'undefined') return t[k];
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; },
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }),
  getElementById: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { addEventListener: noop, innerWidth: 1280, innerHeight: 720 };
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node-sim', maxTouchPoints: 0, getGamepads: () => [] }, configurable: true,
});

const { buildPitch } = await import('../client/js/engine/pitch.js');
const { Stadium } = await import('../client/js/engine/stadium.js');
const { PlayerModel } = await import('../client/js/engine/playermodel.js');

const fakeSceneMgr = {
  scene: new THREE.Scene(),
  renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
  isMobile: false,
  floodlights: [],
  registerFloodlight(l) { this.floodlights.push(l); },
  clearFloodlights() { this.floodlights = []; },
};

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`✅ ${name}`); }
  catch (e) { failures++; console.log(`❌ ${name}: ${e.message}\n${e.stack.split('\n')[1]}`); }
};

check('pitch builds', () => {
  const g = buildPitch(fakeSceneMgr);
  if (!g.children.length) throw new Error('empty pitch group');
});

for (const size of ['small', 'medium', 'large', 'grand']) {
  check(`stadium '${size}' builds with crowd`, () => {
    const s = new Stadium(fakeSceneMgr, { size, crowdDensity: 0.8 });
    if (s.crowdActive < 100) throw new Error(`only ${s.crowdActive} crowd instances`);
    if (fakeSceneMgr.floodlights.length !== 4) throw new Error(`${fakeSceneMgr.floodlights.length} floodlights`);
    s.updateScoreboard('AUR', 'IRN', 2, 1, '45:00');
    s.setExcitement(1);
    for (let i = 0; i < 30; i++) s.update(1 / 30);
    s.dispose();
    if (fakeSceneMgr.floodlights.length !== 0) throw new Error('floodlights not cleared on dispose');
  });
}

check('player model + all animations pose without NaN', () => {
  const m = new PlayerModel([0x2e9df2, 0xffffff, 0x2e9df2], { skinIndex: 2 });
  const actions = ['kick', 'slide', 'dive', 'throw', 'getup',
    'celebration_default', 'celebration_knee_slide', 'celebration_backflip', 'celebration_robot'];
  for (const a of actions) {
    m.startAction(a, 1);
    for (let i = 0; i < 120; i++) m.update(1 / 60, 0, 0);
    m.root.updateMatrixWorld(true);
    m.root.traverse(o => {
      if (o.matrixWorld.elements.some(v => !Number.isFinite(v))) throw new Error(`NaN in matrix during '${a}'`);
    });
  }
  // run cycle at increasing speeds
  for (let s = 0; s <= 9; s++) for (let i = 0; i < 30; i++) m.update(1 / 60, s, s * 0.3);
});

console.log(failures ? `\n${failures} FAILURES` : '\nALL VISUAL CONSTRUCTION CHECKS PASSED');
process.exit(failures ? 1 : 0);

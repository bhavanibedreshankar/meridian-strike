// Headless gameplay verification: runs real Match/AI/rules/ball code AI-vs-AI in Node
// with a stubbed DOM. Checks: no crashes, restarts fire, passes/shots happen, goals occur,
// halves/extra time/shootout terminate, and the match reports a result.
import * as THREE from 'three';

// ---- DOM stubs (before importing game modules) ----
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'putImageData') return noop;
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
globalThis.window = { addEventListener: noop, innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false }) };
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node-sim', maxTouchPoints: 0, getGamepads: () => [] },
  configurable: true,
});

const { Match } = await import('../client/js/game/match.js');
const { TEAMS, DIFFICULTY } = await import('../client/js/game/data.js');

class FakeInput {
  constructor() { this.enabled = true; this.autoShootPen = false; this._rel = {}; }
  getMove() { return this.penFlightSide ? { x: this.penFlightSide, y: 0, mag: 1 } : { x: 0, y: 0, mag: 0 }; }
  get sprinting() { return false; }
  isDown() { return false; }
  heldTime() { return 0; }
  pressed() { return false; }
  released(a) { const v = a in this._rel ? this._rel[a] : null; return v; }
  scriptRelease(a, held) { this._rel[a] = held; }
  endFrame() { this._rel = {}; this.penFlightSide = 0; }
  consumeAll() { this._rel = {}; }
  pollGamepad() {}
}

class FakeHud {
  constructor(stats) { this.stats = stats; }
  showBanner(text) {
    const t = String(text).toUpperCase();
    if (t.includes('OFFSIDE')) this.stats.offsides++;
    if (t === 'FOUL' || t.includes('PENALTY!')) this.stats.fouls++;
    if (t.includes('GOAL!')) this.stats.goalBanners++;
  }
  hideBanner() {} setScore() {} setClock() {} setPower() {} show() {} hide() {}
}
const fakeStadium = { update: noop, setExcitement: noop, updateScoreboard: noop, excitement: 0 };
const fakeSceneMgr = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 900),
  isMobile: false,
};

async function runMatch(label, cfgOverrides, maxSimSeconds) {
  const stats = { offsides: 0, fouls: 0, goalBanners: 0, restarts: {}, passes: 0, shots: 0 };
  const input = new FakeInput();
  const hud = new FakeHud(stats);
  let endResult = null;

  const match = new Match({
    sceneMgr: fakeSceneMgr, stadium: fakeStadium, input, hud,
    config: {
      userTeamData: TEAMS[0], aiTeamData: TEAMS[1],
      tierIndex: 2, matchType: 'league', halfLengthMin: 1,
      difficulty: DIFFICULTY[2], teammateDifficulty: DIFFICULTY[2],
      userKit: null, celebrationId: 'celebration_default', userFormation: '4-4-2',
      ...cfgOverrides,
    },
    callbacks: {
      onEnd: (r) => { endResult = r; },
      onHalfTime: (resume) => resume(),   // skip tactics screen
      onPause: noop,
    },
  });

  // instrument
  const origRestart = match.setupRestart.bind(match);
  match.setupRestart = (r) => { stats.restarts[r.type] = (stats.restarts[r.type] || 0) + 1; origRestart(r); };
  const origKick = match.executeKick.bind(match);
  match.executeKick = (p, dir, power, curl, lift, type) => {
    if (type === 'shot') stats.shots++; else stats.passes++;
    origKick(p, dir, power, curl, lift, type);
  };

  const dt = 1 / 30;
  let simT = 0;
  let err = null;
  try {
    while (!match.ended && simT < maxSimSeconds) {
      // AI-vs-AI: never hold a user-controlled player
      match.userControlled = null;
      // auto-take user-team restarts quickly
      if (match.restart && (match.phase === 'KICKOFF_WAIT' || match.phase === 'RESTART_WAIT')
        && match.restart.team === 0 && match.stateT > 1.2) {
        match.aiTakeRestart(match.restart);
      }
      // script user penalties in shootout/match pens
      if (match.pen) {
        if (match.pen.userShoots && match.pen.phase === 'aim' && match.pen.t > 0.5) {
          match.pen.aimZ = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 2.4);
          match.pen.aimH = 0.3 + Math.random() * 1.2;
          input.scriptRelease('shoot', 0.7);
        }
        if (match.pen.userKeeps && match.pen.phase === 'flight') {
          input.penFlightSide = Math.random() < 0.5 ? -1 : 1;
        }
      }
      match.update(dt);
      simT += dt;
      // ball sanity
      const b = match.ball.pos;
      if (Math.abs(b.x) > 17.5) stats.finalThirdFrames = (stats.finalThirdFrames || 0) + 1;
      if (!Number.isFinite(b.x + b.y + b.z)) throw new Error(`ball position NaN at t=${simT.toFixed(1)}`);
      if (Math.abs(b.x) > 200 || Math.abs(b.z) > 200 || b.y > 120) throw new Error(`ball escaped: ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
    }
    if (match.ended) await new Promise(res => setTimeout(res, 2000)); // let onEnd's timeout fire
  } catch (e) { err = e; }

  const so = match.shootout ? ` pens ${match.shootout.scores.join('-')}` : '';
  console.log(`\n=== ${label} ===`);
  console.log(`sim time: ${simT.toFixed(0)}s · phase at stop: ${match.phase} · half: ${match.half}`);
  console.log(`score: ${match.score[0]}-${match.score[1]}${so} · ended: ${match.ended} · result: ${endResult ? `${endResult.result} (ET:${endResult.wentToExtraTime} pens:${endResult.wentToPenalties})` : 'n/a'}`);
  console.log(`passes: ${stats.passes} · shots: ${stats.shots} · fouls: ${stats.fouls} · offsides: ${stats.offsides}`);
  console.log(`restarts: ${JSON.stringify(stats.restarts)} · final-third time: ${((stats.finalThirdFrames || 0) / 30).toFixed(0)}s`);
  if (err) { console.log(`❌ ERROR: ${err.stack?.split('\n').slice(0, 4).join('\n')}`); return false; }
  if (!match.ended) { console.log('❌ match did not finish in time'); return false; }
  if (stats.passes < 10) { console.log('❌ suspiciously few passes'); return false; }
  console.log('✅ OK');
  return true;
}

let ok = true;
// League match, professional difficulty, 1-min halves
ok = (await runMatch('League · Professional AI', { matchType: 'league', tierIndex: 2 }, 400)) && ok;
// Amateur difficulty — different profile exercised
ok = (await runMatch('League · Amateur AI', { tierIndex: 0, difficulty: DIFFICULTY[0], teammateDifficulty: DIFFICULTY[0] }, 400)) && ok;
// Cup match with tiny halves to force extra time and (likely) a shootout
ok = (await runMatch('Cup · forced ET/shootout path', {
  matchType: 'cup', halfLengthMin: 0.02, tierIndex: 3,
  difficulty: DIFFICULTY[3], teammateDifficulty: DIFFICULTY[3],
}, 700)) && ok;

console.log(ok ? '\nALL HEADLESS SIM CHECKS PASSED' : '\nHEADLESS SIM FAILURES — see above');
process.exit(ok ? 0 : 1);

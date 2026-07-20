// Unified input: keyboard + gamepad (Gamepad API) + touch (virtual joystick & buttons).
// Actions: pass, through, shoot, slide, switch, pause. Move vector + sprint.
// Edge semantics: pressed(a) fires once on down; released(a) fires once on up with heldTime.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'shoot', KeyX: 'pass', KeyK: 'pass', KeyC: 'through', KeyL: 'through',
  KeyV: 'slide', KeyJ: 'slide', KeyQ: 'switch', KeyE: 'switch', Tab: 'switch',
  KeyP: 'pause', Escape: 'pause',
};
const ACTIONS = ['pass', 'through', 'shoot', 'slide', 'switch', 'pause', 'sprint'];
// standard gamepad: A=0 pass, B=1 slide, X=2 shoot, Y=3 through, RB=5 switch, RT=7 sprint, Start=9 pause
const PADMAP = { 0: 'pass', 1: 'slide', 2: 'shoot', 3: 'through', 5: 'switch', 7: 'sprint', 9: 'pause' };

export class Input {
  constructor() {
    this.keys = new Set();
    this.down = {};        // action -> true while held
    this.downSince = {};   // action -> timestamp
    this._pressed = new Set();
    this._released = {};   // action -> heldTime
    this.touchMove = { x: 0, y: 0, active: false };
    this.usingTouch = false;
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (this.enabled) e.preventDefault();
      if (['up', 'down', 'left', 'right'].includes(a)) { this.keys.add(a); return; }
      this._setDown(a, true);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (['up', 'down', 'left', 'right'].includes(a)) { this.keys.delete(a); return; }
      this._setDown(a, false);
    });
    window.addEventListener('blur', () => { this.keys.clear(); ACTIONS.forEach(a => this._setDown(a, false, true)); });

    this._initTouch();
    this.padButtonsPrev = [];
  }

  _setDown(a, isDown, silent = false) {
    if (isDown && !this.down[a]) {
      this.down[a] = true;
      this.downSince[a] = performance.now();
      this._pressed.add(a);
    } else if (!isDown && this.down[a]) {
      this.down[a] = false;
      if (!silent) this._released[a] = (performance.now() - (this.downSince[a] || 0)) / 1000;
    }
  }

  _initTouch() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');
    if (!zone) return;
    let touchId = null, origin = null;
    const R = 55;
    zone.addEventListener('touchstart', (e) => {
      this.usingTouch = true;
      const t = e.changedTouches[0];
      touchId = t.identifier;
      origin = { x: t.clientX, y: t.clientY };
      base.style.display = 'block';
      base.style.left = (t.clientX - R) + 'px';
      base.style.top = (t.clientY - R) + 'px';
      this.touchMove.active = true;
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        let dx = t.clientX - origin.x, dy = t.clientY - origin.y;
        const len = Math.hypot(dx, dy);
        if (len > R) { dx = dx / len * R; dy = dy / len * R; }
        knob.style.left = (29 + dx) + 'px';
        knob.style.top = (29 + dy) + 'px';
        this.touchMove.x = dx / R;
        this.touchMove.y = dy / R;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        touchId = null;
        base.style.display = 'none';
        knob.style.left = '29px'; knob.style.top = '29px';
        this.touchMove = { x: 0, y: 0, active: false };
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);

    document.querySelectorAll('.tbtn').forEach(btn => {
      const a = btn.dataset.action;
      btn.addEventListener('touchstart', (e) => { this.usingTouch = true; this._setDown(a, true); e.preventDefault(); }, { passive: false });
      btn.addEventListener('touchend', (e) => { this._setDown(a, false); e.preventDefault(); }, { passive: false });
      btn.addEventListener('touchcancel', () => this._setDown(a, false));
    });
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (!this.pad) return;
    const prev = this.padButtonsPrev;
    this.pad.buttons.forEach((b, i) => {
      const a = PADMAP[i];
      if (!a) return;
      const isDown = b.pressed || b.value > 0.4;
      if (isDown !== !!prev[i]) this._setDown(a, isDown);
      prev[i] = isDown;
    });
  }

  // Move vector in screen space: x right, y up-the-screen. Camera looks down -Z-ish from +Z,
  // so screen-up = -Z world, screen-right = +X world. Match maps this to world.
  getMove() {
    let x = 0, y = 0;
    if (this.keys.has('left')) x -= 1;
    if (this.keys.has('right')) x += 1;
    if (this.keys.has('up')) y += 1;
    if (this.keys.has('down')) y -= 1;
    if (this.pad) {
      const ax = this.pad.axes[0] || 0, ay = this.pad.axes[1] || 0;
      if (Math.abs(ax) > 0.18) x += ax;
      if (Math.abs(ay) > 0.18) y -= ay;
    }
    if (this.touchMove.active) {
      x += this.touchMove.x;
      y -= this.touchMove.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, mag: Math.min(len, 1) };
  }

  get sprinting() {
    return !!this.down.sprint || (this.touchMove.active && Math.hypot(this.touchMove.x, this.touchMove.y) > 0.92);
  }

  isDown(a) { return !!this.down[a]; }
  heldTime(a) { return this.down[a] ? (performance.now() - this.downSince[a]) / 1000 : 0; }

  // Call once per frame AFTER consuming edges
  endFrame() {
    this._pressed.clear();
    this._released = {};
  }
  pressed(a) { return this._pressed.has(a); }
  released(a) { return a in this._released ? this._released[a] : null; }

  consumeAll() { this._pressed.clear(); this._released = {}; }
}

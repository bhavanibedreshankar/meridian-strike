import * as THREE from 'three';

// Ball with gravity, air drag, Magnus (spin→curve), bounce, and rolling friction.
const G = -22;            // slightly heavy gravity feels better at game scale
const AIR_DRAG = 0.012;
const MAGNUS = 0.09;
const BOUNCE = 0.58;
const ROLL_FRICTION = 1.35;
const SPIN_DECAY = 0.85;
export const BALL_R = 0.11;

function buildBallTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#1a1a2a';
  // classic pentagon-ish dot pattern (equirect-mapped)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const px = x * 32 + (y % 2) * 16, py = y * 32 + 16;
      g.beginPath();
      g.arc(px, py, 7, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Ball {
  constructor(scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 18, 14),
      new THREE.MeshStandardMaterial({ map: buildBallTexture(), roughness: 0.35 })
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(0, BALL_R, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3(); // rad/s, axis = spin axis
    this.lastToucherId = -1;
    this.lastTouchTeam = -1;
    this._rotAxis = new THREE.Vector3();
  }

  place(x, z) {
    this.pos.set(x, BALL_R, z);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.mesh.position.copy(this.pos);
  }

  // dir: normalized THREE.Vector3 (y allowed), power m/s, curl −1..1 (side spin), loft adds vertical
  kick(dir, power, curl = 0, lift = 0) {
    this.vel.copy(dir).multiplyScalar(power);
    this.vel.y += lift * power;
    // side spin around Y creates curve; top/back spin around horizontal axis
    this.spin.set(0, -curl * 14, 0);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.spin.addScaledVector(side, -lift * 6); // backspin on lofted balls
  }

  get onGround() { return this.pos.y <= BALL_R + 0.02; }
  get speed() { return this.vel.length(); }

  update(dt) {
    // integrate with substeps for stable bounces at high speed
    const steps = this.vel.length() > 30 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h);
    this.mesh.position.copy(this.pos);
    // visual roll
    const sp = this.vel.length();
    if (sp > 0.1) {
      this._rotAxis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(this._rotAxis, (sp / BALL_R) * dt * 0.6);
    }
  }

  _step(dt) {
    const v = this.vel;
    // gravity
    if (this.pos.y > BALL_R + 0.001 || v.y > 0) v.y += G * dt;
    // drag
    const sp = v.length();
    if (sp > 0.01) {
      const drag = AIR_DRAG * sp;
      v.multiplyScalar(Math.max(0, 1 - drag * dt));
    }
    // Magnus force: a = k * (spin × v)
    if (sp > 2 && this.spin.lengthSq() > 0.5 && this.pos.y > BALL_R * 1.5) {
      const m = new THREE.Vector3().crossVectors(this.spin, v).multiplyScalar(MAGNUS * dt);
      v.add(m);
    }
    this.pos.addScaledVector(v, dt);
    // ground contact
    if (this.pos.y < BALL_R) {
      this.pos.y = BALL_R;
      if (v.y < -1.2) {
        v.y = -v.y * BOUNCE;
        v.x *= 0.85; v.z *= 0.85;
        this.spin.multiplyScalar(0.7);
      } else {
        v.y = 0;
        // rolling friction
        const hs = Math.hypot(v.x, v.z);
        if (hs > 0.01) {
          const f = Math.max(0, hs - ROLL_FRICTION * dt) / hs;
          v.x *= f; v.z *= f;
        }
      }
    }
    this.spin.multiplyScalar(Math.pow(SPIN_DECAY, dt));
  }
}

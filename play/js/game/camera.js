import * as THREE from 'three';
import { PITCH } from './data.js';

// Broadcast-style TV camera: elevated sideline position, smooth follow with velocity
// look-ahead, gentle zoom based on play position. Plus replay camera modes.
export class TVCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.mode = 'tv';
    this.shakeT = 0;
  }

  snapTo(ballPos) {
    this._computeTV(ballPos, new THREE.Vector3(), 1);
    this.camera.position.copy(this.target);
    this.lookAt.copy(this._desiredLook);
    this.camera.lookAt(this.lookAt);
  }

  _computeTV(ballPos, ballVel, zoomF) {
    const bx = THREE.MathUtils.clamp(ballPos.x, -PITCH.length / 2, PITCH.length / 2);
    const bz = THREE.MathUtils.clamp(ballPos.z, -PITCH.width / 2, PITCH.width / 2);
    // look-ahead in ball travel direction
    const lead = Math.min(ballVel.length() * 0.35, 8);
    const lx = bx + (ballVel.x !== 0 ? Math.sign(ballVel.x) * lead * 0.7 : 0);
    // camera sits on +Z sideline, high; x tracks ball with soft clamp
    const camX = THREE.MathUtils.clamp(lx * 0.82, -44, 44);
    const dist = 46 * zoomF + Math.abs(bz) * 0.25;
    const height = 30 * zoomF + Math.abs(bz) * 0.12;
    this.target.set(camX, height, PITCH.width / 2 + dist * 0.62);
    this._desiredLook = new THREE.Vector3(lx * 0.9, 1.2, bz * 0.55);
  }

  shake(amount = 0.5) { this.shakeT = amount; }

  update(dt, ballPos, ballVel, matchPhase) {
    if (this.mode !== 'tv') return;
    const zoomF = matchPhase === 'PENALTY_KICK' ? 0.65 : 1;
    this._computeTV(ballPos, ballVel, zoomF);
    const k = 1 - Math.pow(0.0018, dt);   // smooth exponential chase
    this.camera.position.lerp(this.target, k);
    this.lookAt.lerp(this._desiredLook, 1 - Math.pow(0.0008, dt));
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt * 2);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeT * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeT * 0.3;
    }
    this.camera.lookAt(this.lookAt);
  }

  // Replay cams: angle 0 = low sideline chase, 1 = behind-goal
  replayView(angle, ballPos, t) {
    if (angle === 0) {
      this.camera.position.set(ballPos.x - 12, 2.2, ballPos.z + 14);
      this.camera.lookAt(ballPos.x, 0.8, ballPos.z);
    } else {
      const side = ballPos.x >= 0 ? 1 : -1;
      this.camera.position.set(side * (PITCH.length / 2 + 9), 3.5 + t * 1.5, ballPos.z * 0.4);
      this.camera.lookAt(ballPos.x, 0.5, ballPos.z);
    }
  }

  penaltyView(shooterEnd) {
    // behind the penalty taker looking at goal
    const gx = shooterEnd * PITCH.length / 2;
    const px = gx - shooterEnd * PITCH.penaltySpot;
    this.camera.position.set(px - shooterEnd * 9, 3.2, 4.5);
    this.camera.lookAt(gx, 1.2, 0);
  }
}

import * as THREE from 'three';

// Procedural articulated player: a hand-built skeleton hierarchy (pelvis→torso→head/arms,
// pelvis→legs) posed every frame by parametric animation curves (run cycle, kick, slide,
// dive, celebrations). Cheap, consistent, and fully controllable.

const SKIN_TONES = [0xf1c6a7, 0xd9a878, 0xb07b4f, 0x8a5a34, 0x6b4226];

export class PlayerModel {
  constructor(kit, { skinIndex = 0, isKeeper = false } = {}) {
    const [shirtC, shortsC, socksC] = kit;
    const skin = SKIN_TONES[skinIndex % SKIN_TONES.length];
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirtC });
    const shortsMat = new THREE.MeshLambertMaterial({ color: shortsC });
    const socksMat = new THREE.MeshLambertMaterial({ color: socksC });
    const skinMat = new THREE.MeshLambertMaterial({ color: skin });
    const bootMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const hairMat = new THREE.MeshLambertMaterial({ color: [0x2a1c10, 0x111111, 0x5a3a1a, 0x888070][skinIndex % 4] });

    this.root = new THREE.Group();          // ground position, yaw
    this.pelvis = new THREE.Group();        // hip height ~0.95
    this.pelvis.position.y = 0.95;
    this.root.add(this.pelvis);

    const hipBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), shortsMat);
    hipBox.position.y = 0.02;
    hipBox.castShadow = true;
    this.pelvis.add(hipBox);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.12;
    this.pelvis.add(this.torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.26), shirtMat);
    chest.position.y = 0.28;
    chest.castShadow = true;
    this.torso.add(chest);

    this.head = new THREE.Group();
    this.head.position.y = 0.58;
    this.torso.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinMat);
    skull.position.y = 0.1;
    skull.castShadow = true;
    this.head.add(skull);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hair.position.y = 0.115;
    this.head.add(hair);

    // Arms: shoulder pivot → upper arm; elbow pivot → forearm
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.26 * side, 0.5, 0);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.3, 6), shirtMat);
      upper.position.y = -0.15;
      upper.castShadow = true;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.28, 6), isKeeper ? shirtMat : skinMat);
      fore.position.y = -0.14;
      fore.castShadow = true;
      elbow.add(fore);
      this.torso.add(shoulder);
      return { shoulder, elbow };
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);

    // Legs: hip pivot → thigh; knee pivot → shin+sock; ankle → boot
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.11 * side, -0.06, 0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.062, 0.42, 6), shortsMat);
      thigh.position.y = -0.21;
      thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.4, 6), socksMat);
      shin.position.y = -0.2;
      shin.castShadow = true;
      knee.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.22), bootMat);
      boot.position.set(0, -0.44, 0.05);
      boot.castShadow = true;
      knee.add(boot);
      this.pelvis.add(hip);
      return { hip, knee };
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);

    // Selection ring (shown under the controlled player)
    const ringGeo = new THREE.RingGeometry(0.5, 0.62, 24);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x46d47e, transparent: true, opacity: 0.85, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.ring.visible = false;
    this.root.add(this.ring);

    this.runPhase = 0;
    this.actionT = -1;       // 0..1 progress of a one-shot action
    this.action = null;      // 'kick' | 'slide' | 'dive' | 'throw' | celebration name
    this.actionSide = 1;
    this._reset();
  }

  _reset() {
    this.pelvis.position.y = 0.95;
    this.pelvis.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.root.rotation.z = 0;
    this.root.rotation.x = 0;
  }

  setSelected(sel, color = 0x46d47e) {
    this.ring.visible = sel;
    if (sel) this.ring.material.color.setHex(color);
  }

  startAction(name, side = 1) {
    this.action = name;
    this.actionT = 0;
    this.actionSide = side;
  }
  get busy() { return this.actionT >= 0 && (this.action === 'slide' || this.action === 'dive' || this.action === 'getup'); }

  // speed: m/s, dt seconds. Called every frame.
  update(dt, speed, facing) {
    this.root.rotation.y = facing;
    const S = Math.min(speed / 8, 1.15);

    if (this.actionT >= 0) {
      this.actionT += dt / this._actionDur();
      if (this.actionT >= 1) { this.actionT = -1; this.action = null; this._reset(); }
      else { this._poseAction(); return; }
    }

    // Locomotion blend: idle sway ↔ run cycle
    this.runPhase += dt * (4 + speed * 1.7);
    const p = this.runPhase;
    const swing = Math.sin(p) * (0.25 + S * 0.75);
    this._reset();
    this.legL.hip.rotation.x = swing * 0.9 * S + Math.sin(p * 0.5) * 0.02;
    this.legR.hip.rotation.x = -swing * 0.9 * S;
    this.legL.knee.rotation.x = Math.max(0, Math.sin(p + 0.9)) * 1.1 * S;
    this.legR.knee.rotation.x = Math.max(0, Math.sin(-p + 0.9)) * 1.1 * S;
    this.armL.shoulder.rotation.x = -swing * 0.8 * S;
    this.armR.shoulder.rotation.x = swing * 0.8 * S;
    this.armL.elbow.rotation.x = -0.5 - S * 0.4;
    this.armR.elbow.rotation.x = -0.5 - S * 0.4;
    this.torso.rotation.x = 0.06 + S * 0.18;
    this.pelvis.position.y = 0.95 + Math.abs(Math.sin(p)) * 0.05 * S - S * 0.04;
    if (S < 0.05) { // idle breathing
      const b = Math.sin(performance.now() * 0.0016 + this.runPhase) * 0.01;
      this.torso.rotation.x = 0.03 + b;
      this.armL.elbow.rotation.x = -0.25;
      this.armR.elbow.rotation.x = -0.25;
    }
  }

  _actionDur() {
    switch (this.action) {
      case 'kick': return 0.38;
      case 'slide': return 0.85;
      case 'dive': return 0.9;
      case 'throw': return 0.7;
      case 'getup': return 0.5;
      case 'celebration_knee_slide': return 2.2;
      case 'celebration_backflip': return 1.4;
      case 'celebration_robot': return 2.4;
      case 'celebration_default': return 2.0;
      default: return 0.5;
    }
  }

  _poseAction() {
    const t = this.actionT, side = this.actionSide;
    const leg = side >= 0 ? this.legR : this.legL;
    const otherLeg = side >= 0 ? this.legL : this.legR;
    switch (this.action) {
      case 'kick': {
        // windup (0-0.35) → strike (0.35-0.6) → follow-through
        const w = t < 0.35 ? t / 0.35 : t < 0.6 ? 1 - (t - 0.35) / 0.25 * 2.2 : -1.2 + (t - 0.6) / 0.4 * 0.6;
        leg.hip.rotation.x = w * 0.9;
        leg.knee.rotation.x = t < 0.35 ? 1.4 * (t / 0.35) : Math.max(0, 1.4 - (t - 0.35) * 6);
        otherLeg.hip.rotation.x = -0.15;
        this.torso.rotation.x = 0.18;
        this.torso.rotation.y = -side * 0.25 * (1 - t);
        this.armL.shoulder.rotation.x = side * 0.5;
        this.armR.shoulder.rotation.x = -side * 0.5;
        break;
      }
      case 'slide': {
        const sink = Math.min(t * 4, 1);
        this.pelvis.position.y = 0.95 - sink * 0.62;
        this.root.rotation.x = 0; // root stays; body leans back
        this.pelvis.rotation.x = -sink * 1.05;
        leg.hip.rotation.x = -sink * 1.5;      // extended tackling leg
        leg.knee.rotation.x = 0.1;
        otherLeg.hip.rotation.x = sink * 0.5;
        otherLeg.knee.rotation.x = sink * 1.6; // tucked
        this.armL.shoulder.rotation.z = 0.9 * sink;
        this.armR.shoulder.rotation.z = -0.4 * sink;
        this.torso.rotation.x = -0.3 * sink;
        break;
      }
      case 'dive': {
        // keeper dive: rotate whole body sideways, arms extended
        const d = Math.min(t * 3, 1);
        this.root.rotation.z = -side * d * 1.35;
        this.pelvis.position.y = 0.95 - d * 0.55;
        const arm = side >= 0 ? this.armR : this.armL;
        arm.shoulder.rotation.z = side * (2.6 * d);
        arm.elbow.rotation.x = 0;
        (side >= 0 ? this.armL : this.armR).shoulder.rotation.z = side * 1.2 * d;
        this.legL.hip.rotation.x = -0.3 * d;
        this.legR.hip.rotation.x = 0.2 * d;
        break;
      }
      case 'throw': {
        const u = Math.sin(Math.min(t * Math.PI, Math.PI));
        this.armL.shoulder.rotation.x = Math.PI - u * 2.2;
        this.armR.shoulder.rotation.x = Math.PI - u * 2.2;
        this.torso.rotation.x = -0.25 + u * 0.5;
        break;
      }
      case 'celebration_default': {
        const u = Math.sin(t * Math.PI * 4);
        this.armL.shoulder.rotation.z = 2.6 + u * 0.3;
        this.armR.shoulder.rotation.z = -2.6 - u * 0.3;
        this.pelvis.position.y = 0.95 + Math.abs(Math.sin(t * Math.PI * 6)) * 0.18;
        break;
      }
      case 'celebration_knee_slide': {
        const sink = Math.min(t * 5, 1);
        this.pelvis.position.y = 0.95 - sink * 0.45;
        this.legL.knee.rotation.x = sink * 2.1;
        this.legR.knee.rotation.x = sink * 2.1;
        this.legL.hip.rotation.x = -sink * 0.4;
        this.legR.hip.rotation.x = -sink * 0.4;
        this.armL.shoulder.rotation.z = 2.4 * sink;
        this.armR.shoulder.rotation.z = -2.4 * sink;
        this.torso.rotation.x = -0.35 * sink;
        this.head.rotation.x = -0.4 * sink;
        break;
      }
      case 'celebration_backflip': {
        const u = t;
        if (u < 0.25) { // crouch
          this.pelvis.position.y = 0.95 - u * 1.6;
          this.legL.knee.rotation.x = u * 5; this.legR.knee.rotation.x = u * 5;
          this.legL.hip.rotation.x = -u * 3; this.legR.hip.rotation.x = -u * 3;
        } else if (u < 0.8) { // flip
          const f = (u - 0.25) / 0.55;
          this.root.rotation.x = -f * Math.PI * 2;
          this.pelvis.position.y = 0.55 + Math.sin(f * Math.PI) * 1.1;
          this.legL.knee.rotation.x = 1.8; this.legR.knee.rotation.x = 1.8;
          this.legL.hip.rotation.x = -1.4; this.legR.hip.rotation.x = -1.4;
        } else { // land
          const f = (u - 0.8) / 0.2;
          this.root.rotation.x = 0;
          this.pelvis.position.y = 0.6 + f * 0.35;
          this.legL.knee.rotation.x = 1.8 * (1 - f); this.legR.knee.rotation.x = 1.8 * (1 - f);
          this.legL.hip.rotation.x = -1.4 * (1 - f); this.legR.hip.rotation.x = -1.4 * (1 - f);
        }
        this.armL.shoulder.rotation.z = 1.5; this.armR.shoulder.rotation.z = -1.5;
        break;
      }
      case 'celebration_robot': {
        const step = Math.floor(t * 8) % 4;
        this.armL.shoulder.rotation.x = [-1.5, -1.5, 0, 0][step];
        this.armL.elbow.rotation.x = [-1.5, 0, -1.5, 0][step];
        this.armR.shoulder.rotation.x = [0, 0, -1.5, -1.5][step];
        this.armR.elbow.rotation.x = [0, -1.5, 0, -1.5][step];
        this.head.rotation.y = [(0.5), -0.5, 0.5, -0.5][step];
        this.torso.rotation.y = [0.2, -0.2, 0.2, -0.2][step];
        break;
      }
      case 'getup': {
        const u = 1 - t;
        this.pelvis.position.y = 0.95 - u * 0.5;
        this.pelvis.rotation.x = -u * 0.8;
        this.legL.knee.rotation.x = u * 1.2;
        this.legR.knee.rotation.x = u * 1.2;
        break;
      }
    }
  }
}

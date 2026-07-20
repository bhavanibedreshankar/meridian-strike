import * as THREE from 'three';
import { PITCH, AD_BRANDS } from '../game/data.js';

// Stadium sized by career tier, with instanced crowd, floodlight towers, ad boards, scoreboard.
const SIZES = {
  small: { rows: 6, sideLen: 0.7, ends: false, tier2: false, roof: false },
  medium: { rows: 10, sideLen: 0.9, ends: true, tier2: false, roof: false },
  large: { rows: 14, sideLen: 1.0, ends: true, tier2: true, roof: true },
  grand: { rows: 18, sideLen: 1.0, ends: true, tier2: true, roof: true },
};

const CROWD_PALETTE = [0xd94a4a, 0x4a6ad9, 0xe8e8e8, 0x3a3a3a, 0xd9c44a, 0x4ad98c, 0xd97c2a, 0x9a5ad9, 0x5ac8d9, 0x8a5a3a];

export class Stadium {
  constructor(sceneMgr, { size = 'small', crowdDensity = 0.5, accent = null } = {}) {
    this.sceneMgr = sceneMgr;
    this.group = new THREE.Group();
    this.crowdMeshes = [];
    this.crowdPhases = null;
    this.excitement = 0; // 0 ambient, 1 goal frenzy
    this.time = 0;
    this.build(size, crowdDensity, accent);
    sceneMgr.scene.add(this.group);
  }

  dispose() {
    this.sceneMgr.scene.remove(this.group);
    this.sceneMgr.clearFloodlights();
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose(); m.dispose(); });
    });
  }

  build(sizeKey, density, accent) {
    const S = SIZES[sizeKey] || SIZES.small;
    const isMobile = this.sceneMgr.isMobile;
    const stepD = 1.1, stepH = 0.55;
    const standMat = new THREE.MeshLambertMaterial({ color: 0x8a93a3 });
    const seatColor = accent ?? 0x2c3e6b;
    const seatMat = new THREE.MeshLambertMaterial({ color: seatColor });

    const stands = [];
    // Side stands (along ±Z), length scaled
    const sideL = PITCH.length * S.sideLen;
    stands.push({ len: sideL, cx: 0, cz: PITCH.width / 2 + 10, rotY: Math.PI, key: 'N' });
    stands.push({ len: sideL, cx: 0, cz: -(PITCH.width / 2 + 10), rotY: 0, key: 'S' });
    if (S.ends) {
      const endL = PITCH.width * 0.85;
      stands.push({ len: endL, cx: PITCH.length / 2 + 12, cz: 0, rotY: Math.PI / 2, key: 'E' });
      stands.push({ len: endL, cx: -(PITCH.length / 2 + 12), cz: 0, rotY: -Math.PI / 2, key: 'W' });
    }

    // Crowd instancing: bodies + heads share transforms
    const seatsPerRow = (len) => Math.floor(len / 0.75);
    let totalSeats = 0;
    for (const st of stands) totalSeats += seatsPerRow(st.len) * S.rows * (S.tier2 ? 2 : 1);
    const budget = isMobile ? 2600 : 7000;
    const fill = Math.min(1, budget / Math.max(1, totalSeats)) * density;

    const crowdCount = Math.floor(totalSeats * fill);
    const bodyGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.62, 5);
    const headGeo = new THREE.SphereGeometry(0.14, 6, 5);
    const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), crowdCount);
    const headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xd9b08a }), crowdCount);
    bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    this.crowdBase = new Float32Array(crowdCount * 3);
    this.crowdPhases = new Float32Array(crowdCount);
    let ci = 0;
    let rndSeed = 777;
    const rnd = () => { rndSeed = (rndSeed * 1664525 + 1013904223) >>> 0; return rndSeed / 4294967296; };

    for (const st of stands) {
      // Stand structure: stepped concrete rows
      const tiers = S.tier2 ? 2 : 1;
      for (let t = 0; t < tiers; t++) {
        const baseY = t * (S.rows * stepH + 2.2);
        const baseOff = t * (S.rows * stepD * 0.55);
        const standGroup = new THREE.Group();
        const stepGeo = new THREE.BoxGeometry(st.len, stepH, stepD);
        for (let rrow = 0; rrow < S.rows; rrow++) {
          const step = new THREE.Mesh(stepGeo, rrow % 2 ? standMat : seatMat);
          step.position.set(0, baseY + rrow * stepH + stepH / 2, baseOff + rrow * stepD);
          standGroup.add(step);
        }
        // Back wall
        const wall = new THREE.Mesh(new THREE.BoxGeometry(st.len, S.rows * stepH + 1.5, 0.5), standMat);
        wall.position.set(0, baseY + (S.rows * stepH) / 2, baseOff + S.rows * stepD + 0.5);
        standGroup.add(wall);
        if (S.roof && t === tiers - 1) {
          const roof = new THREE.Mesh(new THREE.BoxGeometry(st.len + 4, 0.35, S.rows * stepD * 0.9),
            new THREE.MeshLambertMaterial({ color: 0x3c4454 }));
          roof.position.set(0, baseY + S.rows * stepH + 5.5, baseOff + S.rows * stepD * 0.45);
          roof.rotation.x = 0.12;
          standGroup.add(roof);
        }
        standGroup.position.set(st.cx, 0, st.cz);
        standGroup.rotation.y = st.rotY;
        this.group.add(standGroup);

        // Crowd for this stand tier
        const perRow = seatsPerRow(st.len);
        for (let rrow = 0; rrow < S.rows; rrow++) {
          for (let sIdx = 0; sIdx < perRow; sIdx++) {
            if (ci >= crowdCount) break;
            if (rnd() > fill) continue;
            const lx = -st.len / 2 + (sIdx + 0.5) * (st.len / perRow) + (rnd() - 0.5) * 0.2;
            const ly = baseY + rrow * stepH + stepH + 0.32;
            const lz = baseOff + rrow * stepD + 0.15;
            // local → world (stand rotation about Y then translate)
            const cos = Math.cos(st.rotY), sin = Math.sin(st.rotY);
            const wx = st.cx + lx * cos + lz * sin;
            const wz = st.cz - lx * sin + lz * cos;
            dummy.position.set(wx, ly, wz);
            dummy.rotation.set(0, st.rotY + Math.PI, 0);
            const sc = 0.9 + rnd() * 0.25;
            dummy.scale.set(sc, sc, sc);
            dummy.updateMatrix();
            bodyMesh.setMatrixAt(ci, dummy.matrix);
            headMesh.setMatrixAt(ci, dummy.matrix);
            bodyMesh.setColorAt(ci, color.setHex(CROWD_PALETTE[Math.floor(rnd() * CROWD_PALETTE.length)]));
            this.crowdBase[ci * 3] = wx; this.crowdBase[ci * 3 + 1] = ly; this.crowdBase[ci * 3 + 2] = wz;
            this.crowdPhases[ci] = rnd() * Math.PI * 2;
            ci++;
          }
        }
      }
    }
    bodyMesh.count = ci; headMesh.count = ci;
    this.crowdActive = ci;
    this.group.add(bodyMesh, headMesh);
    this.crowdMeshes = [bodyMesh, headMesh];
    this._dummy = dummy;

    // Floodlight towers at 4 corners
    const towerMat = new THREE.MeshLambertMaterial({ color: 0x556070 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const tx = sx * (PITCH.length / 2 + 18), tz = sz * (PITCH.width / 2 + 16);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 28, 6), towerMat);
      pole.position.set(tx, 14, tz);
      this.group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0xf0f8ff, emissiveIntensity: 0.9 }));
      head.position.set(tx, 28.5, tz);
      head.lookAt(0, 0, 0);
      this.group.add(head);
      const spot = new THREE.SpotLight(0xeaf2ff, 0, 220, 0.55, 0.5, 1.2);
      spot.position.set(tx, 28, tz);
      spot.target.position.set(sx * PITCH.length * 0.15, 0, sz * PITCH.width * 0.15);
      this.group.add(spot, spot.target);
      this.sceneMgr.registerFloodlight(spot);
    }

    // Ad boards around the pitch
    this.buildAdBoards();
    // Scoreboard (big screen) behind one end
    this.buildScoreboard(S);
  }

  buildAdBoards() {
    const mkTex = (text) => {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 64;
      const g = c.getContext('2d');
      const hue = (text.charCodeAt(0) * 37) % 360;
      g.fillStyle = `hsl(${hue}, 65%, 22%)`;
      g.fillRect(0, 0, 512, 64);
      g.fillStyle = `hsl(${(hue + 40) % 360}, 90%, 65%)`;
      g.font = 'bold 38px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 256, 34);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const boardGeo = new THREE.PlaneGeometry(12, 1);
    let bi = 0;
    const place = (x, z, rotY) => {
      const mat = new THREE.MeshBasicMaterial({ map: mkTex(AD_BRANDS[bi++ % AD_BRANDS.length]) });
      const m = new THREE.Mesh(boardGeo, mat);
      m.position.set(x, 0.55, z);
      m.rotation.y = rotY;
      this.group.add(m);
    };
    for (let i = -4; i <= 4; i++) {
      place(i * 12.5, PITCH.width / 2 + 3.5, Math.PI); // far side faces camera side? both sides:
      place(i * 12.5, -(PITCH.width / 2 + 3.5), 0);
    }
    for (let i = -2; i <= 2; i++) {
      place(PITCH.length / 2 + 5, i * 13, -Math.PI / 2);
      place(-(PITCH.length / 2 + 5), i * 13, Math.PI / 2);
    }
  }

  buildScoreboard(S) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    this.sbCanvas = c;
    this.sbTex = new THREE.CanvasTexture(c);
    this.sbTex.colorSpace = THREE.SRGBColorSpace;
    this.updateScoreboard('MERIDIAN', 'LEAGUE', 0, 0, '00:00');
    const frame = new THREE.Mesh(new THREE.BoxGeometry(19, 9.6, 0.6), new THREE.MeshLambertMaterial({ color: 0x14181f }));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: this.sbTex }));
    const x = PITCH.length / 2 + (S.ends ? 30 : 20);
    frame.position.set(x, 20, 0); frame.rotation.y = -Math.PI / 2;
    screen.position.set(x - 0.35, 20, 0); screen.rotation.y = -Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 16, 6), new THREE.MeshLambertMaterial({ color: 0x2a2f38 }));
    pole.position.set(x, 7.5, 0);
    this.group.add(frame, screen, pole);
  }

  updateScoreboard(home, away, hs, as, clock) {
    const g = this.sbCanvas.getContext('2d');
    g.fillStyle = '#050810'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#0f1830'; g.fillRect(8, 8, 496, 240);
    g.textAlign = 'center';
    g.fillStyle = '#ffd23e'; g.font = 'bold 84px system-ui, sans-serif';
    g.fillText(`${hs} - ${as}`, 256, 120);
    g.fillStyle = '#e8eefc'; g.font = 'bold 34px system-ui, sans-serif';
    g.fillText(home.slice(0, 10).toUpperCase(), 130, 190);
    g.fillText(away.slice(0, 10).toUpperCase(), 382, 190);
    g.fillStyle = '#46d47e'; g.font = 'bold 40px system-ui, sans-serif';
    g.fillText(clock, 256, 236);
    this.sbTex.needsUpdate = true;
  }

  setExcitement(v) { this.excitement = v; }

  update(dt) {
    this.time += dt;
    if (!this.crowdActive) return;
    // Animate a rotating subset each frame to keep cost low; more when excited.
    const [bodyMesh, headMesh] = this.crowdMeshes;
    const n = this.crowdActive;
    const slice = Math.max(1, Math.floor(n / (this.excitement > 0.5 ? 2 : 6)));
    const start = Math.floor((this.time * 7) % 6) * Math.floor(n / 6);
    const d = this._dummy;
    const amp = 0.06 + this.excitement * 0.5;
    for (let k = 0; k < slice; k++) {
      const i = (start + k) % n;
      const bob = Math.max(0, Math.sin(this.time * (4 + this.excitement * 6) + this.crowdPhases[i])) * amp;
      d.position.set(this.crowdBase[i * 3], this.crowdBase[i * 3 + 1] + bob, this.crowdBase[i * 3 + 2]);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      bodyMesh.setMatrixAt(i, d.matrix);
      headMesh.setMatrixAt(i, d.matrix);
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
  }
}

import * as THREE from 'three';
import { PITCH } from '../game/data.js';

// Procedural grass texture: alternating mow stripes + noise + white line markings baked in.
function buildPitchTexture(renderer) {
  const W = 2048, H = Math.round(2048 * (PITCH.width / PITCH.length));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // metres → px (texture spans pitch + 6m of surround grass on each side)
  const padM = 6;
  const pxPerM = W / (PITCH.length + padM * 2);
  const mx = (x) => (x + PITCH.length / 2 + padM) * pxPerM;      // x in [-L/2, L/2]
  const mz = (z) => (z + PITCH.width / 2 + padM) * pxPerM * (H / (W * (PITCH.width + padM * 2) / (PITCH.length + padM * 2)));
  // simpler: uniform scale since H chosen proportional — recompute properly:
  const pxPerMz = H / (PITCH.width + padM * 2);
  const mzU = (z) => (z + PITCH.width / 2 + padM) * pxPerMz;

  // Base grass
  g.fillStyle = '#2f7a2f';
  g.fillRect(0, 0, W, H);

  // Mowing stripes along width (classic broadcast look): stripes perpendicular to touchline
  const stripeW = mx(-PITCH.length / 2 + PITCH.length / 14) - mx(-PITCH.length / 2);
  for (let i = 0; i < 20; i++) {
    g.fillStyle = i % 2 === 0 ? '#348534' : '#2c722c';
    g.fillRect(i * stripeW, 0, stripeW + 1, H);
  }

  // Grass noise speckle
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);

  // Subtle vignette of wear in center & goalmouths
  const wear = (x, z, r, alpha) => {
    const gr = g.createRadialGradient(mx(x), mzU(z), 0, mx(x), mzU(z), r * pxPerM);
    gr.addColorStop(0, `rgba(120,110,60,${alpha})`);
    gr.addColorStop(1, 'rgba(120,110,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  wear(0, 0, 9, 0.10);
  wear(-PITCH.length / 2 + 3, 0, 7, 0.16);
  wear(PITCH.length / 2 - 3, 0, 7, 0.16);

  // Line markings
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = Math.max(2, 0.13 * pxPerM);
  const L = PITCH.length / 2, Wd = PITCH.width / 2;
  // Perimeter
  g.strokeRect(mx(-L), mzU(-Wd), mx(L) - mx(-L), mzU(Wd) - mzU(-Wd));
  // Halfway line
  g.beginPath(); g.moveTo(mx(0), mzU(-Wd)); g.lineTo(mx(0), mzU(Wd)); g.stroke();
  // Center circle + spot
  g.beginPath(); g.arc(mx(0), mzU(0), PITCH.circleR * pxPerM, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(mx(0), mzU(0), 0.25 * pxPerM, 0, Math.PI * 2); g.fill();
  for (const side of [-1, 1]) {
    const gx = side * L;
    // Penalty box
    const bx = gx - side * PITCH.boxLength;
    g.strokeRect(Math.min(mx(gx), mx(bx)), mzU(-PITCH.boxWidth / 2),
      Math.abs(mx(bx) - mx(gx)), mzU(PITCH.boxWidth / 2) - mzU(-PITCH.boxWidth / 2));
    // Six-yard box
    const sx = gx - side * PITCH.sixLength;
    g.strokeRect(Math.min(mx(gx), mx(sx)), mzU(-PITCH.sixWidth / 2),
      Math.abs(mx(sx) - mx(gx)), mzU(PITCH.sixWidth / 2) - mzU(-PITCH.sixWidth / 2));
    // Penalty spot
    const px = gx - side * PITCH.penaltySpot;
    g.beginPath(); g.arc(mx(px), mzU(0), 0.25 * pxPerM, 0, Math.PI * 2); g.fill();
    // Penalty arc (only outside the box)
    g.beginPath();
    const a0 = side === 1 ? Math.PI * 0.65 : -Math.PI * 0.35;
    g.arc(mx(px), mzU(0), PITCH.circleR * pxPerM, a0, a0 + Math.PI * 0.7);
    g.stroke();
    // Corner arcs
    for (const cz of [-Wd, Wd]) {
      g.beginPath();
      g.arc(mx(gx), mzU(cz), 1 * pxPerM, 0, Math.PI * 2);
      g.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return { tex, padM };
}

export function buildPitch(sceneMgr) {
  const group = new THREE.Group();
  const { tex, padM } = buildPitchTexture(sceneMgr.renderer);

  const geo = new THREE.PlaneGeometry(PITCH.length + padM * 2, PITCH.width + padM * 2);
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const field = new THREE.Mesh(geo, mat);
  field.rotation.x = -Math.PI / 2;
  field.receiveShadow = true;
  group.add(field);

  // Outer ground apron (dark surround so stands sit on something)
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH.length + 160, PITCH.width + 160),
    new THREE.MeshLambertMaterial({ color: 0x24303a })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  group.add(apron);

  // Goals
  for (const side of [-1, 1]) {
    group.add(buildGoal(side));
  }

  sceneMgr.scene.add(group);
  return group;
}

function buildGoal(side) {
  const g = new THREE.Group();
  const gx = side * PITCH.length / 2;
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
  const r = 0.07, H = PITCH.goalHeight, W = PITCH.goalWidth;
  const post = (x, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, H, 8), postMat);
    m.position.set(x, H / 2, z); m.castShadow = true; return m;
  };
  g.add(post(gx, -W / 2), post(gx, W / 2));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, W + r * 2, 8), postMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(gx, H, 0);
  bar.castShadow = true;
  g.add(bar);
  // Net: simple translucent panels (back + sides + top)
  const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
  const depth = 1.9;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), netMat);
  back.position.set(gx + side * depth, H / 2, 0);
  back.rotation.y = Math.PI / 2;
  g.add(back);
  for (const z of [-W / 2, W / 2]) {
    const sidePanel = new THREE.Mesh(new THREE.PlaneGeometry(depth, H), netMat);
    sidePanel.position.set(gx + side * depth / 2, H / 2, z);
    g.add(sidePanel);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(depth, W), netMat);
  top.rotation.x = Math.PI / 2; top.rotation.z = Math.PI / 2;
  top.position.set(gx + side * depth / 2, H, 0);
  g.add(top);
  return g;
}

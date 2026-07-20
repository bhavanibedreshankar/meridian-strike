import * as THREE from 'three';

// Renderer + scene + lighting presets (day / dusk / floodlit night).
export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isMobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.7 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
    this.camera.position.set(0, 45, 62);
    this.camera.lookAt(0, 0, 0);

    // Lights (intensities set by applyLighting)
    this.hemi = new THREE.HemisphereLight(0xbdd8ff, 0x3a5a2a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(this.isMobile ? 1024 : 2048, this.isMobile ? 1024 : 2048);
    s.camera.near = 10; s.camera.far = 260;
    s.camera.left = -70; s.camera.right = 70; s.camera.top = 70; s.camera.bottom = -70;
    s.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.floodlights = []; // filled by stadium; we only manage intensity

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  registerFloodlight(light) { this.floodlights.push(light); }
  clearFloodlights() { this.floodlights = []; }

  applyLighting(preset, override = null) {
    // override: STADIUM_VISUALS entry (cosmetic skies)
    const mode = override?.lighting || preset;
    const skyOv = override?.sky, horizonOv = override?.horizon;
    if (mode === 'day') {
      this.scene.background = new THREE.Color(skyOv ?? 0x87b8e8);
      this.scene.fog = new THREE.Fog(horizonOv ?? 0xa8c8e8, 220, 700);
      this.hemi.intensity = 0.95; this.hemi.color.set(0xbdd8ff); this.hemi.groundColor.set(0x3a5a2a);
      this.sun.intensity = 2.4; this.sun.color.set(0xfff4e0);
      this.sun.position.set(-60, 110, 40);
      this.floodlights.forEach(l => l.intensity = 0);
    } else if (mode === 'dusk') {
      this.scene.background = new THREE.Color(skyOv ?? 0xd8865e);
      this.scene.fog = new THREE.Fog(horizonOv ?? 0xe8a878, 200, 650);
      this.hemi.intensity = 0.55; this.hemi.color.set(0xffc8a0); this.hemi.groundColor.set(0x4a3a2a);
      this.sun.intensity = 1.6; this.sun.color.set(0xffb060);
      this.sun.position.set(-100, 35, 60);
      this.floodlights.forEach(l => l.intensity = 250);
    } else { // floodlit night
      this.scene.background = new THREE.Color(skyOv ?? 0x070b18);
      this.scene.fog = new THREE.Fog(horizonOv ?? 0x0a1024, 200, 620);
      this.hemi.intensity = 0.32; this.hemi.color.set(0x9db8e8); this.hemi.groundColor.set(0x1a2a1a);
      // "sun" acts as combined floodlight key light so shadows stay cheap & crisp
      this.sun.intensity = 1.9; this.sun.color.set(0xeaf2ff);
      this.sun.position.set(35, 120, 55);
      this.floodlights.forEach(l => l.intensity = 900);
    }
    this.sun.target.position.set(0, 0, 0);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

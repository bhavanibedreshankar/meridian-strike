import * as THREE from 'three';

// Goal replays: ring buffer of world snapshots (22 players + ball), recorded at ~30 Hz,
// played back through cinematic camera angles. Skippable.
const HZ = 30;
const SECONDS = 7;
const FRAMES = HZ * SECONDS;

export class ReplaySystem {
  constructor(numPlayers = 22) {
    this.n = numPlayers;
    // per frame: players (x,z,facing,speed) + ball (x,y,z)
    this.buf = new Float32Array(FRAMES * (numPlayers * 4 + 3));
    this.frameCount = 0;
    this.head = 0;
    this.accum = 0;
    this.playing = false;
  }

  get frameSize() { return this.n * 4 + 3; }

  record(dt, players, ball) {
    this.accum += dt;
    if (this.accum < 1 / HZ) return;
    this.accum = 0;
    const off = this.head * this.frameSize;
    for (let i = 0; i < this.n; i++) {
      const p = players[i];
      this.buf[off + i * 4] = p.pos.x;
      this.buf[off + i * 4 + 1] = p.pos.z;
      this.buf[off + i * 4 + 2] = p.facing;
      this.buf[off + i * 4 + 3] = p.vel.length();
    }
    const bo = off + this.n * 4;
    this.buf[bo] = ball.pos.x; this.buf[bo + 1] = ball.pos.y; this.buf[bo + 2] = ball.pos.z;
    this.head = (this.head + 1) % FRAMES;
    this.frameCount = Math.min(this.frameCount + 1, FRAMES);
  }

  start() {
    if (this.frameCount < HZ) return false;
    this.playing = true;
    this.playFrame = 0;
    this.playLen = Math.min(this.frameCount, Math.floor(HZ * 5.5));
    this.speed = 0.45; // slow-mo start
    this.angle = 1;    // behind goal first
    return true;
  }

  stop() { this.playing = false; }

  // Applies a playback frame to the visual models. Returns false when finished.
  step(dt, players, ballMesh, ballPos, tvCam) {
    if (!this.playing) return false;
    this.playFrame += dt * HZ * this.speed;
    if (this.playFrame >= this.playLen * 0.55) this.speed = 1.0;  // speed up second half
    if (this.playFrame >= this.playLen) { this.playing = false; return false; }
    const idx = (this.head - this.playLen + Math.floor(this.playFrame) + FRAMES * 2) % FRAMES;
    const off = idx * this.frameSize;
    for (let i = 0; i < this.n; i++) {
      const p = players[i];
      p.model.root.position.set(this.buf[off + i * 4], 0, this.buf[off + i * 4 + 1]);
      p.model.update(dt, this.buf[off + i * 4 + 3], this.buf[off + i * 4 + 2]);
    }
    const bo = off + this.n * 4;
    ballPos.set(this.buf[bo], this.buf[bo + 1], this.buf[bo + 2]);
    ballMesh.position.copy(ballPos);
    const t = this.playFrame / this.playLen;
    if (t > 0.5 && this.angle === 1) this.angle = 0; // switch to low sideline
    tvCam.replayView(this.angle, ballPos, t);
    return true;
  }
}

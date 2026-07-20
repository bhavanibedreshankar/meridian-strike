import * as THREE from 'three';
import { PITCH, FORMATIONS, MENTALITIES, generateSquadNames } from './data.js';
import { PlayerModel } from '../engine/playermodel.js';

let nextPlayerId = 0;

export class Player {
  constructor(team, index, role, name, kit, isKeeper, seed) {
    this.id = nextPlayerId++;
    this.team = team;         // 0 = user/home, 1 = AI/away
    this.index = index;
    this.role = role;
    this.name = name;
    this.isKeeper = isKeeper;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.model = new PlayerModel(kit, { skinIndex: seed % 5, isKeeper });
    // attributes (slight individual variance)
    const r = ((seed * 9301 + 49297) % 233280) / 233280;
    this.sprintSpeed = (role === 'FW' ? 8.6 : role === 'MF' ? 8.2 : role === 'DF' ? 7.9 : 7.4) + r * 0.7;
    this.runSpeed = this.sprintSpeed * 0.78;
    this.accel = 16 + r * 4;
    // state
    this.stunned = 0;          // seconds remaining on ground after tackle/foul
    this.slide = null;         // {t, dir, hitBall}
    this.card = null;
    this.sentOff = false;
    this.offsideFlag = false;
    this.decisionTimer = Math.random() * 0.4;
    this.reactionTimer = 0;
    this.supportRun = null;    // target Vector3 while making a run
    this.targetPos = new THREE.Vector3();
  }

  get maxSpeed() { return this._sprinting ? this.sprintSpeed : this.runSpeed; }

  // steering toward targetPos (or direct velocity for controlled player)
  steer(dt, desiredVel) {
    const dv = desiredVel.clone().sub(this.vel);
    const maxDv = this.accel * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.add(dv);
    this.pos.addScaledVector(this.vel, dt);
    // keep inside a margin beyond the pitch
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -PITCH.length / 2 - 4, PITCH.length / 2 + 4);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -PITCH.width / 2 - 4, PITCH.width / 2 + 4);
    const sp = this.vel.length();
    if (sp > 0.6) {
      const tgt = Math.atan2(this.vel.x, this.vel.z);
      let d = tgt - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += THREE.MathUtils.clamp(d, -10 * dt, 10 * dt);
    }
  }

  syncModel(dt) {
    this.model.root.position.set(this.pos.x, 0, this.pos.z);
    this.model.update(dt, this.vel.length(), this.facing);
  }
}

export class Team {
  constructor(teamIndex, data, { formationKey = '4-4-2', mentality = 'balanced', kitOverride = null, difficulty }) {
    this.index = teamIndex;
    this.data = data;
    this.formationKey = formationKey;
    this.mentality = mentality;
    this.difficulty = difficulty;
    this.attackDir = teamIndex === 0 ? 1 : -1; // swapped at halftime by match
    this.players = [];
    const names = generateSquadNames(data.rating + teamIndex);
    const formation = FORMATIONS[formationKey];
    const outfieldKit = kitOverride || data.kit;
    for (let i = 0; i < 11; i++) {
      const spot = formation[i];
      const isGK = spot.r === 'GK';
      const p = new Player(teamIndex, i, spot.r, names[i], isGK ? data.gkKit : outfieldKit, isGK, data.rating * 13 + i * 7);
      this.players.push(p);
    }
  }

  get formation() { return FORMATIONS[this.formationKey]; }
  get ment() { return MENTALITIES[this.mentality]; }

  setFormation(key) { if (FORMATIONS[key]) this.formationKey = key; }

  activePlayers() { return this.players.filter(p => !p.sentOff); }
  keeper() { return this.players[0]; }

  // Formation home spot in world coords for player i
  homeSpot(i, out) {
    const f = this.formation[i];
    out.set(this.attackDir * f.x * (PITCH.length / 2) * 0.92, 0, f.z * (PITCH.width / 2) * 0.86);
    return out;
  }

  // Dynamic shape target: home spot shifted by ball position, mentality, possession
  shapeTarget(player, ball, possessionTeam, out) {
    this.homeSpot(player.index, out);
    if (player.isKeeper) return out;
    const havePossession = possessionTeam === this.index;
    const ment = this.ment;
    // shift with ball along x (team moves as a block)
    const ballPull = 0.35 + (havePossession ? 0.1 : 0.05);
    out.x += ball.pos.x * ballPull * 0.6;
    out.x += this.attackDir * ment.lineShift * PITCH.length * 0.5 * (havePossession ? 1 : 0.4);
    if (havePossession) out.x += this.attackDir * 6;
    else out.x -= this.attackDir * 4;
    // compress toward ball z a little
    out.z += (ball.pos.z - out.z) * 0.18;
    out.x = THREE.MathUtils.clamp(out.x, -PITCH.length / 2 + 1, PITCH.length / 2 - 1);
    out.z = THREE.MathUtils.clamp(out.z, -PITCH.width / 2 + 1, PITCH.width / 2 - 1);
    return out;
  }

  // Reset all players to kickoff formation. kickingOff: this team has the kickoff.
  layoutKickoff(kickingOff) {
    const tmp = new THREE.Vector3();
    for (const p of this.players) {
      this.homeSpot(p.index, tmp);
      // everyone in own half
      if (this.attackDir > 0) tmp.x = Math.min(tmp.x, -1.5);
      else tmp.x = Math.max(tmp.x, 1.5);
      if (kickingOff && p.role === 'FW') {
        // strikers at the center spot
        tmp.set(this.attackDir * (p.index % 2 === 0 ? -0.5 : -3), 0, p.index % 2 === 0 ? 0.2 : 1.5);
      }
      p.pos.copy(tmp);
      p.vel.set(0, 0, 0);
      p.facing = this.attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.stunned = 0; p.slide = null; p.offsideFlag = false; p.supportRun = null;
      if (p.sentOff) p.pos.set(0, 0, PITCH.width / 2 + 20); // off the pitch
    }
  }
}

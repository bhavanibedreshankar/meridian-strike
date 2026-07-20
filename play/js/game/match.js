import * as THREE from 'three';
import { PITCH } from './data.js';
import { Team } from './team.js';
import { Ball, BALL_R } from '../engine/ball.js';
import { updateAI, interceptPoint, goalX } from './ai.js';
import { snapshotOffside, clearOffsideFlags, checkOutOfPlay, evaluateSlideContact } from './rules.js';
import { ReplaySystem } from './replay.js';
import { TVCamera } from './camera.js';

const V1 = new THREE.Vector3(), V2 = new THREE.Vector3();
const CONTROL_R = 0.95;

// Match orchestrator: state machine over kickoff → play → restarts → goals/replays →
// halves → extra time → shootout, plus human control and possession physics.
export class Match {
  constructor({ sceneMgr, stadium, input, hud, config, callbacks }) {
    this.sceneMgr = sceneMgr;
    this.stadium = stadium;
    this.input = input;
    this.hud = hud;
    this.cfg = config;
    this.cb = callbacks;

    this.teams = [
      new Team(0, config.userTeamData, { formationKey: config.userFormation || '4-4-2', mentality: 'balanced', kitOverride: config.userKit }),
      new Team(1, config.aiTeamData, { formationKey: '4-4-2', mentality: 'balanced', kitOverride: pickAwayKit(config) }),
    ];
    this.teams[0].diffProfile = config.teammateDifficulty;
    this.teams[1].diffProfile = config.difficulty;
    for (const t of this.teams) {
      const mult = t.diffProfile.speedMult ?? 1;
      for (const p of t.players) { p.sprintSpeed *= mult; p.runSpeed *= mult; }
    }
    this._possTeamLast = -1;

    this.allPlayers = [...this.teams[0].players, ...this.teams[1].players];
    for (const p of this.allPlayers) sceneMgr.scene.add(p.model.root);

    this.ball = new Ball(sceneMgr.scene);
    this.tvCam = new TVCamera(sceneMgr.camera);
    this.replay = new ReplaySystem(22);

    this.score = [0, 0];
    this.half = 1;                    // 1,2 = regulation; 3,4 = extra time
    this.playSeconds = 0;
    this.halfLenSec = config.halfLengthMin * 60;
    this.etHalfLenSec = Math.max(45, this.halfLenSec / 3);
    this.carrier = null;
    this.userControlled = null;
    this.phase = 'KICKOFF_WAIT';
    this.restart = null;
    this.pen = null;
    this.shootout = null;
    this.wentToExtraTime = false;
    this.wentToPenalties = false;
    this.ended = false;
    this.paused = false;
    this.celebrateT = 0;
    this.stateT = 0;

    this.setupKickoff(0);
    this.tvCam.snapTo(this.ball.pos);
    hud.setScore(0, 0);
  }

  dispose() {
    for (const p of this.allPlayers) this.sceneMgr.scene.remove(p.model.root);
    this.sceneMgr.scene.remove(this.ball.mesh);
  }

  get possessionTeam() {
    if (this.carrier) return this.carrier.team;
    if (this.phase !== 'PLAY' && this.restart) return this.restart.team;
    return -1;
  }

  // ---------------- setup & restarts ----------------
  setupKickoff(kickingTeam) {
    this.phase = 'KICKOFF_WAIT';
    this.stateT = 0;
    this.carrier = null;
    clearOffsideFlags(this);
    for (const t of this.teams) t.layoutKickoff(t.index === kickingTeam);
    this.ball.place(0, 0);
    const kt = this.teams[kickingTeam];
    const taker = kt.activePlayers().filter(p => !p.isKeeper)
      .sort((a, b) => a.pos.distanceToSquared(V1.set(0, 0, 0)) - b.pos.distanceToSquared(V1))[0];
    taker.pos.set(-kt.attackDir * 0.8, 0, 0);
    this.restart = { type: 'kickoff', team: kickingTeam, taker };
    if (kickingTeam === 0) {
      this.setControlled(taker);
      this.hud.showBanner('Press PASS to kick off', 0);
    } else {
      this.hud.showBanner('Kick-off', 1200);
      this.setControlled(this.nearestUserPlayer(this.ball.pos));
    }
  }

  setupRestart(r) {
    this.phase = 'RESTART_WAIT';
    this.stateT = 0;
    this.carrier = null;
    clearOffsideFlags(this);
    this.restart = r;
    this.ball.place(r.x, r.z);
    const team = this.teams[r.team];
    let taker;
    if (r.type === 'goal_kick') taker = team.keeper();
    else taker = team.activePlayers().filter(p => !p.isKeeper)
      .sort((a, b) => a.pos.distanceToSquared(this.ball.pos) - b.pos.distanceToSquared(this.ball.pos))[0];
    r.taker = taker;
    // place taker at the spot
    if (r.type === 'throw_in') {
      taker.pos.set(r.x, 0, Math.sign(r.z) * (PITCH.width / 2 + 0.6));
    } else if (r.type === 'corner') {
      taker.pos.set(r.x + Math.sign(r.x) * 0.6, 0, r.z + Math.sign(r.z) * 0.6);
    } else {
      taker.pos.set(r.x - this.teams[r.team].attackDir * 1.2, 0, r.z);
    }
    taker.vel.set(0, 0, 0);
    taker.facing = Math.atan2(-Math.sign(taker.pos.x || 1), 0);
    // push opponents 9.15m away
    for (const o of this.teams[1 - r.team].activePlayers()) {
      const d = o.pos.distanceTo(this.ball.pos);
      if (d < 9.15 && !o.isKeeper) {
        V1.copy(o.pos).sub(this.ball.pos);
        if (V1.lengthSq() < 0.01) V1.set(-this.teams[r.team].attackDir, 0, 0.3);
        V1.setLength(9.3);
        o.pos.copy(this.ball.pos).add(V1);
        o.pos.z = THREE.MathUtils.clamp(o.pos.z, -PITCH.width / 2, PITCH.width / 2);
      }
    }
    // free kick near goal: build a 3-man wall
    if (r.type === 'free_kick') this.buildWall(r, this.teams[1 - r.team]);
    if (r.team === 0) {
      this.setControlled(taker);
      const label = { throw_in: 'THROW-IN — press PASS', corner: 'CORNER — PASS to cross, SHOOT to drive', goal_kick: 'GOAL KICK — PASS short, SHOOT long', free_kick: 'FREE KICK — PASS or SHOOT' }[r.type];
      this.hud.showBanner(label || '', 1800);
    } else {
      this.setControlled(this.nearestUserPlayer(this.ball.pos));
      const label = { throw_in: 'Throw-in', corner: 'Corner', goal_kick: 'Goal kick', free_kick: 'Free kick' }[r.type];
      this.hud.showBanner(label || '', 1200);
    }
  }

  buildWall(r, defTeam) {
    const gx = goalX(this.teams[r.team]); // the goal being attacked = defenders' own goal
    V1.set(gx - r.x, 0, -r.z).normalize();
    const defs = defTeam.activePlayers().filter(p => !p.isKeeper)
      .sort((a, b) => a.pos.distanceToSquared(this.ball.pos) - b.pos.distanceToSquared(this.ball.pos))
      .slice(0, 3);
    defs.forEach((p, i) => {
      V2.set(-V1.z, 0, V1.x).multiplyScalar((i - 1) * 0.7);
      p.pos.set(r.x + V1.x * 9.15 + V2.x, 0, r.z + V1.z * 9.15 + V2.z);
      p.vel.set(0, 0, 0);
    });
  }

  // ---------------- possession & kicking ----------------
  setControlled(p) {
    if (this.userControlled) this.userControlled.model.setSelected(false);
    this.userControlled = p && !p.sentOff ? p : null;
    if (this.userControlled) this.userControlled.model.setSelected(true);
  }

  nearestUserPlayer(pos, excludeKeeper = true) {
    const cands = this.teams[0].activePlayers().filter(p => !(excludeKeeper && p.isKeeper));
    let best = null, bd = 1e9;
    for (const p of cands) {
      const d = p.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  executeKick(p, dir, power, curl = 0, lift = 0, type = 'pass') {
    this.ball.pos.y = Math.max(this.ball.pos.y, BALL_R);
    // No offside directly from goal kicks or corners (throw-ins use type 'throw')
    const offsideExempt = this.restart && (this.restart.type === 'goal_kick' || this.restart.type === 'corner');
    if (!offsideExempt && (type === 'pass' || type === 'through' || type === 'shot')) snapshotOffside(this, p);
    this.ball.kick(dir, power, curl, lift);
    this.ball.lastToucherId = p.id;
    this.ball.lastTouchTeam = p.team;
    this.carrier = null;
    p.kickCooldown = 0.3;
    if (type !== 'throw') p.model.startAction('kick', 1);
    else p.model.startAction('throw');
    if (this.phase === 'KICKOFF_WAIT' || this.phase === 'RESTART_WAIT') {
      this.phase = 'PLAY';
      this.hud.hideBanner();
      this.restart = null;
    }
  }

  executePass(p, mate, through = false, errRad = 0, lead = 0) {
    const target = V1.copy(mate.pos);
    if (through) {
      const d = this.teams[p.team].attackDir;
      const mv = mate.vel.length() > 1 ? V2.copy(mate.vel).normalize() : V2.set(d, 0, 0);
      target.addScaledVector(mv, Math.max(lead, 6));
    } else {
      target.addScaledVector(mate.vel, 0.35); // lead the runner slightly
    }
    const dir = target.sub(p.pos);
    dir.y = 0;
    const dist = dir.length();
    dir.normalize();
    if (errRad > 0) {
      const a = (Math.random() - 0.5) * 2 * errRad;
      const cos = Math.cos(a), sin = Math.sin(a);
      const x = dir.x * cos - dir.z * sin;
      dir.z = dir.x * sin + dir.z * cos;
      dir.x = x;
    }
    const power = THREE.MathUtils.clamp(Math.sqrt(dist) * (through ? 2.9 : 2.5), 9, 28);
    this.intendedReceiver = mate;
    if (p.team === 0 && mate.team === 0) this.setControlled(mate);
    this.executeKick(p, dir, power, 0, dist > 26 ? 0.3 : 0.02, through ? 'through' : 'pass');
  }

  // Turnover reaction lag: when possession changes team, the dispossessed side
  // responds with tier-specific latency (DIFFICULTY.reactionMs).
  notePossession(teamIdx) {
    if (teamIdx === this._possTeamLast) return;
    this._possTeamLast = teamIdx;
    const oppTeam = this.teams[1 - teamIdx];
    const ms = oppTeam.diffProfile.reactionMs ?? 0;
    for (const p of oppTeam.activePlayers()) {
      if (p === this.userControlled || p.isKeeper) continue;
      p.reactionTimer = (ms / 1000) * (0.5 + Math.random() * 0.9);
    }
  }

  startSlide(p) {
    if (p.slide || p.stunned > 0) return;
    const dir = V1.set(Math.sin(p.facing), 0, Math.cos(p.facing)).clone();
    p.slide = { t: 0, dur: 0.72, dir, hitBall: false, fouled: false };
    p.model.startAction('slide', 1);
  }

  // ---------------- goals, cards, fouls ----------------
  onGoal(scoringTeamIdx) {
    this.score[scoringTeamIdx]++;
    this.hud.setScore(this.score[0], this.score[1]);
    const scorer = this.allPlayers.find(pl => pl.id === this.ball.lastToucherId) || this.teams[scoringTeamIdx].players[9];
    const ownGoal = scorer.team !== scoringTeamIdx;
    this.hud.showBanner(ownGoal ? 'OWN GOAL!' : 'GOAL!', 2600, '#46d47e');
    this.stadium.setExcitement(1);
    this.phase = 'GOAL_CELEBRATION';
    this.celebrateT = 0;
    this.scorer = scorer;
    this.concedingTeam = 1 - scoringTeamIdx;
    if (!ownGoal) {
      const celeb = scorer.team === 0 ? (this.cfg.celebrationId || 'celebration_default') : 'celebration_default';
      scorer.model.startAction(celeb);
      scorer.vel.set(0, 0, 0);
    }
    this.stadium.updateScoreboard(this.cfg.userTeamData.short, this.cfg.aiTeamData.short,
      this.score[0], this.score[1], this.clockString());
  }

  giveCard(p, card, spot) {
    if (card === 'yellow' && p.card === 'yellow') card = 'red';
    if (card === 'yellow') { p.card = 'yellow'; this.hud.showBanner('YELLOW CARD', 1800, '#ffb830'); }
    else if (card === 'red') {
      p.card = 'red'; p.sentOff = true;
      p.model.root.visible = false;
      this.hud.showBanner('RED CARD!', 2200, '#ff5566');
      if (p === this.userControlled) this.setControlled(this.nearestUserPlayer(this.ball.pos));
    }
  }

  handleFoul(foul) {
    this.hud.showBanner(foul.type === 'penalty' ? 'PENALTY!' : 'FOUL', 1600, '#ff8866');
    foul.victim.stunned = 1.1;
    foul.victim.model.startAction('getup');
    if (foul.card) this.giveCard(foul.offender, foul.card, foul);
    if (foul.type === 'penalty') {
      this.startPenalty(foul.team, 'match');
    } else {
      this.setupRestart({ type: 'free_kick', team: foul.team, x: foul.x, z: foul.z });
    }
  }

  // ---------------- penalties & shootouts ----------------
  startPenalty(shooterTeamIdx, mode) {
    const atkTeam = this.teams[shooterTeamIdx];
    const end = atkTeam.attackDir;
    const spotX = end * (PITCH.length / 2 - PITCH.penaltySpot);
    this.ball.place(spotX, 0);
    const shooter = mode === 'shootout'
      ? this.nextShootoutTaker(shooterTeamIdx)
      : atkTeam.activePlayers().filter(p => !p.isKeeper).sort((a, b) => (b.role === 'FW') - (a.role === 'FW'))[0];
    const keeper = this.teams[1 - shooterTeamIdx].keeper();
    keeper.pos.set(end * PITCH.length / 2, 0, 0);
    keeper.vel.set(0, 0, 0);
    keeper.facing = Math.atan2(-end, 0);
    shooter.pos.set(spotX - end * 2.2, 0, 0.6);
    shooter.vel.set(0, 0, 0);
    shooter.facing = Math.atan2(end, 0);
    // clear the box
    for (const p of this.allPlayers) {
      if (p === shooter || p === keeper || p.sentOff) continue;
      const dx = Math.abs(p.pos.x - end * PITCH.length / 2);
      if (dx < 20 && Math.abs(p.pos.z) < PITCH.boxWidth / 2 + 2) {
        p.pos.x = end * (PITCH.length / 2 - 24) + (Math.random() - 0.5) * 4;
        p.pos.z = (Math.random() - 0.5) * 30;
      }
    }
    this.pen = {
      mode, shooterTeam: shooterTeamIdx, shooter, keeper, end,
      phase: 'aim', t: 0, aimZ: 0, aimH: 0, dove: false, resolved: false,
      userShoots: shooterTeamIdx === 0, userKeeps: shooterTeamIdx === 1,
    };
    this.phase = 'PENALTY_KICK';
    this.setControlled(this.pen.userShoots ? shooter : null);
    this.hud.showBanner(mode === 'shootout' ? 'PENALTY SHOOT-OUT' : 'PENALTY!', 1600);
    if (this.pen.userShoots) this.hud.showBanner('Aim with MOVE · hold SHOOT for power', 2400);
    else if (this.pen.userKeeps) this.hud.showBanner('Hold MOVE left/right to dive when they shoot!', 2400);
  }

  nextShootoutTaker(teamIdx) {
    const so = this.shootout;
    const list = this.teams[teamIdx].activePlayers().filter(p => !p.isKeeper);
    const idx = so ? so.kickIndex[teamIdx] % list.length : 0;
    return list[idx];
  }

  startShootout() {
    this.wentToPenalties = true;
    this.shootout = { scores: [0, 0], taken: [0, 0], kickIndex: [0, 0], turn: 0 };
    this.hud.showBanner('PENALTY SHOOT-OUT', 2000);
    this.startPenalty(0, 'shootout');
  }

  updatePenalty(dt) {
    const pen = this.pen;
    pen.t += dt;
    this.tvCam.penaltyView(pen.end);

    if (pen.phase === 'aim') {
      const mv = this.input.getMove();
      if (pen.userShoots) {
        pen.aimZ = THREE.MathUtils.clamp(pen.aimZ + mv.x * dt * 4, -3.6, 3.6);
        pen.aimH = THREE.MathUtils.clamp(pen.aimH + mv.y * dt * 1.4, 0.1, 2.6);
        const rel = this.input.released('shoot');
        if (rel != null) this.takePenaltyShot(Math.min(rel / 1.1, 1));
        else if (this.input.isDown('shoot')) this.hud.setPower(Math.min(this.input.heldTime('shoot') / 1.1, 1));
      } else if (pen.t > 1.6) {
        // AI shooter: aim quality by difficulty
        const diff = this.teams[1].diffProfile;
        const err = (Math.random() - 0.5) * 2 * diff.shotErrorRad * 8;
        pen.aimZ = THREE.MathUtils.clamp((Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random() * 1.6) + err, -4.2, 4.2);
        pen.aimH = 0.3 + Math.random() * 1.4;
        this.takePenaltyShot(0.75 + Math.random() * 0.2);
      }
    } else if (pen.phase === 'flight') {
      // keeper dive: user-triggered or AI-scheduled
      if (pen.userKeeps && !pen.dove) {
        const mv = this.input.getMove();
        if (Math.abs(mv.x) > 0.4) this.doDive(Math.sign(mv.x));
      } else if (!pen.userKeeps && !pen.dove && pen.aiDiveAt != null && pen.t >= pen.aiDiveAt) {
        this.doDive(pen.aiDiveSide);
      }
      this.ball.update(dt);
      // resolve at goal line
      const lineX = pen.end * PITCH.length / 2;
      const crossed = pen.end > 0 ? this.ball.pos.x >= lineX : this.ball.pos.x <= lineX;
      const reach = pen.saved && Math.abs(this.ball.pos.x - lineX) < 2.2;
      if (reach) {
        // keeper got there: deflect
        this.ball.vel.set(-pen.end * (8 + Math.random() * 6), 3, (Math.random() - 0.5) * 12);
        this.resolvePenalty('SAVED!');
        return;
      }
      if (crossed) {
        const inGoal = Math.abs(this.ball.pos.z) < PITCH.goalWidth / 2 && this.ball.pos.y < PITCH.goalHeight;
        this.resolvePenalty(inGoal ? 'GOAL!' : 'WIDE!', inGoal);
      } else if (pen.t > 5) {
        this.resolvePenalty('MISS!');
      }
    } else if (pen.phase === 'done') {
      if (pen.t > 1.6) this.afterPenalty();
    }
    // animate the two actors
    pen.shooter.syncModel(dt);
    pen.keeper.syncModel(dt);
  }

  takePenaltyShot(power) {
    const pen = this.pen;
    this.hud.setPower(null);
    const gx = pen.end * PITCH.length / 2;
    V1.set(gx - this.ball.pos.x, 0, pen.aimZ - this.ball.pos.z).normalize();
    const speed = 17 + power * 9;
    this.ball.kick(V1, speed, 0, pen.aimH * 0.055 + power * 0.02);
    pen.shooter.model.startAction('kick', 1);
    pen.phase = 'flight';
    pen.shotZ = pen.aimZ;
    pen.t = 0;
    // AI keeper decides dive (scheduled in sim time, resolved in updatePenalty)
    if (!pen.userKeeps) {
      const diff = this.teams[1 - pen.shooterTeam].diffProfile || this.teams[1].diffProfile;
      const correct = Math.random() < diff.gkDiveSkill * 0.8;
      pen.aiDiveSide = correct ? Math.sign(pen.shotZ || 1) : -Math.sign(pen.shotZ || 1);
      pen.aiDiveAt = 0.1 + Math.random() * 0.2;
    }
  }

  doDive(side) {
    const pen = this.pen;
    if (pen.dove) return;
    pen.dove = true;
    pen.diveSide = side;
    pen.keeper.model.startAction('dive', side * (pen.end > 0 ? -1 : 1));
    pen.keeper.vel.set(0, 0, side * 6.5);
    const diff = pen.userKeeps ? this.teams[0].diffProfile : this.teams[1 - pen.shooterTeam].diffProfile;
    const skill = pen.userKeeps ? 0.9 : (diff?.gkDiveSkill ?? 0.7);
    const sideMatch = Math.sign(pen.shotZ || 1) === side;
    const reachable = Math.abs(pen.shotZ) < 3.4 && pen.aimH < 2.2;
    pen.saved = sideMatch && reachable && Math.random() < skill * (1 - Math.abs(pen.shotZ) / 5.5);
  }

  resolvePenalty(text, scored = false) {
    const pen = this.pen;
    pen.phase = 'done';
    pen.t = 0;
    this.hud.showBanner(text, 1400, scored ? '#46d47e' : '#ffb830');
    pen.scored = scored;
    if (scored && pen.mode === 'match') {
      this.score[pen.shooterTeam]++;
      this.hud.setScore(this.score[0], this.score[1]);
      this.stadium.setExcitement(1);
    }
    if (pen.mode === 'shootout') {
      const so = this.shootout;
      so.taken[pen.shooterTeam]++;
      so.kickIndex[pen.shooterTeam]++;
      if (scored) so.scores[pen.shooterTeam]++;
    }
  }

  afterPenalty() {
    const pen = this.pen;
    this.pen = null;
    this.hud.setPower(null);
    if (pen.mode === 'match') {
      // resume with a goal kick-ish restart: goal → kickoff, miss/save → goal kick
      if (pen.scored) this.setupKickoff(1 - pen.shooterTeam);
      else this.setupRestart({ type: 'goal_kick', team: 1 - pen.shooterTeam, x: pen.end * (PITCH.length / 2 - 5.5), z: 5 });
      return;
    }
    // shootout bookkeeping
    const so = this.shootout;
    const [a, b] = so.scores, [ta, tb] = so.taken;
    // Best-of-5 with early termination; sudden death only decides after complete rounds
    const decided = (ta >= 5 && tb >= 5) ? (ta === tb && a !== b)
      : (a > b + (5 - tb)) || (b > a + (5 - ta));
    this.hud.showBanner(`Shoot-out: ${a} - ${b}`, 1500);
    if (decided) { this.endMatch(); return; }
    so.turn = 1 - so.turn;
    this.startPenalty(so.turn, 'shootout');
  }

  // ---------------- human control ----------------
  updateHumanControl(dt) {
    const input = this.input;
    const p = this.userControlled;
    if (input.pressed('pause')) { this.cb.onPause?.(); input.consumeAll(); return; }
    if (!p || p.sentOff) return;
    if (p.stunned > 0 || p.slide) return;

    const mv = input.getMove();
    const worldMove = V1.set(mv.x, 0, -mv.y);
    const isCarrier = this.carrier === p;
    const waiting = this.phase === 'KICKOFF_WAIT' || this.phase === 'RESTART_WAIT';
    const isTaker = waiting && this.restart?.team === 0 && this.restart?.taker === p;

    // Movement
    if (!waiting || !isTaker) {
      const speed = (input.sprinting ? p.sprintSpeed : p.runSpeed) * mv.mag;
      p._sprinting = input.sprinting;
      V2.copy(worldMove).multiplyScalar(speed);
      p.steer(dt, V2);
    } else {
      p.steer(dt, V2.set(0, 0, 0));
      // aim while waiting
      if (mv.mag > 0.2) p.facing = Math.atan2(worldMove.x, worldMove.z);
    }

    // Restart taking
    if (isTaker) {
      const relPass = input.released('pass'), relShoot = input.released('shoot'), relThrough = input.released('through');
      const r = this.restart;
      if (r.type === 'kickoff' && (relPass != null || relThrough != null)) {
        const mate = this.bestPassTarget(p, worldMove, false) || this.teams[0].players[6];
        this.executePass(p, mate, false);
      } else if (r.type === 'throw_in' && (relPass != null || relThrough != null)) {
        const mate = this.bestPassTarget(p, worldMove, false);
        if (mate) {
          V2.copy(mate.pos).sub(p.pos); V2.y = 0;
          const d = V2.length(); V2.normalize();
          this.intendedReceiver = mate;
          this.setControlled(mate);
          this.executeKick(p, V2, THREE.MathUtils.clamp(d * 0.8, 6, 16), 0, 0.22, 'throw');
        }
      } else if (r.type === 'corner' && (relPass != null || relShoot != null)) {
        // cross into the box
        const end = Math.sign(r.x);
        const tx = end * (PITCH.length / 2 - 9), tz = (Math.random() - 0.5) * 8;
        V2.set(tx - p.pos.x, 0, tz - p.pos.z);
        const d = V2.length(); V2.normalize();
        const drive = relShoot != null;
        this.executeKick(p, V2, drive ? 26 : 19 + d * 0.15, -end * Math.sign(r.z) * 0.5, drive ? 0.12 : 0.4, 'pass');
      } else if ((r.type === 'goal_kick' || r.type === 'free_kick') && (relPass != null || relShoot != null)) {
        if (relShoot != null) {
          // shoot at goal (free kick) or long ball (goal kick)
          const gx = goalX(this.teams[0]);
          if (r.type === 'free_kick' && Math.abs(gx - p.pos.x) < 32) {
            V2.set(gx - this.ball.pos.x, 0, -this.ball.pos.z * 0.85 + (Math.random() - 0.5) * 2);
            V2.normalize();
            this.executeKick(p, V2, 26 + Math.min(this.input.heldTime('shoot'), 1) * 4, (Math.random() - 0.5) * 0.8, 0.22, 'shot');
          } else {
            V2.set(this.teams[0].attackDir, 0, (Math.random() - 0.5) * 0.6).normalize();
            this.executeKick(p, V2, 28, 0, 0.42, 'pass');
          }
        } else {
          const mate = this.bestPassTarget(p, worldMove, false);
          if (mate) this.executePass(p, mate, false);
        }
      }
      if (this.phase === 'PLAY') this.hud.setPower(null);
      else if (input.isDown('shoot')) this.hud.setPower(Math.min(input.heldTime('shoot') / 1.1, 1));
      return;
    }

    if (isCarrier) {
      // charging power bar
      if (input.isDown('shoot')) this.hud.setPower(Math.min(input.heldTime('shoot') / 1.1, 1));
      else this.hud.setPower(null);

      const relShoot = input.released('shoot');
      if (relShoot != null) {
        const power = Math.min(relShoot / 1.1, 1);
        const gx = goalX(this.teams[0]);
        const dir = V2.set(gx - p.pos.x, 0, -p.pos.z * 0.4);
        dir.z += worldMove.z * 14;               // aim with movement
        dir.normalize();
        const curl = THREE.MathUtils.clamp(worldMove.x * -Math.sign(dir.x || 1), -1, 1) * 0.7;
        this.executeKick(p, dir, 17 + power * 15, curl, 0.1 + power * 0.16, 'shot');
        this.hud.setPower(null);
      } else if (input.released('pass') != null) {
        const mate = this.bestPassTarget(p, worldMove, false);
        if (mate) this.executePass(p, mate, false);
        else { V2.copy(worldMove.lengthSq() > 0.04 ? worldMove : V2.set(Math.sin(p.facing), 0, Math.cos(p.facing))).normalize(); this.executeKick(p, V2, 14, 0, 0.02, 'pass'); }
      } else if (input.released('through') != null) {
        const mate = this.bestPassTarget(p, worldMove, true);
        if (mate) this.executePass(p, mate, true, 0, 8);
      }
    } else {
      // defending actions
      if (input.pressed('slide')) this.startSlide(p);
      if (input.pressed('switch')) {
        const next = this.nearestUserPlayer(this.ball.pos);
        if (next && next !== p) this.setControlled(next);
      }
      this.hud.setPower(null);
    }
  }

  // choose pass target by aim direction (or best forward option if no aim)
  bestPassTarget(p, aimDir, through) {
    const mates = this.teams[0].activePlayers().filter(m => m !== p && !m.isKeeper);
    const hasAim = aimDir.lengthSq() > 0.04;
    let best = null, bs = -1e9;
    for (const m of mates) {
      V2.copy(m.pos).sub(p.pos); V2.y = 0;
      const d = V2.length();
      if (d < 2 || d > 48) continue;
      V2.normalize();
      const align = hasAim ? V2.dot(V1.copy(aimDir).normalize()) : 0.3;
      if (hasAim && align < 0.25) continue;
      const fwd = this.teams[0].attackDir * (m.pos.x - p.pos.x);
      let s = align * 3 + (through ? fwd * 0.1 : -d * 0.02);
      if (through && m.role === 'FW') s += 0.6;
      if (s > bs) { bs = s; best = m; }
    }
    return best || (hasAim ? null : mates[0]);
  }

  // ---------------- core update ----------------
  update(dt) {
    if (this.ended || this.paused) return;
    this.input.pollGamepad();
    this.stateT += dt;

    switch (this.phase) {
      case 'REPLAY': {
        const anyKey = this.input.pressed('pass') || this.input.pressed('shoot') || this.input.pressed('slide') || this.input.pressed('through');
        const running = this.replay.step(dt, this.allPlayers, this.ball.mesh, this.ball.pos, this.tvCam);
        if (!running || anyKey) {
          this.replay.stop();
          this.stadium.setExcitement(0);
          this.setupKickoff(this.concedingTeam);
          this.tvCam.snapTo(this.ball.pos);
        }
        break;
      }
      case 'GOAL_CELEBRATION': {
        this.celebrateT += dt;
        for (const p of this.allPlayers) { p.steer(dt, V2.set(0, 0, 0)); p.syncModel(dt); }
        this.tvCam.update(dt, this.scorer.pos.clone().setY(1), V2.set(0, 0, 0), this.phase);
        if (this.celebrateT > 2.4) {
          if (this.replay.start()) { this.phase = 'REPLAY'; this.hud.showBanner('REPLAY', 1200); }
          else { this.stadium.setExcitement(0); this.setupKickoff(this.concedingTeam); }
        }
        break;
      }
      case 'PENALTY_KICK':
        this.updatePenalty(dt);
        break;
      default:
        this.updateOpenPlay(dt);
    }

    // shared visuals
    if (this.phase !== 'REPLAY' && this.phase !== 'PENALTY_KICK' && this.phase !== 'GOAL_CELEBRATION') {
      for (const p of this.allPlayers) if (!p.sentOff) p.syncModel(dt);
    }
    this.stadium.update(dt);
    this.input.endFrame();
  }

  updateOpenPlay(dt) {
    const inPlayState = this.phase === 'PLAY';

    this.updateHumanControl(dt);
    updateAI(this, dt);

    // AI takes restarts after a delay
    if ((this.phase === 'KICKOFF_WAIT' || this.phase === 'RESTART_WAIT') && this.restart) {
      const r = this.restart;
      if (r.team === 1 && this.stateT > 1.4) this.aiTakeRestart(r);
      // failsafe: user idle 12s → auto-take
      else if (r.team === 0 && this.stateT > 12) this.aiTakeRestart(r);
    }

    // integrate slides
    for (const p of this.allPlayers) {
      if (p.kickCooldown > 0) p.kickCooldown -= dt;
      if (!p.slide) continue;
      const s = p.slide;
      s.t += dt;
      const spd = 10.5 * Math.max(0, 1 - s.t / s.dur);
      p.vel.copy(s.dir).multiplyScalar(spd);
      p.pos.addScaledVector(p.vel, dt);
      if (!s.hitBall && p.pos.distanceTo(this.ball.pos) < 1.05 && this.ball.pos.y < 0.8) {
        s.hitBall = true;
        if (this.carrier && this.carrier.team !== p.team) this.carrier = null;
        V2.copy(s.dir).multiplyScalar(11);
        V2.z += (Math.random() - 0.5) * 5;
        this.ball.vel.copy(V2); this.ball.vel.y = 1.2;
        this.ball.lastToucherId = p.id; this.ball.lastTouchTeam = p.team;
        clearOffsideFlags(this);
        this.notePossession(p.team);
      }
      if (!s.fouled && inPlayState) {
        for (const o of this.teams[1 - p.team].activePlayers()) {
          if (o.pos.distanceTo(p.pos) < 0.8 && !o.slide) {
            const foul = evaluateSlideContact(p, o, this);
            if (foul) { s.fouled = true; this.handleFoul(foul); return; }
          }
        }
      }
      if (s.t >= s.dur) { p.slide = null; p.stunned = 0.3; }
    }

    // possession: dribble carry or claims
    if (this.carrier) {
      const c = this.carrier;
      if (c.sentOff || c.stunned > 0) this.carrier = null;
      else if (c.isKeeper) {
        // keeper holds the ball in hands
        this.ball.pos.set(c.pos.x + Math.sin(c.facing) * 0.4, 1.0, c.pos.z + Math.cos(c.facing) * 0.4);
        this.ball.vel.set(0, 0, 0);
      } else {
        const ahead = V2.set(Math.sin(c.facing), 0, Math.cos(c.facing)).multiplyScalar(0.55 + c.vel.length() * 0.055);
        V1.copy(c.pos).add(ahead); V1.y = BALL_R;
        this.ball.pos.lerp(V1, Math.min(1, dt * 14));
        this.ball.vel.copy(c.vel);
        if (this.ball.pos.distanceTo(c.pos) > 1.8) this.carrier = null; // lost it
      }
    }
    if (!this.carrier) {
      this.ball.update(dt);
      if (inPlayState) this.tryClaimBall();
      // standing tackle contest: defender adjacent to a fresh carrier
    } else {
      this.contestPossession(dt);
    }

    if (inPlayState) {
      // goal detection
      const bx = this.ball.pos.x, L = PITCH.length / 2;
      if (Math.abs(bx) > L && Math.abs(this.ball.pos.z) < PITCH.goalWidth / 2 && this.ball.pos.y < PITCH.goalHeight + BALL_R) {
        const endSign = Math.sign(bx);
        const scoringTeam = this.teams[0].attackDir === endSign ? 0 : 1;
        this.onGoal(scoringTeam);
        return;
      }
      // out of play
      const out = checkOutOfPlay(this);
      if (out) { this.setupRestart(out); return; }

      // clock
      this.playSeconds += dt;
      const limit = this.half <= 2 ? this.halfLenSec : this.etHalfLenSec;
      if (this.playSeconds >= limit) this.endHalf();
      this.replay.record(dt, this.allPlayers, this.ball);
    }

    this.hud.setClock(this.displayClock(), this.halfLabel());
    if (Math.floor(this.stateT * 2) !== Math.floor((this.stateT - dt) * 2)) {
      this.stadium.updateScoreboard(this.cfg.userTeamData.short, this.cfg.aiTeamData.short,
        this.score[0], this.score[1], this.clockString());
    }
    this.stadium.setExcitement(Math.max(0, this.stadium.excitement - dt * 0.4));
    this.resolveCollisions(dt);
    this.tvCam.update(dt, this.ball.pos, this.ball.vel, this.phase);
  }

  aiTakeRestart(r) {
    const p = r.taker;
    const team = this.teams[r.team];
    if (r.type === 'corner') {
      const end = Math.sign(r.x);
      const tgt = team.activePlayers().filter(m => m.role === 'FW')[0];
      const tx = tgt ? tgt.pos.x : end * (PITCH.length / 2 - 10);
      V2.set(tx - p.pos.x, 0, (tgt ? tgt.pos.z : 0) - p.pos.z).normalize();
      this.executeKick(p, V2, 21, -end * Math.sign(r.z) * 0.5, 0.38, 'pass');
    } else if (r.type === 'free_kick' && Math.abs(goalX(team) - p.pos.x) < 30) {
      V2.set(goalX(team) - p.pos.x, 0, -p.pos.z * 0.8).normalize();
      this.executeKick(p, V2, 27, (Math.random() - 0.5) * 0.7, 0.24, 'shot');
    } else if (r.type === 'throw_in') {
      const mate = this.aiNearestMate(p, team);
      if (mate) {
        V2.copy(mate.pos).sub(p.pos); V2.y = 0;
        const d = V2.length(); V2.normalize();
        this.executeKick(p, V2, THREE.MathUtils.clamp(d * 0.8, 6, 15), 0, 0.2, 'throw');
      }
    } else {
      const mate = this.aiNearestMate(p, team);
      if (mate) this.executePass(p, mate, false, team.diffProfile.passErrorRad);
    }
  }

  aiNearestMate(p, team) {
    return team.activePlayers().filter(m => m !== p && !m.isKeeper)
      .sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))[0];
  }

  tryClaimBall() {
    if (this.ball.pos.y > 1.25) return;
    const cands = this.allPlayers.filter(p => !p.sentOff && p.stunned <= 0 && !p.slide && (p.kickCooldown ?? 0) <= 0);
    cands.sort((a, b) => a.pos.distanceToSquared(this.ball.pos) - b.pos.distanceToSquared(this.ball.pos));
    for (const p of cands) {
      const r = p.isKeeper && p.diving ? 1.35 : CONTROL_R;
      if (p.pos.distanceTo(this.ball.pos) > r) break;
      // offside check on first touch
      if (p.offsideFlag) {
        this.hud.showBanner('OFFSIDE', 1600, '#ffb830');
        const defTeam = 1 - p.team;
        this.setupRestart({ type: 'free_kick', team: defTeam, x: p.pos.x, z: p.pos.z });
        return;
      }
      // keeper save/catch
      if (p.isKeeper && this.ball.speed > 9) {
        const skill = p.diving?.skill ?? this.teams[p.team].diffProfile.gkDiveSkill;
        if (Math.random() < skill) {
          this.carrier = p;
          p.holdT = 0;
          this.ball.vel.set(0, 0, 0);
          this.ball.lastToucherId = p.id; this.ball.lastTouchTeam = p.team;
          this.hud.showBanner('SAVED!', 1300, '#7fc8ff');
          clearOffsideFlags(this);
          this.notePossession(p.team);
        } else {
          // parry
          this.ball.vel.x *= -0.35;
          this.ball.vel.z += (Math.random() - 0.5) * 10;
          this.ball.vel.y = 3 + Math.random() * 2;
          this.ball.lastToucherId = p.id; this.ball.lastTouchTeam = p.team;
          p.kickCooldown = 0.7;
          clearOffsideFlags(this);
        }
        return;
      }
      if (this.ball.speed > 16) { // too hot to control — first touch knocks it down
        this.ball.vel.multiplyScalar(0.3);
        this.ball.vel.y = 0;
        this.ball.lastToucherId = p.id; this.ball.lastTouchTeam = p.team;
        p.kickCooldown = 0.15;
        clearOffsideFlags(this);
        return;
      }
      this.carrier = p;
      this.ball.lastToucherId = p.id; this.ball.lastTouchTeam = p.team;
      clearOffsideFlags(this);
      this.notePossession(p.team);
      if (p.team === 0) this.setControlled(p);
      return;
    }
  }

  contestPossession(dt) {
    const c = this.carrier;
    if (!c || c.isKeeper) return;
    for (const o of this.teams[1 - c.team].activePlayers()) {
      if (o.slide || o.stunned > 0 || o.isKeeper) continue;
      if (o.pos.distanceTo(this.ball.pos) < 0.55) {
        const aggr = o === this.userControlled ? 0.65 : this.teams[o.team].diffProfile.tackleAggression;
        if (Math.random() < aggr * dt * 1.6) {
          // dispossession: knock ball toward tackler's attacking direction
          V2.set(this.teams[o.team].attackDir, 0, (Math.random() - 0.5) * 1.4).normalize();
          this.ball.vel.copy(V2).multiplyScalar(6.5);
          this.ball.lastToucherId = o.id; this.ball.lastTouchTeam = o.team;
          this.carrier = null;
          o.kickCooldown = 0.12;
          this.notePossession(o.team);
        }
      }
    }
  }

  resolveCollisions(dt) {
    const ps = this.allPlayers;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.sentOff) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.sentOff) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.36 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (0.6 - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  // ---------------- halves & match end ----------------
  endHalf() {
    this.playSeconds = 0;
    if (this.half === 1) {
      this.half = 2;
      this.hud.showBanner('HALF TIME', 2400);
      this.swapSides();
      this.paused = true;
      this.cb.onHalfTime?.(() => { this.paused = false; this.setupKickoff(1); });
    } else if (this.half === 2) {
      if (this.cfg.matchType === 'cup' && this.score[0] === this.score[1]) {
        this.half = 3;
        this.wentToExtraTime = true;
        this.hud.showBanner('EXTRA TIME', 2400, '#ffb830');
        this.swapSides();
        this.setupKickoff(0);
      } else this.endMatch();
    } else if (this.half === 3) {
      this.half = 4;
      this.hud.showBanner('ET — 2nd Period', 2000);
      this.swapSides();
      this.setupKickoff(1);
    } else {
      if (this.cfg.matchType === 'cup' && this.score[0] === this.score[1]) this.startShootout();
      else this.endMatch();
    }
  }

  swapSides() {
    for (const t of this.teams) t.attackDir *= -1;
  }

  endMatch() {
    this.ended = true;
    let [sf, sa] = this.score;
    let result = sf > sa ? 'win' : sf < sa ? 'loss' : 'draw';
    let shootoutScore = null;
    if (this.shootout) {
      const [a, b] = this.shootout.scores;
      shootoutScore = `${a} - ${b}`;
      result = a > b ? 'win' : 'loss';
    }
    this.hud.showBanner('FULL TIME', 2600);
    this.hud.setPower(null);
    setTimeout(() => this.cb.onEnd?.({
      result, scoreFor: sf, scoreAgainst: sa,
      shootoutScore,
      wentToExtraTime: this.wentToExtraTime,
      wentToPenalties: this.wentToPenalties,
      opponentName: this.cfg.aiTeamData.name,
      tierPlayed: this.cfg.tierIndex,
      halfLengthMin: this.cfg.halfLengthMin,
    }), 1800);
  }

  forfeit() {
    this.ended = true;
    this.cb.onEnd?.({
      result: 'loss', scoreFor: this.score[0], scoreAgainst: Math.max(this.score[1], this.score[0] + 1),
      forfeited: true, wentToExtraTime: false, wentToPenalties: false,
      opponentName: this.cfg.aiTeamData.name, tierPlayed: this.cfg.tierIndex, halfLengthMin: this.cfg.halfLengthMin,
    });
  }

  // ---------------- clock helpers ----------------
  displayClock() {
    const scale = this.half <= 2 ? (45 * 60) / this.halfLenSec : (15 * 60) / this.etHalfLenSec;
    const base = { 1: 0, 2: 45, 3: 90, 4: 105 }[this.half] * 60;
    return base + this.playSeconds * scale;
  }
  clockString() {
    const s = this.displayClock();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  halfLabel() {
    return { 1: '1st Half', 2: '2nd Half', 3: 'Extra Time 1', 4: 'Extra Time 2' }[this.half] || '';
  }

  setTactics({ formation, mentality }) {
    if (formation) this.teams[0].setFormation(formation);
    if (mentality) this.teams[0].mentality = mentality;
  }
}

function pickAwayKit(config) {
  // avoid kit clashes: if AI shirt too close to user shirt color, use their alt kit
  const userShirt = (config.userKit || config.userTeamData.kit)[0];
  const aiShirt = config.aiTeamData.kit[0];
  const dist = colorDist(userShirt, aiShirt);
  return dist < 90 ? config.aiTeamData.kit2 : config.aiTeamData.kit;
}
function colorDist(a, b) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

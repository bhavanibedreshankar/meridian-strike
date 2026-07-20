import * as THREE from 'three';
import { PITCH } from './data.js';

// AI brains. Difficulty changes *behavior*: reaction latency, decision cadence & quality,
// positioning discipline, pass/shot error, pressing distance, GK reflexes, support running.
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();

export function ownGoalX(team) { return -team.attackDir * PITCH.length / 2; }
export function goalX(team) { return team.attackDir * PITCH.length / 2; }

function predictBallPos(ball, t, out) {
  // crude forward integration with decay — good enough for chase targeting
  const decay = Math.exp(-0.6 * t);
  out.set(ball.pos.x + ball.vel.x * t * decay, 0, ball.pos.z + ball.vel.z * t * decay);
  return out;
}

export function interceptPoint(player, ball, out) {
  let t = 0.15;
  for (let i = 0; i < 3; i++) {
    predictBallPos(ball, t, out);
    const d = Math.hypot(out.x - player.pos.x, out.z - player.pos.z);
    t = Math.min(1.6, d / Math.max(player.sprintSpeed, 4));
  }
  out.x = THREE.MathUtils.clamp(out.x, -PITCH.length / 2, PITCH.length / 2);
  out.z = THREE.MathUtils.clamp(out.z, -PITCH.width / 2, PITCH.width / 2);
  return out;
}

function moveToward(p, target, speed, dt, sprint = false) {
  p._sprinting = sprint;
  V3.set(target.x - p.pos.x, 0, target.z - p.pos.z);
  const d = V3.length();
  if (d < 0.25) { V3.set(0, 0, 0); }
  else V3.setLength(Math.min(speed, d * 4));
  p.steer(dt, V3);
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-6) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function opponentsOf(match, team) { return match.teams[1 - team.index].activePlayers(); }

// Second-last defender line (in attackDir terms) for offside & run clamping
export function defenderLine(match, attackingTeam) {
  const d = attackingTeam.attackDir;
  const xs = opponentsOf(match, attackingTeam).map(p => d * p.pos.x).sort((a, b) => b - a);
  return xs.length >= 2 ? xs[1] : (xs[0] ?? 0);
}

// ---------- Goalkeeper ----------
function updateKeeper(p, team, match, dt) {
  const diff = team.diffProfile;
  const ball = match.ball;
  const gx = ownGoalX(team);
  const inField = -Math.sign(gx); // direction from goal into the field

  // If keeper holds the ball: distribute
  if (match.carrier === p) {
    p.holdT = (p.holdT || 0) + dt;
    if (p.holdT > 1.1) {
      p.holdT = 0;
      distribute(p, team, match);
    }
    moveToward(p, V1.set(gx + inField * 8, 0, 0), p.runSpeed * 0.5, dt);
    return;
  }
  p.holdT = 0;

  // Dive in progress: keep momentum, match resolves contact
  if (p.diving) {
    p.diving.t += dt;
    if (p.diving.t > 0.9) p.diving = null;
    p.steer(dt, p.diving ? p.diving.vel : V3.set(0, 0, 0));
    return;
  }

  // Detect incoming shot
  const toGoal = gx - ball.pos.x;
  const movingIn = Math.sign(ball.vel.x) === Math.sign(toGoal) && Math.abs(ball.vel.x) > 8;
  const dist = Math.abs(toGoal);
  if (movingIn && dist < 30 && ball.speed > 10) {
    const tLine = toGoal / ball.vel.x;
    if (tLine > 0 && tLine < 1.4) {
      const zPred = ball.pos.z + ball.vel.z * tLine;
      const yPred = Math.max(0, ball.pos.y + ball.vel.y * tLine - 11 * tLine * tLine);
      if (Math.abs(zPred) < PITCH.goalWidth / 2 + 1.4 && yPred < PITCH.goalHeight + 0.6) {
        p.shotTimer = (p.shotTimer ?? 0) + dt;
        if (p.shotTimer * 1000 >= diff.gkReflexMs) {
          const dz = THREE.MathUtils.clamp(zPred - p.pos.z, -4.2, 4.2);
          const side = Math.sign(dz) || 1;
          p.diving = { t: 0, vel: new THREE.Vector3(0, 0, dz * 3.2), skill: diff.gkDiveSkill };
          p.model.startAction('dive', side * (team.attackDir > 0 ? 1 : -1));
          p.shotTimer = 0;
        }
        return; // hold position while reading the shot
      }
    }
  } else {
    p.shotTimer = 0;
  }

  // Loose ball close to goal → claim it
  const dBall = p.pos.distanceTo(ball.pos);
  if (!match.carrier && dBall < 9 && ball.speed < 9 && Math.abs(ball.pos.x - gx) < 17) {
    moveToward(p, ball.pos, p.sprintSpeed, dt, true);
    return;
  }

  // Positioning: on arc between goal center and ball
  V1.set(gx, 0, 0);
  V2.copy(ball.pos).sub(V1).multiplyScalar(0.10).add(V1);
  V2.x = THREE.MathUtils.clamp(V2.x, Math.min(gx, gx + inField * 6.5), Math.max(gx, gx + inField * 6.5));
  V2.z = THREE.MathUtils.clamp(V2.z, -6, 6);
  moveToward(p, V2, p.runSpeed, dt);
}

function distribute(p, team, match) {
  // prefer an open defender; else boot upfield
  const mates = team.activePlayers().filter(m => m !== p);
  const opps = opponentsOf(match, team);
  let best = null, bestScore = -1;
  for (const m of mates) {
    if (m.role !== 'DF' && m.role !== 'MF') continue;
    let openness = 99;
    for (const o of opps) openness = Math.min(openness, distToSegment(o.pos.x, o.pos.z, p.pos.x, p.pos.z, m.pos.x, m.pos.z));
    const score = openness - p.pos.distanceTo(m.pos) * 0.05;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  if (best && bestScore > 2) {
    match.executePass(p, best, false);
  } else {
    V1.set(team.attackDir, 0, (Math.random() - 0.5) * 0.5).normalize();
    match.executeKick(p, V1, 26, 0, 0.5, 'clearance');
  }
}

// ---------- Outfield ----------
export function updateAI(match, dt) {
  for (const team of match.teams) {
    const diff = team.diffProfile;
    // choose chasers: two closest active outfielders to the ball (defending or loose ball)
    const active = team.activePlayers();
    const sorted = active.filter(p => !p.isKeeper && p !== match.userControlled)
      .sort((a, b) => a.pos.distanceToSquared(match.ball.pos) - b.pos.distanceToSquared(match.ball.pos));
    team._chasers = sorted.slice(0, 2);

    for (const p of active) {
      if (p === match.userControlled) continue;
      if (match.restart && match.restart.taker === p && match.phase !== 'PLAY') {
        p.steer(dt, V3.set(0, 0, 0));
        continue; // restart takers hold position until the ball is played
      }
      if (p.stunned > 0) { p.stunned -= dt; p.steer(dt, V3.set(0, 0, 0)); continue; }
      if (p.slide) continue; // match integrates slides
      if (p.reactionTimer > 0) {
        p.reactionTimer -= dt;
        // during reaction lag: keep drifting to previous target
        moveToward(p, p.targetPos, p.runSpeed * 0.8, dt);
        continue;
      }
      if (p.isKeeper) { updateKeeper(p, team, match, dt); continue; }
      if (match.carrier === p) { updateCarrier(p, team, match, dt, diff); continue; }
      updateOffBall(p, team, match, dt, diff);
    }
  }
}

function updateOffBall(p, team, match, dt, diff) {
  const ball = match.ball;
  const possession = match.possessionTeam;
  const defending = possession === 1 - team.index;
  const loose = possession === -1;

  // Chasing duty (only during open play — restarts must not be swarmed)
  if ((defending || loose) && team._chasers.includes(p) && match.phase === 'PLAY') {
    const target = interceptPoint(p, ball, V1);
    // pressing distance gate: only press if within pressing range, else contain
    const d = p.pos.distanceTo(ball.pos);
    const pressRange = diff.pressingDist * team.ment.pressBoost * (loose ? 2.2 : 1);
    if (d < pressRange || loose) {
      moveToward(p, target, p.sprintSpeed, dt, true);
      p.targetPos.copy(target);
      // AI slide tackle decision vs a carrier
      const carrier = match.carrier;
      if (carrier && carrier.team !== team.index && !p.slide) {
        const cd = p.pos.distanceTo(carrier.pos);
        if (cd < 2.3 && cd > 1.1 && Math.random() < diff.tackleAggression * dt * 2.2) {
          match.startSlide(p);
        }
      }
      return;
    }
  }

  // Support runs when attacking
  if (possession === team.index && !p.isKeeper) {
    if (p.supportRun) {
      moveToward(p, p.supportRun, p.sprintSpeed, dt, true);
      if (p.pos.distanceTo(p.supportRun) < 2) p.supportRun = null;
      p.targetPos.copy(p.supportRun || p.pos);
      return;
    }
    if ((p.role === 'FW' || p.role === 'MF') && Math.random() < diff.supportRunProb * team.ment.supportBoost * dt * 0.8) {
      // run into space ahead of the carrier, staying onside when aware
      const carrier = match.carrier;
      if (carrier && carrier !== p) {
        const d = team.attackDir;
        let tx = carrier.pos.x + d * (8 + Math.random() * 10);
        if (Math.random() < diff.offsideAwareness) {
          const line = defenderLine(match, team);
          tx = d > 0 ? Math.min(tx, line - 0.8) : Math.max(tx, -line + 0.8);
        }
        p.supportRun = new THREE.Vector3(
          THREE.MathUtils.clamp(tx, -PITCH.length / 2 + 2, PITCH.length / 2 - 2), 0,
          THREE.MathUtils.clamp(p.pos.z + (Math.random() - 0.5) * 14, -PITCH.width / 2 + 2, PITCH.width / 2 - 2));
      }
    }
  } else {
    p.supportRun = null;
  }

  // Default: hold shape, blended with man-marking by positioning discipline
  team.shapeTarget(p, ball, possession, V1);
  if (defending) {
    // find nearest opponent to mark
    let mark = null, md = 9;
    for (const o of opponentsOf(match, team)) {
      if (o.isKeeper) continue;
      const d = o.pos.distanceTo(p.pos);
      if (d < md) { md = d; mark = o; }
    }
    if (mark) {
      // goal-side of the mark
      V2.set(mark.pos.x - team.attackDir * 1.2, 0, mark.pos.z);
      V1.lerp(V2, diff.positionDiscipline * 0.55);
    }
  }
  p.targetPos.copy(V1);
  const urgency = defending ? 0.95 : 0.8;
  moveToward(p, V1, p.runSpeed * urgency, dt);
}

// ---------- Carrier (on-ball decisions) ----------
function updateCarrier(p, team, match, dt, diff) {
  p.decisionTimer -= dt;
  const d = team.attackDir;
  const gx = goalX(team);
  const distGoal = Math.hypot(gx - p.pos.x, p.pos.z * 0.7);
  const opps = opponentsOf(match, team);
  let nearestOppD = 99, nearestOpp = null;
  for (const o of opps) {
    const od = o.pos.distanceTo(p.pos);
    if (od < nearestOppD) { nearestOppD = od; nearestOpp = o; }
  }
  const pressured = nearestOppD < 2.2;

  if (p.decisionTimer > 0 && !(pressured && p.decisionTimer > 0.25)) {
    // keep dribbling toward current intent
    dribbleMove(p, team, match, dt, nearestOpp);
    return;
  }
  p.decisionTimer = (diff.decisionIntervalMs / 1000) * (0.7 + Math.random() * 0.6);

  // ---- evaluate options ----
  const options = [];
  // Shoot
  if (distGoal < 30) {
    const angleOpen = 1 - Math.min(Math.abs(p.pos.z) / (PITCH.width / 2), 1);
    const gk = match.teams[1 - team.index].keeper();
    const gkOff = Math.min(Math.abs(gk.pos.z - 0) / 4, 1) * 0.3;
    let s = (1 - distGoal / 34) * 1.9 + angleOpen * 0.8 + gkOff;
    if (distGoal < 22) s += 0.7;
    if (distGoal < 16) s += 0.8;
    if (pressured) s += 0.45;   // shoot rather than get dispossessed in range
    options.push({ type: 'shoot', score: s });
  }
  // Passes & through balls
  const mates = team.activePlayers().filter(m => m !== p && !m.isKeeper);
  for (const m of mates) {
    const fwdGain = d * (m.pos.x - p.pos.x);
    const len = p.pos.distanceTo(m.pos);
    if (len < 3 || len > 45) continue;
    let openness = 99;
    for (const o of opps) openness = Math.min(openness, distToSegment(o.pos.x, o.pos.z, p.pos.x, p.pos.z, m.pos.x, m.pos.z));
    let recvPressure = 99;
    for (const o of opps) recvPressure = Math.min(recvPressure, o.pos.distanceTo(m.pos));
    let s = fwdGain * 0.085 + Math.min(openness, 6) * 0.22 + Math.min(recvPressure, 8) * 0.08 - len * 0.012;
    if (fwdGain < -4) s -= 0.5;      // discourage aimless backward recycling
    if (d * p.pos.x > PITCH.length * 0.3) s -= 0.25;  // near goal, shooting > overpassing
    if (pressured) s += 0.25;
    // offside check on the receiving spot (aware AI avoids flagged passes)
    const line = defenderLine(match, team);
    const beyond = d * m.pos.x > Math.max(line, d * match.ball.pos.x) && d * m.pos.x > 0;
    if (beyond && Math.random() < diff.offsideAwareness) s -= 2.5;
    options.push({ type: 'pass', mate: m, score: s });
    // through ball into the run
    if ((m.role === 'FW' || m.role === 'MF') && fwdGain > 4) {
      const lead = Math.min(10, 4 + fwdGain * 0.3);
      const tx = m.pos.x + d * lead;
      let spaceAhead = 99;
      for (const o of opps) spaceAhead = Math.min(spaceAhead, Math.hypot(o.pos.x - tx, o.pos.z - m.pos.z));
      let ts = fwdGain * 0.06 + Math.min(spaceAhead, 8) * 0.2 - 0.2;
      const beyondT = d * tx > Math.max(line, d * match.ball.pos.x);
      if (beyondT && Math.random() < diff.offsideAwareness) ts -= 2.0;
      options.push({ type: 'through', mate: m, lead, score: ts });
    }
  }
  // Dribble — carrying the ball forward is the default when unpressured
  {
    let s = 0.5 + (pressured ? -0.4 : 0.5);
    if (d * p.pos.x > 0 && distGoal > 18) s += 0.2; // drive at goal from the opponent half
    if (p.role === 'FW') s += 0.15;
    options.push({ type: 'dribble', score: s });
  }
  // Panic clearance for defenders deep in their own box under pressure
  if (pressured && d * p.pos.x < -PITCH.length / 2 * 0.6 && p.role === 'DF') {
    options.push({ type: 'clear', score: 1.6 });
  }

  options.sort((a, b) => b.score - a.score);
  const pick = Math.random() < diff.bestChoiceProb ? options[0]
    : options[Math.min(options.length - 1, 1 + Math.floor(Math.random() * 2))];

  switch (pick.type) {
    case 'shoot': {
      V1.set(gx - p.pos.x, 0, -p.pos.z * 0.75 + (Math.random() - 0.5) * 3 - Math.sin(0) * 0).normalize();
      applyAimError(V1, diff.shotErrorRad);
      const power = 24 + Math.random() * 6 + Math.min(distGoal * 0.28, 8);
      match.executeKick(p, V1, power, (Math.random() - 0.5) * 0.5, distGoal > 20 ? 0.24 : 0.12, 'shot');
      break;
    }
    case 'pass': match.executePass(p, pick.mate, false, diff.passErrorRad); break;
    case 'through': match.executePass(p, pick.mate, true, diff.passErrorRad, pick.lead); break;
    case 'clear': {
      V1.set(d, 0, Math.sign(p.pos.z || 1) * 0.7).normalize();
      match.executeKick(p, V1, 27, 0, 0.5, 'clearance');
      break;
    }
    default: dribbleMove(p, team, match, dt, nearestOpp, true);
  }
}

function applyAimError(dir, errRad) {
  const a = (Math.random() - 0.5) * 2 * errRad;
  const cos = Math.cos(a), sin = Math.sin(a);
  const x = dir.x * cos - dir.z * sin;
  dir.z = dir.x * sin + dir.z * cos;
  dir.x = x;
}

function dribbleMove(p, team, match, dt, nearestOpp, fresh = false) {
  const d = team.attackDir;
  // head toward goal, veering away from the nearest presser
  V1.set(d, 0, THREE.MathUtils.clamp(-p.pos.z * 0.02, -0.4, 0.4));
  if (nearestOpp && nearestOpp.pos.distanceTo(p.pos) < 4) {
    V2.set(p.pos.x - nearestOpp.pos.x, 0, p.pos.z - nearestOpp.pos.z).normalize();
    V1.addScaledVector(V2, 0.9);
  }
  V1.normalize();
  V1.multiplyScalar(p.pos.distanceTo(match.ball.pos) > 1.4 ? p.sprintSpeed : p.runSpeed * 0.92);
  p._sprinting = true;
  p.steer(dt, V1);
  p.targetPos.copy(p.pos);
}

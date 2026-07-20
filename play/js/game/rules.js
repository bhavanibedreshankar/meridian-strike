import { PITCH } from './data.js';
import { defenderLine } from './ai.js';

// Laws of the game: offside flags on the pass, out-of-bounds classification,
// foul evaluation for slide tackles.

// Called at the moment team `team` plays the ball (pass/through/shot).
// Flags teammates in an offside position; a flagged first touch = offside.
export function snapshotOffside(match, kicker) {
  const team = match.teams[kicker.team];
  const d = team.attackDir;
  const line = defenderLine(match, team);
  const ballX = d * match.ball.pos.x;
  for (const p of team.players) {
    p.offsideFlag = false;
    if (p === kicker || p.isKeeper || p.sentOff) continue;
    const px = d * p.pos.x;
    const inOppHalf = px > 0;
    if (inOppHalf && px > line && px > ballX) p.offsideFlag = true;
  }
  // opponents never flagged by this snapshot
  for (const p of match.teams[1 - kicker.team].players) p.offsideFlag = false;
}

export function clearOffsideFlags(match) {
  for (const t of match.teams) for (const p of t.players) p.offsideFlag = false;
}

// Ball out of play? Returns null or a restart descriptor.
export function checkOutOfPlay(match) {
  const b = match.ball;
  const L = PITCH.length / 2, W = PITCH.width / 2;
  const lastTeam = b.lastTouchTeam;

  // Goal? checked by match before this (needs y < crossbar at the moment of crossing)
  if (Math.abs(b.pos.z) > W + 0.2) {
    return {
      type: 'throw_in',
      team: lastTeam === -1 ? 0 : 1 - lastTeam,
      x: Math.max(-L + 1, Math.min(L - 1, b.pos.x)),
      z: Math.sign(b.pos.z) * (W - 0.3),
    };
  }
  if (Math.abs(b.pos.x) > L + 0.25) {
    const endSide = Math.sign(b.pos.x);            // which goal line was crossed
    const defendingTeam = match.teams[0].attackDir === endSide ? 1 : 0; // team defending that end
    if (lastTeam === defendingTeam) {
      // defender touched last → corner for the attackers
      return {
        type: 'corner', team: 1 - defendingTeam,
        x: endSide * (L - 0.5), z: Math.sign(b.pos.z || 1) * (W - 0.5),
      };
    }
    return { type: 'goal_kick', team: defendingTeam, x: endSide * (L - 5.5), z: Math.sign(b.pos.z || 1) * 5 };
  }
  return null;
}

// Evaluate a slide-tackle contact. Returns null (fair) or a foul descriptor.
export function evaluateSlideContact(slider, victim, match) {
  if (slider.slide?.hitBall) return null;            // won the ball first — play on
  if (victim.team === slider.team) return null;
  const speed = slider.vel.length();
  const fromBehind = Math.abs(angleDiff(slider.facing, victim.facing)) < Math.PI / 2.5;
  const severity = (speed / 9) * 0.6 + (fromBehind ? 0.4 : 0.1);
  let card = null;
  const roll = Math.random();
  if (severity > 0.8 && roll < 0.22) card = 'red';
  else if (roll < 0.25 + severity * 0.4) card = 'yellow';

  const defTeam = match.teams[slider.team];
  const attackTeam = match.teams[victim.team];
  // in the defending team's own box → penalty
  const boxX = -defTeam.attackDir * PITCH.length / 2;
  const inBoxX = defTeam.attackDir > 0
    ? victim.pos.x < boxX + PITCH.boxLength
    : victim.pos.x > boxX - PITCH.boxLength;
  const penalty = inBoxX && Math.abs(victim.pos.z) < PITCH.boxWidth / 2 &&
    Math.abs(victim.pos.x) > PITCH.length / 2 - PITCH.boxLength;
  return {
    type: penalty ? 'penalty' : 'free_kick',
    team: victim.team, offender: slider, victim, card,
    x: victim.pos.x, z: victim.pos.z,
    attackTeam,
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

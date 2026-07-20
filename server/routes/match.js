'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, sanitizeProfile } = require('../auth');

const router = express.Router();

const TIER_NAMES = ['Amateur', 'Semi-Pro', 'Professional', 'Elite'];
// tierWins needed to advance out of tier index: Amateur→3, Semi-Pro→5, Professional→8
const PROMOTION_WINS = [3, 5, 8];
// coins by tier index: [win, draw, loss]
const REWARDS = [
  [100, 40, 15],
  [180, 70, 25],
  [300, 120, 40],
  [500, 200, 60],
];
const RESULTS = ['win', 'draw', 'loss'];
const HISTORY_CAP = 100;

router.post('/result', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!RESULTS.includes(b.result)) return res.status(400).json({ error: 'invalid result' });
  const scoreFor = Number(b.scoreFor);
  const scoreAgainst = Number(b.scoreAgainst);
  const tierPlayed = Number(b.tierPlayed);
  const halfLengthMin = Number(b.halfLengthMin);
  if (!Number.isInteger(scoreFor) || scoreFor < 0 || !Number.isInteger(scoreAgainst) || scoreAgainst < 0) {
    return res.status(400).json({ error: 'invalid score' });
  }
  if (!Number.isInteger(tierPlayed) || tierPlayed < 0 || tierPlayed > 3) {
    return res.status(400).json({ error: 'invalid tierPlayed' });
  }
  if (!Number.isFinite(halfLengthMin) || halfLengthMin <= 0) {
    return res.status(400).json({ error: 'invalid halfLengthMin' });
  }

  const user = req.user;
  const rewardRow = REWARDS[tierPlayed];
  const coinsAwarded = rewardRow[RESULTS.indexOf(b.result)];

  if (b.result === 'win') user.wins += 1;
  else if (b.result === 'draw') user.draws += 1;
  else user.losses += 1;
  user.coins += coinsAwarded;

  // Promotion only counts wins at (or above) the player's current tier — no
  // farming lower tiers; coins are still paid at the played tier's rate.
  let promoted = false;
  let newTierName = null;
  if (b.result === 'win' && user.careerTier < 3 && tierPlayed >= user.careerTier) {
    user.tierWins += 1;
    if (user.tierWins >= PROMOTION_WINS[user.careerTier]) {
      user.careerTier += 1;
      user.tierWins = 0;
      promoted = true;
      newTierName = TIER_NAMES[user.careerTier];
    }
  }

  user.matchHistory.unshift({
    result: b.result,
    scoreFor,
    scoreAgainst,
    opponentName: String(b.opponentName || 'Unknown').slice(0, 60),
    tierPlayed,
    halfLengthMin,
    wentToExtraTime: !!b.wentToExtraTime,
    wentToPenalties: !!b.wentToPenalties,
    coinsAwarded,
    playedAt: new Date().toISOString(),
  });
  if (user.matchHistory.length > HISTORY_CAP) user.matchHistory.length = HISTORY_CAP;

  db.save();
  res.json({ profile: sanitizeProfile(user), coinsAwarded, promoted, newTierName });
});

router.get('/history', requireAuth, (req, res) => {
  res.json({ matches: req.user.matchHistory });
});

module.exports = router;

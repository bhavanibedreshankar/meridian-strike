'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAuth, sanitizeProfile } = require('../auth');

const router = express.Router();

const STORE_KINDS = { kit: 'kit', stadium: 'stadium', celebration: 'celebration' };

router.get('/', requireAuth, (req, res) => {
  res.json({ profile: sanitizeProfile(req.user) });
});

router.post('/equip', requireAuth, (req, res) => {
  const { slot, itemId } = req.body || {};
  if (!STORE_KINDS[slot]) return res.status(400).json({ error: 'invalid slot' });
  if (typeof itemId !== 'string') return res.status(400).json({ error: 'invalid item' });
  const isDefault = itemId === slot + '_default';
  if (!isDefault && !req.user.unlocks.includes(itemId)) {
    return res.status(400).json({ error: 'item not owned' });
  }
  if (!isDefault && !itemId.startsWith(slot + '_')) {
    return res.status(400).json({ error: 'item does not fit that slot' });
  }
  req.user.equipped[slot] = itemId;
  db.save();
  res.json({ profile: sanitizeProfile(req.user) });
});

// Age-verification stub. Before any live real-money launch this is replaced by
// a licensed identity-verification provider via realmoney/providers.js KycProvider.
router.post('/age-verification', requireAuth, (req, res) => {
  const { birthdate } = req.body || {};
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthdate || ''));
  if (!m) return res.status(400).json({ error: 'birthdate must be YYYY-MM-DD' });
  const dob = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isNaN(dob.getTime())) return res.status(400).json({ error: 'invalid birthdate' });
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < config.MIN_AGE) {
    return res.status(400).json({ error: 'must be at least ' + config.MIN_AGE + ' years old' });
  }
  req.user.ageVerified = true;
  db.save();
  res.json({ profile: sanitizeProfile(req.user) });
});

// Self-exclusion: can only extend, never shorten, until the current period expires.
router.post('/self-exclusion', requireAuth, (req, res) => {
  const days = Number((req.body || {}).days);
  if (!Number.isInteger(days) || days < 1) {
    return res.status(400).json({ error: 'days must be an integer >= 1' });
  }
  const newEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const current = req.user.selfExcludedUntil ? new Date(req.user.selfExcludedUntil) : null;
  if (current && current > new Date() && newEnd < current) {
    return res.status(400).json({ error: 'cannot shorten an active self-exclusion' });
  }
  req.user.selfExcludedUntil = newEnd.toISOString();
  db.save();
  res.json({ profile: sanitizeProfile(req.user) });
});

module.exports = router;

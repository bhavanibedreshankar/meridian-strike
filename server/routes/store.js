'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, sanitizeProfile } = require('../auth');

const router = express.Router();

// Cosmetics only — purchasable with free-play virtual coins. Nothing here
// touches the real-money wallet.
const CATALOG = [
  { id: 'kit_volt', kind: 'kit', name: 'Volt Away Kit', price: 250 },
  { id: 'kit_royal', kind: 'kit', name: 'Royal Third Kit', price: 400 },
  { id: 'kit_obsidian', kind: 'kit', name: 'Obsidian Special Kit', price: 800 },
  { id: 'stadium_sunset', kind: 'stadium', name: 'Sunset Skies', price: 500 },
  { id: 'stadium_neon', kind: 'stadium', name: 'Neon Night', price: 900 },
  { id: 'celebration_knee_slide', kind: 'celebration', name: 'Knee Slide', price: 150 },
  { id: 'celebration_backflip', kind: 'celebration', name: 'Backflip', price: 600 },
  { id: 'celebration_robot', kind: 'celebration', name: 'The Robot', price: 350 },
];

router.get('/catalog', (req, res) => {
  res.json({ items: CATALOG });
});

router.post('/purchase', requireAuth, (req, res) => {
  const { itemId } = req.body || {};
  const item = CATALOG.find((i) => i.id === itemId);
  if (!item) return res.status(400).json({ error: 'unknown item' });
  if (req.user.unlocks.includes(item.id)) return res.status(400).json({ error: 'already owned' });
  if (req.user.coins < item.price) return res.status(400).json({ error: 'insufficient coins' });
  req.user.coins -= item.price;
  req.user.unlocks.push(item.id);
  db.save();
  res.json({ profile: sanitizeProfile(req.user) });
});

module.exports = router;

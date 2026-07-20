'use strict';

const crypto = require('crypto');
const db = require('./db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Public profile shape — never leaks the password hash.
function sanitizeProfile(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    careerTier: user.careerTier,
    tierWins: user.tierWins,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    coins: user.coins,
    unlocks: user.unlocks,
    equipped: user.equipped,
    ageVerified: user.ageVerified,
    selfExcludedUntil: user.selfExcludedUntil,
    createdAt: user.createdAt,
  };
}

function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && db.data.sessions[token];
  const user = session && db.data.users[session.userId];
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  req.token = token;
  next();
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.data.sessions[token] = { userId, createdAt: new Date().toISOString() };
  db.save();
  return token;
}

function register(req, res) {
  const { email, password, displayName } = req.body || {};
  const norm = String(email || '').toLowerCase().trim();
  if (!EMAIL_RE.test(norm)) return res.status(400).json({ error: 'invalid email address' });
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (db.findUserByEmail(norm)) return res.status(409).json({ error: 'email already registered' });

  const id = 'u' + db.nextId('users');
  const name = String(displayName || norm.split('@')[0]).trim().slice(0, 40) || norm.split('@')[0];
  const user = {
    id,
    email: norm,
    passHash: hashPassword(password),
    displayName: name,
    careerTier: 0,
    tierWins: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    coins: 0,
    unlocks: [],
    equipped: { kit: 'kit_default', stadium: 'stadium_default', celebration: 'celebration_default' },
    ageVerified: false,
    selfExcludedUntil: null,
    matchHistory: [],
    createdAt: new Date().toISOString(),
  };
  db.data.users[id] = user;
  db.save();
  const token = createSession(id);
  res.json({ token, profile: sanitizeProfile(user) });
}

function login(req, res) {
  const { email, password } = req.body || {};
  const user = db.findUserByEmail(String(email || ''));
  if (!user || !verifyPassword(String(password || ''), user.passHash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = createSession(user.id);
  res.json({ token, profile: sanitizeProfile(user) });
}

function logout(req, res) {
  delete db.data.sessions[req.token];
  db.save();
  res.json({ ok: true });
}

module.exports = { requireAuth, register, login, logout, sanitizeProfile };

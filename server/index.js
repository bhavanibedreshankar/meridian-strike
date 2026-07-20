'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const { startupInterlock } = require('./realmoney/config-gate');
const { register, login, logout, requireAuth } = require('./auth');

// Must run before anything binds a port.
startupInterlock();

const app = express();
app.use(express.json());

// Landing page at the root; the game itself lives at /play.
const clientDir = path.join(__dirname, '..', 'client');
app.get('/', (req, res) => res.sendFile(path.join(clientDir, 'landing.html')));
app.get('/play', (req, res) => res.sendFile(path.join(clientDir, 'index.html')));

// Static frontend + Three.js (module build imports ./three.core.js, so the
// whole build directory is served).
app.use(express.static(clientDir));
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));

// Auth
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', requireAuth, logout);

// Feature routes
app.use('/api/profile', require('./routes/profile'));
app.use('/api/match', require('./routes/match'));
app.use('/api/store', require('./routes/store'));
app.use('/api/wallet', require('./realmoney/wallet'));

app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('unhandled error:', err);
  res.status(500).json({ error: 'internal error' });
});

app.listen(config.PORT, () => {
  console.log('Meridian Strike server listening on http://localhost:' + config.PORT);
  console.log('  REAL_MONEY_ENABLED = ' + config.REAL_MONEY_ENABLED);
  console.log('  RM_SANDBOX         = ' + config.RM_SANDBOX);
  if (!config.REAL_MONEY_ENABLED) {
    console.log('  ' + config.SANDBOX_NOTICE);
  }
});

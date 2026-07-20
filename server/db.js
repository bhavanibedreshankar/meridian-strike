'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';
const DEBOUNCE_MS = 250;

let data = { users: {}, sessions: {}, counters: {} };
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      data.users = data.users || {};
      data.sessions = data.sessions || {};
      data.counters = data.counters || {};
    }
  } catch (err) {
    console.error('db: failed to load, starting empty:', err.message);
    data = { users: {}, sessions: {}, counters: {} };
  }
}

function persistNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2));
  fs.renameSync(TMP_FILE, DB_FILE);
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      persistNow();
    } catch (err) {
      console.error('db: persist failed:', err.message);
    }
  }, DEBOUNCE_MS);
}

function nextId(counter) {
  data.counters[counter] = (data.counters[counter] || 0) + 1;
  save();
  return data.counters[counter];
}

function findUserByEmail(email) {
  const norm = String(email).toLowerCase();
  return Object.values(data.users).find((u) => u.email === norm) || null;
}

let exiting = false;
function onExit(signal) {
  if (exiting) return;
  exiting = true;
  try {
    persistNow();
  } catch (err) {
    console.error('db: persist on exit failed:', err.message);
  }
  process.exit(signal === 'SIGTERM' ? 0 : 0);
}
process.on('SIGINT', () => onExit('SIGINT'));
process.on('SIGTERM', () => onExit('SIGTERM'));

load();

module.exports = { data, save, persistNow, nextId, findUserByEmail };

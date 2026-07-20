'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const { featureFlag, checkEligibility } = require('./config-gate');
const { getProviders } = require('./providers');

const router = express.Router();

// Always available (no auth): lets the UI show the lockout / sandbox notice.
router.get('/status', (req, res) => {
  res.json({
    enabled: config.REAL_MONEY_ENABLED,
    sandbox: config.RM_SANDBOX,
    notice: config.SANDBOX_NOTICE,
    eligible: null,
  });
});

// Everything below: auth → feature flag → eligibility.
router.use(requireAuth, featureFlag, checkEligibility);

function getWallet(user) {
  if (!user.wallet) {
    user.wallet = {
      balanceCents: 0,
      currency: 'TST',
      ledger: [],
      withdrawals: [],
      paidMatches: {},
    };
  }
  return user.wallet;
}

// Append-only: entries are never edited or deleted by any route.
function appendLedger(wallet, type, amountCents, ref) {
  wallet.balanceCents += amountCents;
  wallet.ledger.push({
    id: 'led_' + db.nextId('ledger'),
    type,
    amountCents,
    balanceAfterCents: wallet.balanceCents,
    ref: ref || null,
    sandbox: true, // RM_SANDBOX is enforced true at startup; every entry is simulated
    createdAt: new Date().toISOString(),
  });
  db.save();
}

// A stake whose match never reported a result (tab closed, crash) must not be
// stranded: refund it once it is older than RM_STAKE_TTL_MS. Settlement stays
// one-shot — refunded matches are marked settled so a late payout gets a 409.
function reconcileStaleStakes(wallet) {
  const now = Date.now();
  for (const [id, m] of Object.entries(wallet.paidMatches || {})) {
    if (m.settled) continue;
    if (now - Date.parse(m.createdAt) > config.RM_STAKE_TTL_MS) {
      m.settled = true;
      m.expired = true;
      appendLedger(wallet, 'entry_fee_refund', m.stakeCents, id);
    }
  }
}

function walletView(wallet) {
  return {
    balanceCents: wallet.balanceCents,
    currency: wallet.currency,
    ledger: wallet.ledger,
    withdrawals: wallet.withdrawals,
  };
}

router.get('/', (req, res) => {
  const wallet = getWallet(req.user);
  reconcileStaleStakes(wallet);
  res.json({ wallet: walletView(wallet), sandbox: true, notice: config.SANDBOX_NOTICE });
});

router.post('/deposit', async (req, res) => {
  const amountCents = Number((req.body || {}).amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100000) {
    return res.status(400).json({ error: 'amountCents must be an integer between 100 and 100000' });
  }
  const wallet = getWallet(req.user);
  const result = await getProviders().deposit.createDeposit(req.user, amountCents);
  if (!result.ok) return res.status(502).json({ error: 'deposit failed' });
  appendLedger(wallet, 'deposit', amountCents, result.providerRef);
  res.json({ wallet: walletView(wallet) });
});

router.post('/enter-match', (req, res) => {
  const stakeCents = Number((req.body || {}).stakeCents);
  if (!Number.isInteger(stakeCents) || stakeCents < 100 || stakeCents > 100000) {
    return res.status(400).json({ error: 'stakeCents must be an integer between 100 and 100000' });
  }
  const wallet = getWallet(req.user);
  reconcileStaleStakes(wallet);
  if (wallet.balanceCents < stakeCents) {
    return res.status(400).json({ error: 'insufficient funds' });
  }
  const paidMatchId = 'pm_' + db.nextId('paid_match');
  wallet.paidMatches[paidMatchId] = { stakeCents, settled: false, createdAt: new Date().toISOString() };
  appendLedger(wallet, 'entry_fee', -stakeCents, paidMatchId);
  res.json({ wallet: walletView(wallet), paidMatchId });
});

router.post('/match-payout', (req, res) => {
  const { paidMatchId, result } = req.body || {};
  if (!['win', 'draw', 'loss'].includes(result)) {
    return res.status(400).json({ error: 'invalid result' });
  }
  const wallet = getWallet(req.user);
  const match = wallet.paidMatches[paidMatchId];
  if (!match) return res.status(400).json({ error: 'unknown paidMatchId' });
  if (match.settled) return res.status(409).json({ error: 'match already settled' });
  match.settled = true;
  let prizeCents = 0;
  if (result === 'win') prizeCents = Math.round(match.stakeCents * 1.8);
  else if (result === 'draw') prizeCents = match.stakeCents;
  if (prizeCents > 0) appendLedger(wallet, 'prize', prizeCents, paidMatchId);
  else db.save();
  res.json({ wallet: walletView(wallet), prizeCents });
});

router.post('/withdraw', async (req, res) => {
  const amountCents = Number((req.body || {}).amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    return res.status(400).json({ error: 'amountCents must be a positive integer' });
  }
  const wallet = getWallet(req.user);
  if (wallet.balanceCents < amountCents) {
    return res.status(400).json({ error: 'insufficient funds' });
  }
  const withdrawalId = 'wd_' + db.nextId('withdrawal');
  const result = await getProviders().payout.createPayout(req.user, amountCents, withdrawalId);
  if (!result.ok) return res.status(502).json({ error: 'payout failed' });
  const withdrawal = {
    id: withdrawalId,
    amountCents,
    status: result.status || 'pending_review',
    providerRef: result.providerRef,
    sandbox: true,
    createdAt: new Date().toISOString(),
  };
  wallet.withdrawals.push(withdrawal);
  appendLedger(wallet, 'withdrawal_request', -amountCents, withdrawalId);
  res.json({ wallet: walletView(wallet), withdrawal });
});

router.get('/withdrawals', (req, res) => {
  const wallet = getWallet(req.user);
  res.json({ withdrawals: wallet.withdrawals });
});

module.exports = router;

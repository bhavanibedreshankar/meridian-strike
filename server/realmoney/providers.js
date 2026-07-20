'use strict';

const config = require('../config');
const db = require('../db');

// Pluggable provider interfaces. A licensed payment processor implements
// DepositProvider/PayoutProvider and an identity-verification service
// implements KycProvider; they are swapped in via getProviders() below with no
// changes to wallet routes or the ledger.

class DepositProvider {
  // → { ok, providerRef }
  async createDeposit(_user, _amountCents) {
    throw new Error('not implemented');
  }
}

class PayoutProvider {
  // → { ok, providerRef, status }
  async createPayout(_user, _amountCents, _withdrawalId) {
    throw new Error('not implemented');
  }
}

class KycProvider {
  // → { verified, providerRef }
  async verifyIdentity(_user, _payload) {
    throw new Error('not implemented');
  }
}

// Sandbox implementations: simulated refs, no external calls, no real funds.
class SandboxDepositProvider extends DepositProvider {
  async createDeposit(_user, _amountCents) {
    return { ok: true, providerRef: 'sandbox_dep_' + db.nextId('sandbox_dep') };
  }
}

class SandboxPayoutProvider extends PayoutProvider {
  async createPayout(_user, _amountCents, _withdrawalId) {
    return {
      ok: true,
      providerRef: 'sandbox_pay_' + db.nextId('sandbox_pay'),
      status: 'pending_review',
    };
  }
}

class SandboxKycProvider extends KycProvider {
  async verifyIdentity(_user, _payload) {
    return { verified: true, providerRef: 'sandbox_kyc_' + db.nextId('sandbox_kyc') };
  }
}

function getProviders() {
  if (config.RM_SANDBOX) {
    return {
      deposit: new SandboxDepositProvider(),
      payout: new SandboxPayoutProvider(),
      kyc: new SandboxKycProvider(),
    };
  }
  // Unreachable today: the startup interlock refuses non-sandbox boots. When
  // licensing lands, return the licensed provider implementations here.
  throw new Error('no live providers configured');
}

module.exports = {
  DepositProvider,
  PayoutProvider,
  KycProvider,
  SandboxDepositProvider,
  SandboxPayoutProvider,
  SandboxKycProvider,
  getProviders,
};

'use strict';

const config = require('../config');

// Safety interlock, checked before the server binds a port. There is no
// licensed payment processor, KYC provider, or jurisdiction service in this
// codebase, so a non-sandbox real-money configuration must never boot.
function startupInterlock() {
  if (config.REAL_MONEY_ENABLED && !config.RM_SANDBOX) {
    console.error(
      'FATAL: REAL_MONEY_ENABLED=true with RM_SANDBOX=false is not a supported ' +
        'configuration. Live real-money play requires licensed payment and ' +
        'identity-verification providers plus jurisdiction gating, none of which ' +
        'are integrated. Refusing to start.'
    );
    process.exit(1);
  }
}

// Gate 1: feature flag. The whole wallet API is off until licensing is in place.
function featureFlag(req, res, next) {
  if (!config.REAL_MONEY_ENABLED) {
    return res.status(403).json({ error: 'real_money_disabled', notice: config.SANDBOX_NOTICE });
  }
  next();
}

// Gate 2: per-user eligibility. The X-Region header is a stub for a real
// geo-IP / jurisdiction service; age verification is a stub for a licensed
// KYC provider (see providers.js).
function checkEligibility(req, res, next) {
  const region = req.get('X-Region') || '';
  if (!config.RM_ALLOWED_REGIONS.includes(region)) {
    return res.status(403).json({ error: 'region_not_eligible' });
  }
  if (!req.user.ageVerified) {
    return res.status(403).json({ error: 'age_verification_required' });
  }
  const excludedUntil = req.user.selfExcludedUntil ? new Date(req.user.selfExcludedUntil) : null;
  if (excludedUntil && excludedUntil > new Date()) {
    return res.status(403).json({ error: 'self_excluded' });
  }
  next();
}

module.exports = { startupInterlock, featureFlag, checkEligibility };

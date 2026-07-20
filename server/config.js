'use strict';

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,

  // Feature flag for the real-money module. Ships DISABLED.
  REAL_MONEY_ENABLED: process.env.REAL_MONEY_ENABLED === 'true',

  // Sandbox mode: all wallet funds are simulated test currency (TST).
  // Defaults TRUE. Turning this off while REAL_MONEY_ENABLED is on trips the
  // startup interlock in realmoney/config-gate.js — live mode requires
  // licensed payment/KYC providers that do not exist in this codebase.
  RM_SANDBOX: process.env.RM_SANDBOX !== 'false',

  // Geo-eligibility stub: comma-separated region codes (e.g. "US-NJ,UK").
  // Empty by default = no region is eligible. A real geo-IP / jurisdiction
  // service replaces the X-Region header check before any live launch.
  RM_ALLOWED_REGIONS: (process.env.RM_ALLOWED_REGIONS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  MIN_AGE: 18,

  // Unsettled entry-fee stakes older than this are auto-refunded on the next
  // wallet access (player closed the tab mid-match, crash, etc.).
  RM_STAKE_TTL_MS: parseInt(process.env.RM_STAKE_TTL_MS, 10) || 24 * 60 * 60 * 1000,

  SANDBOX_NOTICE:
    'Real-money play is unavailable pending licensing. All balances shown are ' +
    'simulated test currency (TST). No deposits, prizes, or withdrawals involve real funds.',
};

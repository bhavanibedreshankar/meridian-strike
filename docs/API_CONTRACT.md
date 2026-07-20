# Meridian Strike — Backend API Contract (v1)

Single Node.js + Express server. **Zero native dependencies** (express is the only npm dep; it is already installed at repo root — do NOT run npm install or edit package.json). Node 24 is available. CommonJS (`require`), port from `process.env.PORT || 3000`.

## Server responsibilities
1. Serve static frontend: `express.static(path.join(__dirname, '..', 'client'))`.
2. Serve Three.js: `app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')))` (the module file imports `./three.core.js`, so serve the whole build dir).
3. JSON API under `/api/*` as specified below. `express.json()` body parsing.
4. Persistence: JSON file store at `server/data/db.json` (create dir/file on boot if missing). In-memory object, atomic-ish persist (write temp file then rename) debounced ~250ms after mutations, plus persist on SIGINT/SIGTERM before exit. Structure: `{ users: {}, sessions: {}, counters: {} }`. **Do not use any database npm package.**
5. `server/data/` must never be required to pre-exist. Add a `.gitignore` in `server/` ignoring `data/`.

## Config — `server/config.js`
```js
module.exports = {
  PORT: env or 3000,
  REAL_MONEY_ENABLED: process.env.REAL_MONEY_ENABLED === 'true',   // default FALSE — ships disabled
  RM_SANDBOX: process.env.RM_SANDBOX !== 'false',                   // default TRUE — simulated funds only
  RM_ALLOWED_REGIONS: [],   // geo-eligibility stub: empty = no region eligible; env RM_ALLOWED_REGIONS comma list
  MIN_AGE: 18,
  SANDBOX_NOTICE: 'Real-money play is unavailable pending licensing. All balances shown are simulated test currency (TST). No deposits, prizes, or withdrawals involve real funds.',
};
```
There must be **no code path that moves real money**. Even when `REAL_MONEY_ENABLED=true`, if `RM_SANDBOX` is true (always, currently) every ledger entry is tagged `sandbox: true` and currency is `'TST'`. If someone sets `RM_SANDBOX=false` while `REAL_MONEY_ENABLED=true`, the server must **refuse to start** with an error explaining live mode requires licensed providers (this is the safety interlock).

## Auth
- Passwords: `crypto.scrypt` (N=16384 via default params are fine), 16-byte random salt per user, store `salt:hexhash`; verify with `crypto.timingSafeEqual`.
- Sessions: 32-byte random hex token, stored in `db.sessions[token] = { userId, createdAt }`, sent by client as `Authorization: Bearer <token>`. Middleware `requireAuth` → 401 `{ error: 'unauthorized' }` if missing/invalid.
- Email: lowercase-normalize, basic regex validation. Password: min 8 chars.

### Endpoints
| Method/Path | Body | Response |
|---|---|---|
| POST `/api/auth/register` | `{email, password, displayName}` | `{token, profile}` — 400 on validation error `{error: '<message>'}`, 409 if email exists |
| POST `/api/auth/login` | `{email, password}` | `{token, profile}` — 401 `{error:'invalid credentials'}` |
| POST `/api/auth/logout` | – (auth) | `{ok:true}` deletes session |
| GET `/api/profile` | (auth) | `{profile}` |

### Profile shape (returned everywhere)
```js
{
  id, email, displayName,
  careerTier: 0,            // 0 Amateur, 1 Semi-Pro, 2 Professional, 3 Elite
  tierWins: 0,              // wins counted toward next promotion (resets on promotion)
  wins: 0, losses: 0, draws: 0,
  coins: 0,                 // virtual free-play currency
  unlocks: [],              // item ids purchased
  equipped: { kit: 'kit_default', stadium: 'stadium_default', celebration: 'celebration_default' },
  ageVerified: false,       // stub for KYC age verification
  selfExcludedUntil: null,  // ISO string or null
  createdAt
}
```
Never return the password hash or email of other users.

## Career & match results — server-authoritative
- Tier names: `['Amateur','Semi-Pro','Professional','Elite']`.
- Promotion thresholds (tierWins needed to advance): Amateur→3, Semi-Pro→5, Professional→8. Elite is final.
- Rewards (coins) by tier index [win, draw, loss]: tier0 [100,40,15], tier1 [180,70,25], tier2 [300,120,40], tier3 [500,200,60].

| Method/Path | Body | Response |
|---|---|---|
| POST `/api/match/result` | (auth) `{result:'win'|'draw'|'loss', scoreFor:int, scoreAgainst:int, opponentName, tierPlayed:int, halfLengthMin:number, wentToExtraTime:bool, wentToPenalties:bool}` | `{profile, coinsAwarded, promoted:bool, newTierName|null}` |
| GET `/api/match/history` | (auth) | `{matches:[{...body fields, coinsAwarded, playedAt}]}` newest first, cap stored history at 100 |

Validate `result` enum and numeric fields (400 otherwise). Only count `tierWins` when `tierPlayed >= profile.careerTier` (no farming lower tiers for promotion; coins still awarded at the played tier's rate).

## Store (virtual coins — cosmetics only)
Catalog hardcoded server-side:
```js
[ {id:'kit_volt', kind:'kit', name:'Volt Away Kit', price:250},
  {id:'kit_royal', kind:'kit', name:'Royal Third Kit', price:400},
  {id:'kit_obsidian', kind:'kit', name:'Obsidian Special Kit', price:800},
  {id:'stadium_sunset', kind:'stadium', name:'Sunset Skies', price:500},
  {id:'stadium_neon', kind:'stadium', name:'Neon Night', price:900},
  {id:'celebration_knee_slide', kind:'celebration', name:'Knee Slide', price:150},
  {id:'celebration_backflip', kind:'celebration', name:'Backflip', price:600},
  {id:'celebration_robot', kind:'celebration', name:'The Robot', price:350} ]
```
| Method/Path | Body | Response |
|---|---|---|
| GET `/api/store/catalog` | – | `{items:[...]}` |
| POST `/api/store/purchase` | (auth) `{itemId}` | `{profile}` — 400 unknown item / already owned / insufficient coins (distinct messages) |
| POST `/api/profile/equip` | (auth) `{slot:'kit'|'stadium'|'celebration', itemId}` | `{profile}` — must own item or be a `*_default` |

## Compliance hooks (account-level, always available)
| Method/Path | Body | Response |
|---|---|---|
| POST `/api/profile/age-verification` | (auth) `{birthdate:'YYYY-MM-DD'}` | `{profile}` — sets `ageVerified` if ≥ MIN_AGE else 400. Comment in code: replaced by licensed identity-verification provider via `KycProvider` before live launch. |
| POST `/api/profile/self-exclusion` | (auth) `{days:int>=1}` | `{profile}` — sets `selfExcludedUntil = now + days`. Irreversible via API until expiry (400 on attempts to shorten). |

## Real-money module — `server/realmoney/` (separate module, gated)
Routes mounted at `/api/wallet`. **Gating chain (in order):**
1. `GET /api/wallet/status` is ALWAYS available (no auth): `{enabled, sandbox, notice, eligible:null}` — used by UI for the lockout notice.
2. Every other wallet route: `requireAuth` → **feature flag** (`REAL_MONEY_ENABLED` false → 403 `{error:'real_money_disabled', notice: SANDBOX_NOTICE}`) → **eligibility gate** `checkEligibility(user, req)`:
   - region: from `X-Region` header (stub for real geo-IP); must be in `RM_ALLOWED_REGIONS` → else 403 `{error:'region_not_eligible'}`
   - `ageVerified` must be true → else 403 `{error:'age_verification_required'}`
   - `selfExcludedUntil` in future → 403 `{error:'self_excluded'}`

### Wallet data (per user, created lazily)
`{ balanceCents: 0, currency: 'TST', ledger: [], withdrawals: [] }`
Ledger entry: `{id, type:'deposit'|'entry_fee'|'entry_fee_refund'|'prize'|'withdrawal_request'|'withdrawal_reversal', amountCents (signed), balanceAfterCents, ref, sandbox:true, createdAt}`. Append-only — no route may edit or delete entries. Unsettled stakes older than `RM_STAKE_TTL_MS` (default 24h) are auto-refunded (`entry_fee_refund`) on the next wallet access; refunded matches count as settled (late payout → 409).

### Provider interfaces — `server/realmoney/providers.js`
Abstract classes with methods that `throw new Error('not implemented')`:
- `DepositProvider.createDeposit(user, amountCents)` → `{ok, providerRef}`
- `PayoutProvider.createPayout(user, amountCents, withdrawalId)` → `{ok, providerRef, status}`
- `KycProvider.verifyIdentity(user, payload)` → `{verified, providerRef}`
Concrete `SandboxDepositProvider` / `SandboxPayoutProvider` / `SandboxKycProvider` implement them with simulated refs like `sandbox_dep_<n>`. A factory selects providers from config; comment that licensed processors (payments) and an identity-verification service (KYC) plug in here without restructuring.

### Endpoints (all gated as above)
| Method/Path | Body | Response |
|---|---|---|
| GET `/api/wallet` | – | `{wallet:{balanceCents,currency,ledger,withdrawals}, sandbox:true, notice}` |
| POST `/api/wallet/deposit` | `{amountCents:int 100..100000}` | `{wallet}` via DepositProvider |
| POST `/api/wallet/enter-match` | `{stakeCents:int}` | `{wallet, paidMatchId}` — 400 insufficient funds; debits `entry_fee` |
| POST `/api/wallet/match-payout` | `{paidMatchId, result:'win'|'draw'|'loss'}` | `{wallet, prizeCents}` — win pays 1.8× stake, draw refunds stake, loss pays 0. One payout per paidMatchId (409 on repeat). |
| POST `/api/wallet/withdraw` | `{amountCents}` | `{wallet, withdrawal:{id,status:'pending_review',sandbox:true}}` — debits balance, creates request via PayoutProvider; status stays `pending_review` (simulated) |
| GET `/api/wallet/withdrawals` | – | `{withdrawals:[...]}` |

## File layout (agent builds exactly this)
```
server/
  index.js          # express app, static serving, route mounting, boot banner (prints flag states)
  config.js
  db.js             # JSON store: load/save/debounce/atomic rename
  auth.js           # scrypt hash/verify, requireAuth middleware, register/login/logout handlers
  routes/profile.js # profile, equip, age-verification, self-exclusion
  routes/match.js   # result + history + career logic
  routes/store.js   # catalog + purchase
  realmoney/config-gate.js  # featureFlag + eligibility middlewares + startup interlock check
  realmoney/providers.js
  realmoney/wallet.js       # routes + ledger ops
  .gitignore
```
Boot banner must print: port, `REAL_MONEY_ENABLED`, `RM_SANDBOX`, and the sandbox notice when disabled.

## Acceptance (agent must run these itself with curl and fix failures)
1. Register → login → profile roundtrip works; wrong password → 401.
2. POST match result win ×3 at tier 0 → `promoted:true`, `careerTier:1`, coins = 300.
3. Purchase `kit_volt` after enough coins; insufficient coins rejected; equip works; equip unowned rejected.
4. `GET /api/wallet/status` → `{enabled:false, sandbox:true, notice:...}`.
5. Any wallet route (e.g. GET /api/wallet) with valid auth → 403 `real_money_disabled` while flag off.
6. With `REAL_MONEY_ENABLED=true RM_ALLOWED_REGIONS=US-NJ` and header `X-Region: US-NJ` but `ageVerified:false` → 403 `age_verification_required`; after age verification → deposit 1000 → enter-match 500 → payout win → balance 1400 (=1000−500+900); ledger shows 3 entries all `sandbox:true`; withdraw 400 → balance 1000, withdrawal `pending_review`.
7. `REAL_MONEY_ENABLED=true RM_SANDBOX=false` → server exits nonzero with interlock message.
8. Restart server → data persisted.

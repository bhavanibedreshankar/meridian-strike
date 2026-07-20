# Meridian Strike ⚽

**[▶ Launch page & playable demo](https://bhavanibedreshankar.github.io/meridian-strike/)** — try it
in your browser right now (guest demo; accounts, career progression and the wallet need the full
server below).

A browser-based 3D soccer game: full 11v11 matches against tiered AI, a career ladder, accounts with
server-side progression, a virtual-coin cosmetic economy — and a **real-money match module that ships
disabled, sandboxed, and gated**, designed so licensed payment/KYC providers can be plugged in later
without restructuring.

All teams, players, kits, and league branding are **original fiction** ("Meridian League"). Nothing
references FIFA, EA, real clubs, or real athletes.

## Run it

```bash
npm install
npm start          # → http://localhost:3000  (launch page; the game itself is at /play)
```

Requires Node 18+ (built on Node 24). The only runtime dependencies are `express` and `three`
(served locally — no CDN needed). Player data persists to `server/data/db.json`.

**Phones:** the game works on Android and iOS browsers — open the same URL from the phone
(same network: use your machine's LAN IP, e.g. `http://192.168.x.x:3000`). Touch controls
(virtual joystick + buttons) appear automatically; play in landscape.

## Controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / Arrows | Left stick | Left virtual joystick |
| Sprint | Shift | RT | Push joystick to the edge |
| Pass | X or K | A | PASS |
| Through ball | C or L | Y | THR |
| Shoot (hold = power, aim with move) | Space | X | SHOOT |
| Slide tackle | V or J | B | SLD |
| Switch player | Q / E / Tab | RB | SW |
| Pause | P / Esc | Start | ⏸ |

Corners/free kicks/throw-ins: the taker waits for PASS (short) or SHOOT (cross/drive/long).
Penalties: aim with move, hold SHOOT for power; when defending, hold left/right as the shooter strikes to dive.

## Guest trial

The sign-in screen has **"Try it free — no account needed"**: 2 full matches as a guest (Amateur
tier, tracked in the browser via localStorage). Results screens nudge toward signup, and once the
trials are used, play is gated behind creating a free account. Guest matches don't touch the server;
career progression, coins, the store, history, and the wallet all require an account. The trial cap
lives in `client/js/main.js` (`trialLimit`).

## Match flow

Sign in / guest trial → team selection → matchmaking (tier, league/cup, half length 1–8 min) → kickoff →
first half → **halftime tactics** (formation 4-4-2 / 4-3-3 / 5-3-2, mentality) → second half →
extra time + penalty shootout (cup matches level after 90) → results → rewards.

Goals get broadcast-style replays (skippable). Rules implemented: offside (flagged at the moment of
the pass), fouls on mistimed slide tackles with yellow/red cards, penalties, corners, throw-ins,
goal kicks, keeper handling/distribution.

## Career tiers

| Tier | Promotion | AI behavior | Stadium | Win reward |
|---|---|---|---|---|
| Amateur | 3 wins | slow reactions, poor decisions, weak pressing | small ground, daylight | 100 coins |
| Semi-Pro | 5 wins | better positioning and passing | mid ground, dusk | 180 coins |
| Professional | 8 wins | disciplined marking, fast reactions | large bowl, floodlit night | 300 coins |
| Elite | — | near-instant reactions, best decision quality | grand stadium, floodlit night | 500 coins |

Difficulty tiers differ in *behavior* — reaction latency, decision cadence/quality, pass & shot error,
positioning discipline, pressing distance, offside awareness, keeper reflexes — not just speed
(see `client/js/game/data.js` → `DIFFICULTY`). Promotion only counts wins at (or above) your current tier.

## Economy design

**Free Play (always on):** every match awards virtual coins (scaled by tier and result). Coins buy
cosmetics only — kits, stadium skins, celebrations (`/api/store/*`). Coins are never withdrawable and
have no cash value.

**Real-Money mode (shipped OFF, sandbox-only):** a separate server module (`server/realmoney/`)
implementing entry-fee matches, prize payouts, an append-only transaction ledger, and withdrawal
requests. Layered gates, in order:

1. **Feature flag** — `REAL_MONEY_ENABLED` (default `false`): every wallet route except
   `GET /api/wallet/status` returns `403 real_money_disabled`. The UI shows a lockout notice.
2. **Sandbox interlock** — `RM_SANDBOX` defaults `true`; every ledger entry is tagged
   `sandbox: true` in simulated test currency (`TST`). Setting `REAL_MONEY_ENABLED=true` with
   `RM_SANDBOX=false` makes the server **refuse to start**.
3. **Eligibility gate stub** — region allowlist (`RM_ALLOWED_REGIONS` vs the `X-Region` header — a
   stand-in for real geo-IP), age verification required, self-exclusion honored.
4. **Pluggable providers** — `server/realmoney/providers.js` defines `DepositProvider`,
   `PayoutProvider`, `KycProvider` abstract interfaces with sandbox implementations; a licensed
   payment processor and identity-verification service drop in behind these without restructuring.

Responsible-play hooks live in the account flow now: age verification (stub) and time-boxed,
non-reversible self-exclusion (Profile screen).

To exercise the sandbox locally (simulated funds only):
```bash
REAL_MONEY_ENABLED=true RM_ALLOWED_REGIONS=US-NJ npm start
```
The region check reads an `X-Region` header (a stand-in for server-side geo-IP). API tests pass it
with curl (`-H 'X-Region: US-NJ'`); in the browser, opt in from DevTools with
`localStorage.setItem('ms_region', 'US-NJ')` — by default the client sends no region and stays
ineligible. Age verification (Profile screen) is also required before the sandbox wallet opens.

### What must exist before real-money mode could ever be enabled

This build **cannot** move real money, by design. Before flipping any switch, the operator must have:

1. **Licensing** — skill-gaming / gambling licenses (or counsel-confirmed exemptions) for every
   jurisdiction served; entry-fee + prize gameplay is regulated activity in most places.
2. **Licensed payment provider** — a regulated processor integrated behind `DepositProvider` /
   `PayoutProvider`, with PCI-compliant flows, chargeback and AML handling.
3. **Certified KYC / identity-verification provider** — real document + age verification behind
   `KycProvider`, replacing the birthdate stub.
4. **Jurisdiction gating** — real geo-IP + address verification replacing the `X-Region` header stub,
   with per-jurisdiction rules.
5. **Responsible-gaming compliance** — deposit/loss limits, enforced self-exclusion registers where
   required, and regulator-mandated disclosures.
6. **Server-authoritative match outcomes** — today the client reports results
   (`/api/match/result`, `/api/wallet/match-payout`), which is fine for a single-player sandbox but
   trivially cheatable; real stakes require server-side simulation/validation or signed outcomes,
   plus anti-abuse controls.
7. Only then: `RM_SANDBOX=false` support would need to be *implemented* (the current code refuses it
   on purpose) plus an independent security and fairness audit.

## Architecture

```
server/               Node + Express (no other runtime deps)
  index.js            static serving + API mounting + boot banner
  auth.js             scrypt+salt hashing, timingSafeEqual, bearer sessions
  db.js               JSON file store, atomic rename writes, debounced persist
  routes/             profile, match results/career, store
  realmoney/          gated wallet module: config-gate, providers, wallet+ledger
client/               browser-native ES modules (no build step), Three.js WebGL
  js/engine/          scene/lighting presets, procedural pitch, stadium+crowd, player rig, ball physics
  js/game/            match state machine, AI brains, rules, controls, TV camera, replays, HUD
  js/ui/              DOM screens (auth, menus, matchmaking, halftime, results, store, wallet, profile)
test/
  headless-sim.mjs    AI-vs-AI full matches in Node (rules/flow regression)
  headless-visuals.mjs  constructs every stadium/pitch/animation without WebGL
```

Run tests: `node test/headless-sim.mjs && node test/headless-visuals.mjs`

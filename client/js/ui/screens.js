import { api } from '../net/api.js';
import { TEAMS, TIERS, LEAGUE_NAME, KIT_VISUALS } from '../game/data.js';

// DOM screen manager. Each method renders one screen into #screen-root.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (c) => `${(c / 100).toFixed(2)} TST`;

export class Screens {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('screen-root');
  }

  clear() { this.root.innerHTML = ''; }

  _show(html, wide = false) {
    this.root.innerHTML = `<div class="screen${wide ? ' wide' : ''}">${html}</div>`;
    return this.root.firstElementChild;
  }

  _title(sub = '') {
    return `<h1>MERIDIAN <span class="brand-accent">STRIKE</span></h1>
      <div class="sub">${esc(LEAGUE_NAME)} — original clubs & players. ${sub}</div>`;
  }

  // ---------- auth ----------
  auth(mode = 'login') {
    const left = this.app.guestTrialsLeft;
    const tryBtn = left > 0
      ? `<button class="btn warn" id="f-try">🎮 Try it free — no account needed <span class="btn-note">${left} of ${this.app.trialLimit} trial ${left === 1 ? 'match' : 'matches'} left</span></button>`
      : `<button class="btn" disabled>🎮 Free trial used — create an account to keep playing</button>`;
    const el = this._show(`
      ${this._title('Sign in to play — or jump straight in.')}
      <div class="row" style="margin-bottom:10px">
        <button class="btn small ${mode === 'login' ? 'primary' : ''}" id="tab-login">Log in</button>
        <button class="btn small ${mode === 'register' ? 'primary' : ''}" id="tab-register">Create account</button>
      </div>
      ${mode === 'register' ? `<label>Display name</label><input id="f-name" maxlength="24" placeholder="e.g. StrikerNine">` : ''}
      <label>Email</label><input id="f-email" type="email" autocomplete="email">
      <label>Password ${mode === 'register' ? '(min 8 characters)' : ''}</label><input id="f-pass" type="password">
      <div class="error-msg" id="f-err"></div>
      <button class="btn primary" id="f-go">${mode === 'login' ? 'Log in' : 'Create account'}</button>
      <div class="sub" style="margin:16px 0 6px;text-align:center">— or —</div>
      ${tryBtn}
      <div class="sub" style="margin-top:16px;text-align:center"><a href="/" style="color:var(--muted)">← About Meridian Strike</a></div>
    `);
    el.querySelector('#tab-login').onclick = () => this.auth('login');
    el.querySelector('#tab-register').onclick = () => this.auth('register');
    el.querySelector('#f-try')?.addEventListener('click', () => this.app.startGuestSession());
    const go = async () => {
      const email = el.querySelector('#f-email').value.trim();
      const pass = el.querySelector('#f-pass').value;
      const err = el.querySelector('#f-err');
      err.textContent = '';
      try {
        const res = mode === 'login'
          ? await api.login(email, pass)
          : await api.register(email, pass, el.querySelector('#f-name').value.trim() || 'Player');
        api.setToken(res.token);
        this.app.guest = false;
        this.app.profile = res.profile;
        this.mainMenu();
      } catch (e) { err.textContent = e.error || 'Something went wrong'; }
    };
    el.querySelector('#f-go').onclick = go;
    el.querySelector('#f-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  // ---------- signup funnel for guests ----------
  signupPrompt(reason) {
    const el = this._show(`
      ${this._title('Create a free account to keep going.')}
      <div class="sandbox-banner" style="border-color:var(--accent);color:var(--accent)">${esc(reason)}</div>
      <div class="sub">With an account you get:</div>
      <ul class="sub" style="margin:0 0 12px 20px; line-height:1.9">
        <li>Unlimited matches — the free trial is just the warm-up</li>
        <li>Career progression: Amateur → Semi-Pro → Professional → Elite</li>
        <li>Coins after every match, spendable on kits, stadiums & celebrations</li>
        <li>Your record and match history saved across devices</li>
      </ul>
      <div class="menu-list">
        <button class="btn primary" id="sp-register">Create free account</button>
        <button class="btn" id="sp-login">I already have one — log in</button>
        ${this.app.guestTrialsLeft > 0 ? '<button class="btn" id="sp-back">← Back</button>' : ''}
      </div>
    `);
    el.querySelector('#sp-register').onclick = () => this.auth('register');
    el.querySelector('#sp-login').onclick = () => this.auth('login');
    el.querySelector('#sp-back')?.addEventListener('click', () => this.mainMenu());
  }

  // ---------- main menu ----------
  mainMenu() {
    if (this.app.guest) return this.guestMenu();
    const p = this.app.profile;
    const tier = TIERS[p.careerTier];
    const next = p.careerTier < 3 ? `${p.tierWins}/${tier.winsToPromote} wins to ${TIERS[p.careerTier + 1].name}` : 'Top tier';
    const el = this._show(`
      ${this._title(`Welcome, <b>${esc(p.displayName)}</b>`)}
      <div class="topline">
        <div>
          <span class="pill green">${esc(tier.name)}</span>
          <span class="pill">${next}</span>
          <span class="pill">${p.wins}W ${p.draws}D ${p.losses}L</span>
        </div>
        <div class="coins-badge">◉ ${p.coins} coins</div>
      </div>
      <div class="menu-list">
        <button class="btn primary" id="m-play">▶ Play Match <span class="btn-note">Free Play</span></button>
        <button class="btn" id="m-career">🏆 Career <span class="btn-note">${esc(tier.name)}</span></button>
        <button class="btn" id="m-store">🛍 Store <span class="btn-note">cosmetics</span></button>
        <button class="btn" id="m-wallet">💰 Real-Money Arena <span class="btn-note" id="m-wallet-note">…</span></button>
        <button class="btn" id="m-profile">👤 Profile & History</button>
        <button class="btn" id="m-settings">⚙ Settings</button>
      </div>
    `);
    el.querySelector('#m-play').onclick = () => this.teamSelect();
    el.querySelector('#m-career').onclick = () => this.career();
    el.querySelector('#m-store').onclick = () => this.store();
    el.querySelector('#m-wallet').onclick = () => this.wallet();
    el.querySelector('#m-profile').onclick = () => this.profileScreen();
    el.querySelector('#m-settings').onclick = () => this.settings();
    api.walletStatus().then(s => {
      const n = el.querySelector('#m-wallet-note');
      if (n) n.textContent = s.enabled ? (s.sandbox ? 'SANDBOX' : 'live') : 'locked';
    }).catch(() => {});
  }

  guestMenu() {
    const p = this.app.profile;
    const left = this.app.guestTrialsLeft;
    const el = this._show(`
      ${this._title('Guest trial — no account yet.')}
      <div class="topline">
        <div>
          <span class="pill gold">GUEST TRIAL</span>
          <span class="pill ${left > 0 ? 'green' : 'red'}">${left > 0 ? `${left} free ${left === 1 ? 'match' : 'matches'} left` : 'trial used up'}</span>
          <span class="pill">${p.wins}W ${p.draws}D ${p.losses}L</span>
        </div>
      </div>
      <div class="menu-list">
        ${left > 0
        ? '<button class="btn primary" id="g-play">▶ Play trial match <span class="btn-note">Amateur tier</span></button>'
        : '<button class="btn primary" id="g-signup-big">🔓 Create free account to keep playing</button>'}
        <button class="btn warn" id="g-signup">✨ Create account — save progress, earn coins, climb tiers</button>
        <button class="btn" id="g-login">Log in</button>
        <button class="btn" id="g-settings">⚙ Settings</button>
      </div>
      <div class="sub" style="margin-top:12px">Career tiers, the store, match history and the wallet unlock with a free account.</div>
    `);
    el.querySelector('#g-play')?.addEventListener('click', () => this.teamSelect());
    el.querySelector('#g-signup-big')?.addEventListener('click', () => this.signupPrompt('You have used your free trial matches — great game, right?'));
    el.querySelector('#g-signup').onclick = () => this.auth('register');
    el.querySelector('#g-login').onclick = () => this.auth('login');
    el.querySelector('#g-settings').onclick = () => this.settings();
  }

  // ---------- team select ----------
  teamSelect() {
    const cards = TEAMS.map((t, i) => `
      <div class="team-card" data-i="${i}">
        <div class="kit-swatch" style="background:#${t.kit[0].toString(16).padStart(6, '0')}"></div>
        <div class="t-name">${esc(t.name)}</div>
        <div class="t-rating">Rating ${t.rating}</div>
      </div>`).join('');
    const el = this._show(`
      ${this._title('Choose your club.')}
      <div class="team-grid">${cards}</div>
      <div class="row" style="margin-top:16px">
        <button class="btn small" id="t-back">← Back</button>
        <div class="grow"></div>
        <button class="btn small primary" id="t-next" disabled>Continue →</button>
      </div>
    `, true);
    let selected = this.app.lastTeamIndex ?? -1;
    const update = () => {
      el.querySelectorAll('.team-card').forEach(c => c.classList.toggle('selected', +c.dataset.i === selected));
      el.querySelector('#t-next').disabled = selected < 0;
    };
    el.querySelectorAll('.team-card').forEach(c => c.onclick = () => { selected = +c.dataset.i; update(); });
    update();
    el.querySelector('#t-back').onclick = () => this.mainMenu();
    el.querySelector('#t-next').onclick = () => { this.app.lastTeamIndex = selected; this.matchmaking(selected); };
  }

  // ---------- matchmaking ----------
  matchmaking(teamIndex) {
    const p = this.app.profile;
    const tierOptions = TIERS.map((t, i) =>
      `<option value="${i}" ${i === p.careerTier ? 'selected' : ''} ${i > p.careerTier ? 'disabled' : ''}>
        ${esc(t.name)}${i > p.careerTier ? ' 🔒' : ''} — ${esc(t.rewardHint)}</option>`).join('');
    const el = this._show(`
      ${this._title('Find an opponent.')}
      <label>Competition tier (unlock higher tiers by winning)</label>
      <select id="mm-tier">${tierOptions}</select>
      <label>Match type</label>
      <select id="mm-type">
        <option value="league">League — draws allowed</option>
        <option value="cup">Cup — extra time & penalties if level</option>
      </select>
      <label>Half length</label>
      <select id="mm-half">
        ${[1, 2, 3, 4, 5, 8].map(m => `<option value="${m}" ${m === this.app.settings.halfLengthMin ? 'selected' : ''}>${m} min</option>`).join('')}
      </select>
      <div id="mm-paid-slot"></div>
      <div class="error-msg" id="mm-err"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn small" id="mm-back">← Back</button>
        <div class="grow"></div>
        <button class="btn small primary" id="mm-find">Find opponent</button>
      </div>
      <div id="mm-result"></div>
    `);
    el.querySelector('#mm-back').onclick = () => this.teamSelect();

    // Paid entry option appears ONLY if the real-money module is enabled server-side
    // (and never for guests — no account means no wallet).
    if (!this.app.guest) api.walletStatus().then(s => {
      if (!s.enabled) return;
      el.querySelector('#mm-paid-slot').innerHTML = `
        <div class="sandbox-banner">🧪 ${esc(s.notice)}</div>
        <label><input type="checkbox" id="mm-paid" style="width:auto"> Entry-fee match (sandbox) — stake
          <select id="mm-stake" style="width:auto"><option value="100">1.00 TST</option><option value="500">5.00 TST</option><option value="1000">10.00 TST</option></select>
        </label>`;
    }).catch(() => {});

    el.querySelector('#mm-find').onclick = async () => {
      const tierIndex = +el.querySelector('#mm-tier').value;
      const matchType = el.querySelector('#mm-type').value;
      const halfLengthMin = +el.querySelector('#mm-half').value;
      this.app.settings.halfLengthMin = halfLengthMin;
      const paidBox = el.querySelector('#mm-paid');
      let paidMatchId = null, stakeCents = 0;
      if (paidBox?.checked) {
        try {
          stakeCents = +el.querySelector('#mm-stake').value;
          const res = await api.enterPaidMatch(stakeCents);
          paidMatchId = res.paidMatchId;
        } catch (e) {
          el.querySelector('#mm-err').textContent = walletError(e);
          return;
        }
      }
      // pick an opponent: different club, rating-weighted by tier
      const pool = TEAMS.map((t, i) => ({ t, i })).filter(x => x.i !== teamIndex);
      const sorted = pool.sort((a, b) => a.t.rating - b.t.rating);
      const idx = Math.min(sorted.length - 1, Math.floor(tierIndex / 3 * sorted.length + Math.random() * 3));
      const opp = sorted[Math.max(0, idx)];
      const box = el.querySelector('#mm-result');
      box.innerHTML = `<div class="sub" style="margin-top:14px">Searching for opponent…</div>`;
      setTimeout(() => {
        box.innerHTML = `
          <h2>Opponent found: ${esc(opp.t.name)} <span class="pill">Rating ${opp.t.rating}</span></h2>
          <div class="sub">${esc(TIERS[tierIndex].name)} · ${matchType === 'cup' ? 'Cup rules' : 'League rules'} · ${halfLengthMin} min halves
          ${paidMatchId ? ' · <b>SANDBOX stake ' + fmtMoney(stakeCents) + '</b>' : ''}</div>
          <button class="btn primary" id="mm-start">⚽ Kick off</button>`;
        box.querySelector('#mm-start').onclick = () => {
          this.clear();
          this.app.startMatch({
            userTeamIndex: teamIndex, aiTeamIndex: opp.i, tierIndex, matchType, halfLengthMin,
            paidMatchId, stakeCents,
          });
        };
      }, 900);
    };
  }

  // ---------- halftime ----------
  halftime(match, resume) {
    const el = this._show(`
      <h1>Half Time</h1>
      <div class="sub">${esc(match.cfg.userTeamData.name)} ${match.score[0]} — ${match.score[1]} ${esc(match.cfg.aiTeamData.name)}</div>
      <h2>Tactics</h2>
      <label>Formation</label>
      <div class="row" id="ht-form">
        ${['4-4-2', '4-3-3', '5-3-2'].map(f => `<button class="btn small ${match.teams[0].formationKey === f ? 'primary' : ''}" data-f="${f}">${f}</button>`).join('')}
      </div>
      <label>Mentality</label>
      <div class="row" id="ht-ment">
        ${['defensive', 'balanced', 'attacking'].map(m => `<button class="btn small ${match.teams[0].mentality === m ? 'primary' : ''}" data-m="${m}">${m}</button>`).join('')}
      </div>
      <button class="btn primary" style="margin-top:18px" id="ht-go">Start 2nd Half</button>
    `);
    el.querySelectorAll('#ht-form button').forEach(b => b.onclick = () => {
      match.setTactics({ formation: b.dataset.f });
      el.querySelectorAll('#ht-form button').forEach(x => x.classList.toggle('primary', x === b));
    });
    el.querySelectorAll('#ht-ment button').forEach(b => b.onclick = () => {
      match.setTactics({ mentality: b.dataset.m });
      el.querySelectorAll('#ht-ment button').forEach(x => x.classList.toggle('primary', x === b));
    });
    el.querySelector('#ht-go').onclick = () => { this.clear(); resume(); };
  }

  // ---------- pause ----------
  pause(match, onResume) {
    const el = this._show(`
      <h1>Paused</h1>
      <div class="menu-list">
        <button class="btn primary" id="p-resume">Resume</button>
        <button class="btn danger" id="p-quit">Forfeit & exit match</button>
      </div>
    `);
    el.querySelector('#p-resume').onclick = () => { this.clear(); onResume(); };
    el.querySelector('#p-quit').onclick = () => { this.clear(); match.forfeit(); };
  }

  // ---------- results ----------
  results(r, serverRes, paidRes) {
    const guest = this.app.guest;
    const left = this.app.guestTrialsLeft;
    const verdict = r.result === 'win' ? '🏆 VICTORY' : r.result === 'draw' ? '🤝 DRAW' : '💔 DEFEAT';
    const promo = serverRes?.promoted
      ? `<div class="sandbox-banner" style="border-color:var(--accent);color:var(--accent)">📈 PROMOTED to <b>${esc(serverRes.newTierName)}</b>! Harder opponents, bigger stadiums, better rewards.</div>` : '';
    const paid = paidRes
      ? `<div class="sandbox-banner">🧪 Sandbox stake settled: ${paidRes.prizeCents > 0 ? 'won ' + fmtMoney(paidRes.prizeCents) : 'no payout'} (simulated funds)</div>` : '';
    const guestNudge = guest
      ? `<div class="sandbox-banner" style="border-color:var(--accent);color:var(--accent)">
          ${left > 0
        ? `🎮 Trial match ${this.app.guestTrialsUsed()} of ${this.app.trialLimit} played — ${left} left. Create a free account to save your record, earn coins, and climb the career ladder.`
        : '🔓 That was your last trial match! Create a free account to keep playing — it takes 20 seconds.'}
        </div>` : '';
    const rewardLine = guest ? '' : (serverRes ? `<h2>+${serverRes.coinsAwarded} coins</h2>` : '<div class="error-msg">Result could not be saved (offline?)</div>');
    const el = this._show(`
      <h1>${verdict}</h1>
      <div class="sub">${esc(r.scoreFor)} — ${esc(r.scoreAgainst)} vs ${esc(r.opponentName)}
        ${r.shootoutScore ? ` · Pens ${esc(r.shootoutScore)}` : ''}${r.wentToExtraTime ? ' · AET' : ''}${r.forfeited ? ' · forfeited' : ''}</div>
      ${rewardLine}
      ${promo}${paid}${guestNudge}
      <div class="menu-list">
        ${guest && left <= 0
        ? '<button class="btn primary" id="r-signup">Create free account</button>'
        : '<button class="btn primary" id="r-again">Play again</button>'}
        ${guest && left > 0 ? '<button class="btn warn" id="r-signup">✨ Create free account</button>' : ''}
        <button class="btn" id="r-menu">Main menu</button>
      </div>
    `);
    el.querySelector('#r-again')?.addEventListener('click', () => this.matchmaking(this.app.lastTeamIndex ?? 0));
    el.querySelector('#r-signup')?.addEventListener('click', () => this.auth('register'));
    el.querySelector('#r-menu').onclick = () => this.mainMenu();
  }

  // ---------- career ----------
  async career() {
    const p = this.app.profile;
    let history = [];
    try { history = (await api.matchHistory()).matches.slice(0, 12); } catch (_) {}
    const steps = TIERS.map((t, i) => `
      <div class="tier-step ${i < p.careerTier ? 'done' : i === p.careerTier ? 'current' : ''}">
        <div class="t-label">${esc(t.name)}</div>
        <div class="t-req">${i < 3 ? `${t.winsToPromote} wins to advance` : 'Top tier'}</div>
        <div class="t-req">${esc(t.rewardHint)}</div>
      </div>`).join('');
    const rows = history.map(m => `
      <tr><td>${esc(m.result).toUpperCase()}</td><td>${m.scoreFor}-${m.scoreAgainst}</td>
      <td>${esc(m.opponentName || '?')}</td><td>${esc(TIERS[m.tierPlayed]?.name || '')}</td><td>+${m.coinsAwarded}</td></tr>`).join('');
    const el = this._show(`
      ${this._title('Career mode.')}
      <div class="tier-track">${steps}</div>
      <div class="sub">Progress: <b>${p.tierWins}</b>/${TIERS[p.careerTier].winsToPromote === Infinity ? '—' : TIERS[p.careerTier].winsToPromote} wins at ${esc(TIERS[p.careerTier].name)} tier.
        Higher tiers bring smarter, faster-reacting AI, bigger floodlit stadiums, and larger coin rewards.</div>
      <h2>Recent matches</h2>
      ${rows ? `<table class="data"><tr><th>Result</th><th>Score</th><th>Opponent</th><th>Tier</th><th>Coins</th></tr>${rows}</table>` : '<div class="sub">No matches yet.</div>'}
      <button class="btn small" style="margin-top:14px" id="c-back">← Back</button>
    `, true);
    el.querySelector('#c-back').onclick = () => this.mainMenu();
  }

  // ---------- store ----------
  async store() {
    const p = this.app.profile;
    let items = [];
    try { items = (await api.storeCatalog()).items; } catch (_) {}
    const card = (it) => {
      const owned = p.unlocks.includes(it.id);
      const equipped = Object.values(p.equipped || {}).includes(it.id);
      const kitSw = it.kind === 'kit' && KIT_VISUALS[it.id]
        ? `<div class="kit-swatch" style="background:#${KIT_VISUALS[it.id][0].toString(16).padStart(6, '0')};margin:0 0 6px"></div>` : '';
      return `<div class="store-item">
        ${kitSw}<div class="s-kind">${esc(it.kind)}</div><div class="s-name">${esc(it.name)}</div>
        <div class="row">
          ${owned
          ? `<button class="btn small ${equipped ? 'primary' : ''}" data-equip="${esc(it.id)}" data-kind="${esc(it.kind)}">${equipped ? 'Equipped' : 'Equip'}</button>`
          : `<button class="btn small warn" data-buy="${esc(it.id)}" ${p.coins < it.price ? 'disabled' : ''}>◉ ${it.price}</button>`}
        </div></div>`;
    };
    const el = this._show(`
      ${this._title('Cosmetic store — virtual coins only.')}
      <div class="topline"><h2>Store</h2><div class="coins-badge">◉ ${p.coins} coins</div></div>
      <div class="error-msg" id="s-err"></div>
      <div class="store-grid">${items.map(card).join('')}</div>
      <button class="btn small" style="margin-top:14px" id="s-back">← Back</button>
    `, true);
    el.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => {
      try {
        const res = await api.purchase(b.dataset.buy);
        this.app.profile = res.profile;
        this.store();
      } catch (e) { el.querySelector('#s-err').textContent = e.error || 'Purchase failed'; }
    });
    el.querySelectorAll('[data-equip]').forEach(b => b.onclick = async () => {
      const kindToSlot = { kit: 'kit', stadium: 'stadium', celebration: 'celebration' };
      try {
        const res = await api.equip(kindToSlot[b.dataset.kind], b.dataset.equip);
        this.app.profile = res.profile;
        this.store();
      } catch (e) { el.querySelector('#s-err').textContent = e.error || 'Equip failed'; }
    });
    el.querySelector('#s-back').onclick = () => this.mainMenu();
  }

  // ---------- wallet / real-money (gated) ----------
  async wallet() {
    let status = { enabled: false, sandbox: true, notice: 'Real-money play is unavailable.' };
    try { status = await api.walletStatus(); } catch (_) {}

    if (!status.enabled) {
      const el = this._show(`
        ${this._title('Real-Money Arena')}
        <div class="lock-banner">🔒 <b>Real-money mode is not available.</b><br>${esc(status.notice)}<br><br>
        Before this mode can ever be enabled, the operator must complete: gambling/skill-gaming licensing for each
        jurisdiction, integration of a licensed payment processor, a certified KYC / identity-verification provider,
        geo-eligibility enforcement, and responsible-play controls. Age verification and self-exclusion settings are
        available now in your Profile.</div>
        <button class="btn small" id="w-back">← Back</button>
      `);
      el.querySelector('#w-back').onclick = () => this.mainMenu();
      return;
    }

    // Enabled (sandbox) view
    let w = null, err = null;
    try { w = (await api.wallet()).wallet; } catch (e) { err = e; }
    if (err) {
      const el = this._show(`
        ${this._title('Real-Money Arena (sandbox)')}
        <div class="lock-banner">🔒 Not eligible: <b>${esc(walletError(err))}</b><br>
        Complete age verification in Profile, ensure you are in an eligible region, and check self-exclusion status.</div>
        <button class="btn small" id="w-back">← Back</button>
      `);
      el.querySelector('#w-back').onclick = () => this.mainMenu();
      return;
    }
    const ledgerRows = w.ledger.slice(-12).reverse().map(e => `
      <tr><td>${esc(e.type)}</td><td>${e.amountCents > 0 ? '+' : ''}${fmtMoney(e.amountCents)}</td>
      <td>${fmtMoney(e.balanceAfterCents)}</td><td>${e.sandbox ? '🧪' : ''}</td></tr>`).join('');
    const wdRows = (w.withdrawals || []).slice(-6).reverse().map(x => `
      <tr><td>${fmtMoney(x.amountCents)}</td><td>${esc(x.status)}</td><td>🧪</td></tr>`).join('');
    const el = this._show(`
      ${this._title('Real-Money Arena — SANDBOX')}
      <div class="sandbox-banner">🧪 <b>SANDBOX MODE</b> — ${esc(status.notice)}</div>
      <div class="topline"><h2>Balance: ${fmtMoney(w.balanceCents)}</h2></div>
      <div class="row">
        <button class="btn small warn" id="w-dep">Simulated deposit +10.00 TST</button>
        <button class="btn small" id="w-wd">Request withdrawal 5.00 TST</button>
      </div>
      <div class="error-msg" id="w-err"></div>
      <h2>Ledger</h2>
      ${ledgerRows ? `<table class="data"><tr><th>Type</th><th>Amount</th><th>Balance</th><th></th></tr>${ledgerRows}</table>` : '<div class="sub">No transactions.</div>'}
      <h2>Withdrawal requests</h2>
      ${wdRows ? `<table class="data"><tr><th>Amount</th><th>Status</th><th></th></tr>${wdRows}</table>` : '<div class="sub">None.</div>'}
      <div class="sub" style="margin-top:8px">Entry-fee matches are started from Matchmaking when this mode is enabled.</div>
      <button class="btn small" id="w-back">← Back</button>
    `, true);
    el.querySelector('#w-dep').onclick = async () => {
      try { await api.deposit(1000); this.wallet(); }
      catch (e) { el.querySelector('#w-err').textContent = walletError(e); }
    };
    el.querySelector('#w-wd').onclick = async () => {
      try { await api.withdraw(500); this.wallet(); }
      catch (e) { el.querySelector('#w-err').textContent = walletError(e); }
    };
    el.querySelector('#w-back').onclick = () => this.mainMenu();
  }

  // ---------- profile ----------
  profileScreen() {
    const p = this.app.profile;
    const excluded = p.selfExcludedUntil && new Date(p.selfExcludedUntil) > new Date();
    const el = this._show(`
      ${this._title('Profile & responsible play.')}
      <h2>${esc(p.displayName)}</h2>
      <div class="sub">${esc(p.email)} · joined ${new Date(p.createdAt).toLocaleDateString()}</div>
      <div>
        <span class="pill green">${esc(TIERS[p.careerTier].name)}</span>
        <span class="pill">${p.wins}W ${p.draws}D ${p.losses}L</span>
        <span class="pill gold">◉ ${p.coins}</span>
        <span class="pill ${p.ageVerified ? 'green' : 'red'}">${p.ageVerified ? 'Age verified ✓' : 'Age not verified'}</span>
        ${excluded ? `<span class="pill red">Self-excluded until ${new Date(p.selfExcludedUntil).toLocaleDateString()}</span>` : ''}
      </div>
      <h2>Age verification</h2>
      <div class="sub">Required before any real-money play. In production this is replaced by a certified
        identity-verification (KYC) provider — this stub only checks a date of birth.</div>
      <div class="row"><input id="pr-dob" type="date" style="max-width:200px"><button class="btn small" id="pr-verify" ${p.ageVerified ? 'disabled' : ''}>Verify</button></div>
      <h2>Self-exclusion</h2>
      <div class="sub">Block yourself from real-money play for a period. This cannot be undone early.</div>
      <div class="row">
        <select id="pr-days" style="max-width:200px">
          <option value="7">7 days</option><option value="30">30 days</option><option value="180">180 days</option>
        </select>
        <button class="btn small danger" id="pr-exclude">Self-exclude</button>
      </div>
      <div class="error-msg" id="pr-err"></div><div class="ok-msg" id="pr-ok"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn small" id="pr-back">← Back</button>
        <div class="grow"></div>
        <button class="btn small danger" id="pr-logout">Log out</button>
      </div>
    `);
    el.querySelector('#pr-verify').onclick = async () => {
      try {
        const res = await api.ageVerification(el.querySelector('#pr-dob').value);
        this.app.profile = res.profile;
        el.querySelector('#pr-ok').textContent = 'Age verified.';
        setTimeout(() => this.profileScreen(), 700);
      } catch (e) { el.querySelector('#pr-err').textContent = e.error || 'Verification failed'; }
    };
    el.querySelector('#pr-exclude').onclick = async () => {
      if (!confirm('Self-exclusion blocks real-money play for the whole period and cannot be reversed early. Continue?')) return;
      try {
        const res = await api.selfExclusion(+el.querySelector('#pr-days').value);
        this.app.profile = res.profile;
        this.profileScreen();
      } catch (e) { el.querySelector('#pr-err').textContent = e.error || 'Failed'; }
    };
    el.querySelector('#pr-back').onclick = () => this.mainMenu();
    el.querySelector('#pr-logout').onclick = async () => {
      await api.logout();
      api.setToken(null);
      this.app.profile = null;
      this.auth('login');
    };
  }

  // ---------- settings ----------
  settings() {
    const s = this.app.settings;
    const el = this._show(`
      ${this._title('Settings.')}
      <label>Default half length</label>
      <select id="st-half">${[1, 2, 3, 4, 5, 8].map(m => `<option value="${m}" ${m === s.halfLengthMin ? 'selected' : ''}>${m} minutes</option>`).join('')}</select>
      <h2>Controls</h2>
      <table class="data">
        <tr><th>Action</th><th>Keyboard</th><th>Gamepad</th><th>Touch</th></tr>
        <tr><td>Move</td><td>WASD / Arrows</td><td>Left stick</td><td>Left joystick</td></tr>
        <tr><td>Sprint</td><td>Shift</td><td>RT</td><td>Push joystick to edge</td></tr>
        <tr><td>Pass</td><td>X or K</td><td>A</td><td>PASS</td></tr>
        <tr><td>Through ball</td><td>C or L</td><td>Y</td><td>THR</td></tr>
        <tr><td>Shoot (hold = power)</td><td>Space</td><td>X</td><td>SHOOT</td></tr>
        <tr><td>Slide tackle</td><td>V or J</td><td>B</td><td>SLD</td></tr>
        <tr><td>Switch player</td><td>Q / E</td><td>RB</td><td>SW</td></tr>
        <tr><td>Pause</td><td>P / Esc</td><td>Start</td><td>⏸ button</td></tr>
      </table>
      <button class="btn small" style="margin-top:14px" id="st-back">← Back</button>
    `, true);
    el.querySelector('#st-half').onchange = (e) => { s.halfLengthMin = +e.target.value; };
    el.querySelector('#st-back').onclick = () => this.mainMenu();
  }
}

function walletError(e) {
  const map = {
    real_money_disabled: 'Real-money mode is disabled pending licensing.',
    region_not_eligible: 'Your region is not eligible.',
    age_verification_required: 'Age verification required (see Profile).',
    self_excluded: 'You are currently self-excluded.',
  };
  return map[e.error] || e.error || 'Unavailable';
}

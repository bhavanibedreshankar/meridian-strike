// Thin fetch wrapper for the Meridian Strike backend (see docs/API_CONTRACT.md).
const TOKEN_KEY = 'ms_token';

let token = localStorage.getItem(TOKEN_KEY) || null;

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Sandbox-only geo stub: real geo-IP replaces this before any live launch.
  // Default (unset) = not eligible. Set via: localStorage.setItem('ms_region', 'US-NJ')
  const region = localStorage.getItem('ms_region');
  if (region) headers['X-Region'] = region;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw { status: 0, error: 'Cannot reach server. Is it running?' };
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* empty body */ }
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

export const api = {
  get hasToken() { return !!token; },
  setToken(t) { token = t; if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); },

  register: (email, password, displayName) => request('POST', '/api/auth/register', { email, password, displayName }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  logout: () => request('POST', '/api/auth/logout').catch(() => ({})),
  profile: () => request('GET', '/api/profile'),

  matchResult: (payload) => request('POST', '/api/match/result', payload),
  matchHistory: () => request('GET', '/api/match/history'),

  storeCatalog: () => request('GET', '/api/store/catalog'),
  purchase: (itemId) => request('POST', '/api/store/purchase', { itemId }),
  equip: (slot, itemId) => request('POST', '/api/profile/equip', { slot, itemId }),

  ageVerification: (birthdate) => request('POST', '/api/profile/age-verification', { birthdate }),
  selfExclusion: (days) => request('POST', '/api/profile/self-exclusion', { days }),

  walletStatus: () => request('GET', '/api/wallet/status'),
  wallet: () => request('GET', '/api/wallet'),
  deposit: (amountCents) => request('POST', '/api/wallet/deposit', { amountCents }),
  enterPaidMatch: (stakeCents) => request('POST', '/api/wallet/enter-match', { stakeCents }),
  paidMatchPayout: (paidMatchId, result) => request('POST', '/api/wallet/match-payout', { paidMatchId, result }),
  withdraw: (amountCents) => request('POST', '/api/wallet/withdraw', { amountCents }),
};

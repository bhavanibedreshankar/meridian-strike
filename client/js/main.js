import { SceneManager } from './engine/scene.js';
import { buildPitch } from './engine/pitch.js';
import { Stadium } from './engine/stadium.js';
import { Match } from './game/match.js';
import { Input } from './game/controls.js';
import { HUD } from './game/hud.js';
import { Screens } from './ui/screens.js';
import { api } from './net/api.js';
import { TEAMS, TIERS, DIFFICULTY, KIT_VISUALS, STADIUM_VISUALS } from './game/data.js';

class App {
  constructor() {
    this.sceneMgr = new SceneManager(document.getElementById('game-canvas'));
    buildPitch(this.sceneMgr);
    this.input = new Input();
    this.hud = new HUD();
    this.screens = new Screens(this);
    this.profile = null;
    this.guest = false;
    this.trialLimit = 2;   // free matches before an account is required
    this.settings = { halfLengthMin: 3 };
    this.match = null;
    this.stadium = null;
    this.menuCamT = 0;
    this.lastT = performance.now();

    this.buildStadiumForTier(0);
    this.hud.onPause(() => { if (this.match && !this.match.ended) this.pauseMatch(); });
    this.setupOrientationGate();
    requestAnimationFrame((t) => this.frame(t));
    this.boot();
  }

  async boot() {
    if (api.hasToken) {
      try {
        const res = await api.profile();
        this.profile = res.profile;
        this.screens.mainMenu();
        this.buildStadiumForTier(this.profile.careerTier);
        return;
      } catch (_) { api.setToken(null); }
    }
    this.screens.auth('login');
  }

  // ---- guest trial mode: play without an account, capped at trialLimit matches ----
  guestTrialsUsed() { return parseInt(localStorage.getItem('ms_guest_trials') || '0', 10); }
  get guestTrialsLeft() { return Math.max(0, this.trialLimit - this.guestTrialsUsed()); }

  startGuestSession() {
    const rec = this._guestRecord();
    this.guest = true;
    this.profile = {
      displayName: 'Guest', email: '', careerTier: 0, tierWins: 0,
      wins: rec.wins, draws: rec.draws, losses: rec.losses,
      coins: 0, unlocks: [],
      equipped: { kit: 'kit_default', stadium: 'stadium_default', celebration: 'celebration_default' },
      ageVerified: false, selfExcludedUntil: null, createdAt: new Date().toISOString(),
      guest: true,
    };
    this.buildStadiumForTier(0);
    this.screens.mainMenu();
  }

  _guestRecord() {
    try { return JSON.parse(localStorage.getItem('ms_guest_record')) || { wins: 0, draws: 0, losses: 0 }; }
    catch (_) { return { wins: 0, draws: 0, losses: 0 }; }
  }

  _recordGuestMatch(result) {
    localStorage.setItem('ms_guest_trials', String(this.guestTrialsUsed() + 1));
    const rec = this._guestRecord();
    rec[result === 'win' ? 'wins' : result === 'draw' ? 'draws' : 'losses']++;
    localStorage.setItem('ms_guest_record', JSON.stringify(rec));
    Object.assign(this.profile, rec);
  }

  buildStadiumForTier(tierIndex, stadiumCosmetic = null) {
    if (this.stadium) this.stadium.dispose();
    const tier = TIERS[Math.min(tierIndex, TIERS.length - 1)];
    const visual = stadiumCosmetic ? STADIUM_VISUALS[stadiumCosmetic] : null;
    this.stadium = new Stadium(this.sceneMgr, {
      size: tier.stadium,
      crowdDensity: tier.crowdDensity,
      accent: visual?.accent ?? null,
    });
    this.sceneMgr.applyLighting(tier.lighting, visual);
  }

  startMatch({ userTeamIndex, aiTeamIndex, tierIndex, matchType, halfLengthMin, paidMatchId, stakeCents }) {
    if (this.guest && this.guestTrialsLeft <= 0) {
      this.screens.signupPrompt('Your free trial is over — create an account to keep playing.');
      return;
    }
    const p = this.profile;
    this.buildStadiumForTier(tierIndex, p.equipped?.stadium !== 'stadium_default' ? p.equipped?.stadium : null);
    const userKitId = p.equipped?.kit;
    const config = {
      userTeamData: TEAMS[userTeamIndex],
      aiTeamData: TEAMS[aiTeamIndex],
      tierIndex, matchType, halfLengthMin,
      difficulty: DIFFICULTY[tierIndex],
      teammateDifficulty: DIFFICULTY[Math.max(0, Math.min(tierIndex, 2))],
      userKit: userKitId && userKitId !== 'kit_default' ? KIT_VISUALS[userKitId] : null,
      celebrationId: p.equipped?.celebration !== 'celebration_default' ? p.equipped?.celebration : 'celebration_default',
      userFormation: '4-4-2',
      paidMatchId, stakeCents,
    };
    this.input.enabled = true;
    this.match = new Match({
      sceneMgr: this.sceneMgr,
      stadium: this.stadium,
      input: this.input,
      hud: this.hud,
      config,
      callbacks: {
        onEnd: (r) => this.onMatchEnd(r),
        onHalfTime: (resume) => this.screens.halftime(this.match, resume),
        onPause: () => this.pauseMatch(),
      },
    });
    this.hud.show(TEAMS[userTeamIndex].short, TEAMS[aiTeamIndex].short, this.input.usingTouch || this.sceneMgr.isMobile);
    this.requestFullscreenIfMobile();
  }

  pauseMatch() {
    if (!this.match || this.match.ended) return;
    this.match.paused = true;
    this.screens.pause(this.match, () => { this.match.paused = false; });
  }

  async onMatchEnd(r) {
    const wasMatch = this.match;
    this.hud.hide();
    this.input.enabled = false;
    let serverRes = null, paidRes = null;
    if (this.guest) {
      this._recordGuestMatch(r.result);   // trials are counted locally, nothing hits the server
    } else {
      try {
        serverRes = await api.matchResult({
          result: r.result, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst,
          opponentName: r.opponentName, tierPlayed: r.tierPlayed,
          halfLengthMin: r.halfLengthMin,
          wentToExtraTime: !!r.wentToExtraTime, wentToPenalties: !!r.wentToPenalties,
        });
        this.profile = serverRes.profile;
      } catch (_) { /* offline: results screen shows warning */ }
      if (wasMatch.cfg.paidMatchId) {
        try { paidRes = await api.paidMatchPayout(wasMatch.cfg.paidMatchId, r.result); }
        catch (_) { /* gated or failed — ignore in sandbox */ }
      }
    }
    wasMatch.dispose();
    this.match = null;
    if (serverRes?.promoted) this.buildStadiumForTier(this.profile.careerTier);
    this.screens.results(r, serverRes, paidRes);
  }

  setupOrientationGate() {
    const overlay = document.getElementById('rotate-overlay');
    const check = () => {
      const portrait = window.innerHeight > window.innerWidth * 1.2;
      const inMatch = !!this.match && !this.match.ended;
      const touch = this.sceneMgr.isMobile || this.input.usingTouch;
      overlay.classList.toggle('hidden', !(portrait && inMatch && touch));
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    this._orientCheck = check;
  }

  requestFullscreenIfMobile() {
    if (!this.sceneMgr.isMobile) return;
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el)?.catch?.(() => {});
    this._orientCheck?.();
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min((t - this.lastT) / 1000, 0.05);
    this.lastT = t;
    if (this.match) {
      this.match.update(dt);
      this._orientCheck?.();
    } else {
      // menu: slow cinematic orbit around the stadium
      this.menuCamT += dt * 0.06;
      const r = 78;
      const cam = this.sceneMgr.camera;
      cam.position.set(Math.sin(this.menuCamT) * r, 34 + Math.sin(this.menuCamT * 0.6) * 6, Math.cos(this.menuCamT) * r);
      cam.lookAt(0, 2, 0);
      this.stadium?.update(dt);
    }
    this.sceneMgr.render();
  }
}

new App();

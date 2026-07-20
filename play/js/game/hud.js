// DOM HUD: scoreline, clock, banners, power bar, hints, touch layer visibility.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud-root');
    this.banner = $('hud-banner');
    this.powerWrap = $('hud-powerbar-wrap');
    this.powerBar = $('hud-powerbar');
    this.bannerTimer = null;
  }

  show(homeName, awayName, isTouch) {
    this.root.classList.remove('hidden');
    $('hud-team-home').textContent = homeName;
    $('hud-team-away').textContent = awayName;
    $('touch-root').classList.toggle('hidden', !isTouch);
    $('hud-hint').textContent = isTouch ? '' :
      'WASD move · Shift sprint · X pass · C through · Space shoot (hold for power) · V slide · Q/E switch · P pause';
  }

  hide() {
    this.root.classList.add('hidden');
    document.getElementById('touch-root').classList.add('hidden');
  }

  setScore(hs, as) { $('hud-scoreline').textContent = `${hs} - ${as}`; }

  setClock(displaySeconds, halfLabel) {
    const m = Math.floor(displaySeconds / 60), s = Math.floor(displaySeconds % 60);
    $('hud-clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('hud-half').textContent = halfLabel;
  }

  showBanner(text, ms = 2200, color = null) {
    this.banner.textContent = text;
    this.banner.style.color = color || '#fff';
    this.banner.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = setTimeout(() => this.banner.classList.add('hidden'), ms);
  }
  hideBanner() { clearTimeout(this.bannerTimer); this.banner.classList.add('hidden'); }

  setPower(v) {
    if (v == null) { this.powerWrap.classList.add('hidden'); return; }
    this.powerWrap.classList.remove('hidden');
    this.powerBar.style.width = `${Math.round(v * 100)}%`;
  }

  onPause(cb) { $('hud-pause').onclick = cb; }
}

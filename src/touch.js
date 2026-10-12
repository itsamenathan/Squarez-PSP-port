// On-screen controls for phones and tablets, laid out like the PSP: an analog stick on the
// left, the face buttons on the right, L/R on the shoulders and START in between.
// The stick reports PSP analog values; buttons report the same actions as a gamepad.

// Face button symbols as SVG so all four match in size and weight, whatever the system font.
const icon = shape => `<svg viewBox="0 0 24 24" aria-hidden="true">${shape}</svg>`;
const BUTTONS = [
  { id: 'triangle', label: icon('<polygon points="12,4 20.5,18.5 3.5,18.5"/>'), actions: ['rage'], cls: 'face top' },
  { id: 'square', label: icon('<rect x="5" y="5" width="14" height="14"/>'), actions: ['grenade'], cls: 'face left' },
  { id: 'circle', label: icon('<circle cx="12" cy="12" r="7.5"/>'), actions: ['slow', 'back'], cls: 'face right' },
  { id: 'cross', label: icon('<path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"/>'), actions: ['turbo', 'accept'], cls: 'face bottom' },
  { id: 'l1', label: 'L', actions: ['pageLeft'], cls: 'shoulder l' },
  { id: 'r1', label: 'R', actions: ['pageRight'], cls: 'shoulder r' },
  { id: 'start', label: 'START', actions: ['start'], cls: 'start' },
];

export class TouchControls {
  constructor(onPress) {
    this.onPress = onPress;
    // Pointer id -> { kind: 'stick' } or { kind: 'button', id }.
    this.pointers = new Map();
    this.held = new Set();
    this.tapped = new Set();
    this.stick = { x: 0, y: 0 };
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      ${BUTTONS.map(b => `<div class="btn ${b.cls}" data-btn="${b.id}">${b.label}</div>`).join('')}
      <div class="btn fs" aria-label="Fullscreen">${icon('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>')}</div>`;
    if (!document.fullscreenEnabled) this.root.querySelector('.fs').remove();
    document.body.appendChild(this.root);
    this.zone = this.root.querySelector('.stick-zone');
    this.base = this.root.querySelector('.stick-base');
    this.knob = this.root.querySelector('.stick-knob');
    this.buttons = Object.fromEntries(BUTTONS.map(b => [b.id, b]));
    const opts = { passive: false };
    this.root.addEventListener('pointerdown', e => this.down(e), opts);
    this.root.addEventListener('pointermove', e => this.move(e), opts);
    for (const t of ['pointerup', 'pointercancel']) this.root.addEventListener(t, e => this.up(e), opts);
    // Long presses must not open the context menu or select text.
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.setVisible(matchMedia('(pointer: coarse)').matches);
  }

  setVisible(on) {
    this.visible = on;
    document.body.classList.toggle('touch', on);
    if (!on) this.reset();
  }

  reset() {
    this.pointers.clear();
    this.held.clear();
    this.stick = { x: 0, y: 0 };
    this.root.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed'));
    this.base.classList.remove('active');
    this.knob.style.transform = '';
  }

  buttonAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const btn = el && el.closest && el.closest('[data-btn]');
    return btn ? btn.dataset.btn : null;
  }

  down(e) {
    e.preventDefault();
    this.root.setPointerCapture?.(e.pointerId);
    if (e.target.closest('.stick-zone')) {
      // The stick centres wherever the thumb lands, so it can't be missed.
      const r = this.zone.getBoundingClientRect();
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('active');
      this.pointers.set(e.pointerId, { kind: 'stick' });
      this.moveStick(e);
    } else if (e.target.closest('.fs')) {
      this.pointers.set(e.pointerId, { kind: 'fullscreen' });
    } else {
      const id = this.buttonAt(e.clientX, e.clientY);
      this.pointers.set(e.pointerId, { kind: 'button', id });
      this.refresh();
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') { this.moveStick(e); return; }
    if (p.kind === 'fullscreen') return;
    // Sliding a thumb across the face buttons switches between them, as on a real pad.
    const id = this.buttonAt(e.clientX, e.clientY);
    if (id !== p.id) { p.id = id; this.refresh(); }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.kind === 'stick') {
      this.stick = { x: 0, y: 0 };
      this.base.classList.remove('active');
      this.base.style.left = this.base.style.top = '';
      this.knob.style.transform = '';
    } else if (p.kind === 'fullscreen') {
      // Touch only grants the user activation fullscreen needs when the finger lifts.
      if (e.type === 'pointerup') this.toggleFullscreen();
    } else {
      this.refresh();
    }
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  moveStick(e) {
    const radius = this.base.offsetWidth / 2;
    let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
    const d = Math.hypot(dx, dy);
    if (d > radius) { dx *= radius / d; dy *= radius / d; }
    this.stick = { x: dx / radius, y: dy / radius };
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  refresh() {
    const ids = new Set([...this.pointers.values()].filter(p => p.kind === 'button' && p.id).map(p => p.id));
    const held = new Set();
    for (const id of ids) for (const a of this.buttons[id].actions) held.add(a);
    for (const a of held) if (!this.held.has(a)) this.tapped.add(a);
    for (const el of this.root.querySelectorAll('[data-btn]')) {
      const on = ids.has(el.dataset.btn);
      if (on && !el.classList.contains('pressed')) this.onPress();
      el.classList.toggle('pressed', on);
    }
    this.held = held;
  }

  active() {
    return this.pointers.size > 0;
  }
}

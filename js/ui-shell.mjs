// View-only behaviour for the V2.2 "Firefly" shell: motion primitives, menus, the colour
// flyout, panel toggles and the backdrop. Nothing here touches orbit data or the backend;
// app.mjs calls in with already-formatted values.

export const RM = matchMedia('(prefers-reduced-motion: reduce)');
export const VIEW_MS = 1500; // shutter wipe between Workbench / Ground Track / Queue

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EASE_OUT = (k) => 1 - (1 - k) ** 3;
const EASE_IN_OUT = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2); // even sweep over the long wipe

export function tween(duration, step, ease = EASE_OUT) {
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const k = Math.min(1, (now - start) / duration);
      step(ease(k), k);
      if (k < 1) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/* ---------- rolling digits: each changed character steps through a short reel ---------- */
const DIGITS = '0123456789';
export function rollSet(el, text) {
  if (!el) return;
  const value = String(text);
  if (el.dataset.roll === value) return;
  el.dataset.roll = value;
  el.setAttribute('aria-label', value);
  const shape = value.replace(/\d/g, '0');
  if (el._shape !== shape || RM.matches) {
    el._shape = shape;
    el.replaceChildren(...[...value].map((ch) => {
      const cell = document.createElement('span');
      cell.className = 'dg';
      cell.setAttribute('aria-hidden', 'true');
      if (/\d/.test(ch)) {
        const reel = document.createElement('span');
        reel.className = 'rk';
        for (const digit of DIGITS) { const i = document.createElement('i'); i.textContent = digit; reel.append(i); }
        reel.style.setProperty('--d', ch);
        cell.append(reel);
      } else cell.textContent = ch;
      return cell;
    }));
    return;
  }
  [...value].forEach((ch, index) => {
    const reel = el.children[index]?.firstElementChild;
    if (reel && /\d/.test(ch)) reel.style.setProperty('--d', ch);
  });
}

/* ---------- character-scramble decode for headings and names ---------- */
const GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789/-_';
export function scramble(el, duration = 420) {
  if (!el || RM.matches) return;
  const text = el.textContent;
  if (!text || el._scrambling) return;
  el._scrambling = true;
  tween(duration, (_, k) => {
    const settled = Math.floor(text.length * k);
    el.textContent = text.slice(0, settled) + [...text.slice(settled)].map((ch) => (ch.trim() ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : ch)).join('');
  }, (k) => k).then(() => { el.textContent = text; el._scrambling = false; });
}

/* ---------- view entrance: panels drop in with a damped settle ---------- */
export function dropIn(view) {
  if (RM.matches || !view?.animate) return;
  $$('.stage, .dossier, .mapwin, .cmod, .mini, .gt-roster, .stat, .panel, .console', view).forEach((el, k) => el.animate(
    [{ transform: 'translateY(-14px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
    { duration: 460, delay: 80 + k * 40, easing: 'cubic-bezier(.34,1.32,.64,1)', fill: 'backwards' },
  ));
  $$('[data-scr]', view).forEach((el) => scramble(el));
}

/* ---------- shutter: an armour-slate veil with an aurora edge sweeps across the views ---------- */
let switching = false;
export function isSwitching() { return switching; }
export function shutter({ label, code }, onSwap) {
  const box = $('#views');
  const sheet = $('#shutter');
  if (RM.matches || !box || !sheet) { onSwap(); return Promise.resolve(); }
  switching = true;
  const slab = $('#shutter-slab');
  const band = $('#shutter-band');
  const W = box.clientWidth;
  const H = box.clientHeight;
  const L = W + H;
  const B = 26;
  $('#shutter-label').textContent = label;
  $('#shutter-code').textContent = `SWITCHING MODULE // ${code}`;
  sheet.hidden = false;
  const poly = (a, b) => `polygon(${a}px 0,${b}px 0,${b - H}px ${H}px,${a - H}px ${H}px)`;
  let swapped = false;
  return tween(VIEW_MS, (e) => {
    const c1 = e * (2 * L + B);
    const c2 = c1 - L;
    slab.style.clipPath = poly(Math.max(c2, -H), Math.max(c1, 0));
    band.style.clipPath = poly(c1, c1 + B);
    if (!swapped && c2 >= -2 && c1 >= L) { swapped = true; onSwap(); }
  }, EASE_IN_OUT).then(() => {
    if (!swapped) onSwap();
    sheet.hidden = true;
    slab.style.clipPath = '';
    band.style.clipPath = '';
    switching = false;
  });
}

/* ---------- segmented buttons mirroring a hidden <select> (keeps the select as the source of truth) ---------- */
export function syncSegmentedSelects() {
  for (const group of $$('[data-seg-for]')) {
    const select = document.getElementById(group.dataset.segFor);
    for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.value === select?.value));
  }
}
export function initSegmentedSelects() {
  for (const group of $$('[data-seg-for]')) {
    const select = document.getElementById(group.dataset.segFor);
    if (!select) continue;
    group.replaceChildren(...[...select.options].map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = option.value;
      button.textContent = option.textContent;
      button.addEventListener('click', () => {
        if (select.value === option.value) return;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncSegmentedSelects();
      });
      return button;
    }));
    select.addEventListener('change', syncSegmentedSelects);
  }
  syncSegmentedSelects();
}

/* ---------- dropdown menus (FRAME / MODEL / ORB) ---------- */
export function closeDropdowns(except = null) {
  for (const button of $$('.dd-btn[aria-expanded="true"]')) {
    if (button === except) continue;
    button.setAttribute('aria-expanded', 'false');
    button.parentElement.querySelector('.dd-menu').hidden = true;
  }
}
function openDropdown(button, focusFirst) {
  closeDropdowns(button);
  const menu = button.parentElement.querySelector('.dd-menu');
  button.setAttribute('aria-expanded', 'true');
  menu.hidden = false;
  menu.classList.remove('in'); void menu.offsetWidth; menu.classList.add('in');
  if (focusFirst) (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'))?.focus();
}
export function initDropdowns() {
  for (const button of $$('.dd-btn')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (button.getAttribute('aria-expanded') === 'true') closeDropdowns();
      else openDropdown(button, event.detail === 0);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); openDropdown(button, true); }
    });
  }
  for (const menu of $$('.dd-menu')) {
    menu.addEventListener('keydown', (event) => {
      const items = $$('button', menu);
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
  }
  document.addEventListener('pointerdown', (event) => { if (!event.target.closest?.('.dd')) closeDropdowns(); });
}
export function anyDropdownOpen() { return Boolean($('.dd-btn[aria-expanded="true"]')); }

/* ---------- colour flyout: opens to the left of the dossier, over the scene ---------- */
export function placeColorFlyout() {
  const fly = $('#color-flyout');
  const toggle = $('#color-toggle').getBoundingClientRect();
  const dossier = $('.dossier').getBoundingClientRect();
  const width = fly.offsetWidth;
  const height = fly.offsetHeight;
  const floor = innerHeight - ($('.dock')?.offsetHeight ?? 0) - 10;
  if (dossier.left - width - 14 >= 8) {
    fly.dataset.side = 'left';
    fly.style.left = `${dossier.left - width - 12}px`;
    const top = clamp(toggle.top - 10, 70, floor - height);
    fly.style.top = `${top}px`;
    fly.style.setProperty('--ny', `${clamp(toggle.top + toggle.height / 2 - top, 14, height - 14)}px`);
  } else {
    fly.dataset.side = 'below';
    fly.style.left = `${clamp(toggle.left, 8, innerWidth - width - 8)}px`;
    fly.style.top = `${toggle.bottom + 8}px`;
  }
}
export function setColorFlyout(open) {
  const fly = $('#color-flyout');
  if (fly.hidden === !open) return;
  fly.hidden = !open;
  $('#color-toggle').setAttribute('aria-expanded', String(open));
  if (open) { placeColorFlyout(); fly.classList.remove('in'); void fly.offsetWidth; fly.classList.add('in'); }
}
export function colorFlyoutOpen() { return !$('#color-flyout').hidden; }
export function initColorFlyout({ palette, onPick }) {
  const swatches = $('#color-swatches');
  swatches.replaceChildren(...palette.map((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.setProperty('--c', color);
    button.dataset.color = color;
    button.setAttribute('aria-label', `颜色 ${color}`);
    button.setAttribute('aria-pressed', 'false');
    return button;
  }));
  swatches.addEventListener('click', (event) => { const button = event.target.closest('button'); if (button) onPick(button.dataset.color); });
  $('#color-toggle').addEventListener('click', () => setColorFlyout(colorFlyoutOpen() === false));
  $('#color-flyout-close').addEventListener('click', () => { setColorFlyout(false); $('#color-toggle').focus(); });
  document.addEventListener('pointerdown', (event) => {
    if (colorFlyoutOpen() && !event.target.closest?.('#color-flyout, #color-toggle')) setColorFlyout(false);
  });
  addEventListener('resize', () => { if (colorFlyoutOpen()) placeColorFlyout(); });
  $('.dossier .ds-body')?.addEventListener('scroll', () => { if (colorFlyoutOpen()) placeColorFlyout(); }, { passive: true });
}
export function markSwatch(hex) {
  for (const button of $$('#color-swatches button')) button.setAttribute('aria-pressed', String(button.dataset.color === hex));
}

/* ---------- HUD fold and VIEW / LAYER slide-away · remembered per viewer ---------- */
const UI_KEY = 'eci-orbit-workbench:ui';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(prefs)); } catch { /* storage may be blocked */ } };

function foldHud(fold, animate) {
  const hud = $('#selected-orbit-hud');
  const button = $('#hud-fold');
  const before = hud.getBoundingClientRect();
  hud.classList.toggle('fold', fold);
  const label = fold ? '展开轨道数据' : '收起轨道数据';
  button.setAttribute('aria-expanded', String(!fold));
  button.title = label;
  button.setAttribute('aria-label', label);
  prefs.hudFold = fold; savePrefs();
  if (!animate || RM.matches || !hud.animate) return;
  const after = hud.getBoundingClientRect();
  hud.classList.add('anim');
  hud.animate([{ width: `${before.width}px`, height: `${before.height}px` }, { width: `${after.width}px`, height: `${after.height}px` }],
    { duration: 300, easing: 'cubic-bezier(.16,1,.3,1)' }).finished.finally(() => hud.classList.remove('anim'));
}
function hideTools(away, focus) {
  $('#tools-panel').classList.toggle('away', away);
  $('#tools-tab').classList.toggle('on', away);
  $('#tools-hide').setAttribute('aria-expanded', String(!away));
  $('#tools-tab').setAttribute('aria-expanded', String(!away));
  prefs.toolsAway = away; savePrefs();
  if (focus) (away ? $('#tools-tab') : $('#tools-hide')).focus({ preventScroll: true });
}
export function initPanelToggles() {
  $('#hud-fold').addEventListener('click', () => foldHud(!$('#selected-orbit-hud').classList.contains('fold'), true));
  $('#tools-hide').addEventListener('click', () => hideTools(true, true));
  $('#tools-tab').addEventListener('click', () => hideTools(false, true));
  if (prefs.hudFold) foldHud(true, false);
  if (prefs.toolsAway) hideTools(true, false);
  // a narrow stage parks STATE VECTOR under the orbit plate, so it needs the plate's height
  if (window.ResizeObserver) {
    new ResizeObserver(([entry]) => {
      $('#stage').style.setProperty('--hs-h', `${Math.ceil(entry.target.offsetHeight)}px`);
    }).observe($('#selected-orbit-hud'));
  }
}

/* ---------- roster lists scroll with no visible bar; edge fades say there is more ---------- */
export function listFade(el) {
  const up = el.scrollTop > 2;
  const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  el.style.setProperty('--fu', up ? '22px' : '0px');
  el.style.setProperty('--fd', down ? '22px' : '0px');
}
export function initListFades() {
  for (const el of $$('.rlist')) el.addEventListener('scroll', () => listFade(el), { passive: true });
  addEventListener('resize', () => $$('.rlist').forEach(listFade));
}
export function refreshListFades() { $$('.rlist').forEach(listFade); }

/* ---------- firefly motes drifting behind the interface ---------- */
export function initMotes() {
  const canvas = $('#motes');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const count = innerWidth < 700 ? 14 : 30;
  const TAU = Math.PI * 2;
  const motes = Array.from({ length: count }, () => ({
    x: Math.random(), y: Math.random(), r: 0.9 + Math.random() * 1.5,
    vx: (Math.random() - 0.5) * 0.008, vy: -(0.006 + Math.random() * 0.012),
    ph: Math.random() * TAU, sp: 0.5 + Math.random() * 1.1, lime: Math.random() < 0.5,
  }));
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const W = innerWidth;
    const H = innerHeight;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      if (!RM.matches) {
        m.x = (m.x + m.vx * dt + 1) % 1;
        m.y += m.vy * dt;
        if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      }
      const flicker = RM.matches ? 0.7 : 0.55 + 0.45 * Math.sin(now / 1000 * m.sp + m.ph);
      const x = m.x * W;
      const y = m.y * H;
      const glow = m.r * 6;
      const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
      const tint = m.lime ? '226,240,120' : '120,214,196';
      g.addColorStop(0, `rgba(${tint},${0.5 * flicker})`);
      g.addColorStop(0.35, `rgba(${tint},${0.16 * flicker})`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, glow, 0, TAU); ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

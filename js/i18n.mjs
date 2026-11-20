// EN / 简中 runtime. The markup and the app render Simplified Chinese; this layer rewrites
// visible text and a few attributes in place, and keeps the Chinese source so switching back
// is lossless. A MutationObserver covers everything the app renders later.
import { DICT_ENTRIES, PAIR_ENTRIES, PATTERNS, TITLE } from './i18n-dict.mjs';

const DICT = new Map(Object.entries(DICT_ENTRIES));
const PAIRS = new Map(Object.entries(PAIR_ENTRIES)); // en micro-label -> zh (EN mode flips decorative sub-labels)
const KEY = 'eci-orbit-workbench:lang';
const ATTRS = ['placeholder', 'title', 'aria-label', 'aria-valuetext'];
const CJK = /[㐀-鿿　-〿！-～]/;
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE']);
const srcOf = new WeakMap();   // Text node -> zh source
const setTo = new WeakMap();   // Text node -> value we wrote
const attrSrc = new WeakMap(); // Element -> { attr: [source, written] }
let lang = 'zh';

function core(s) {
  if (DICT.has(s)) return DICT.get(s);
  for (const [re, rep] of PATTERNS) {
    const m = re.exec(s);
    if (m) return typeof rep === 'function' ? rep(tr, ...m.slice(1)) : s.replace(re, rep);
  }
  return null;
}

/** Translate one string for the current language; unknown text passes through untouched. */
export function tr(s) {
  if (lang === 'zh' || s == null) return s;
  s = String(s);
  const t = s.trim();
  if (!t) return s;
  // multi-line text (the console log) translates line by line
  if (t.includes('\n')) return s.split('\n').map((line) => tr(line)).join('\n');
  const lead = s.slice(0, s.indexOf(t));
  const tail = s.slice(s.indexOf(t) + t.length);
  if (!CJK.test(t)) return PAIRS.has(t) ? lead + PAIRS.get(t) + tail : s;
  let out = core(t);
  const prefixed = out == null && /^([·→—|/]\s+)(.+)$/.exec(t);
  if (prefixed) { const rest = tr(prefixed[2]); if (rest !== prefixed[2]) out = prefixed[1] + rest; }
  if (out == null && / · /.test(t)) {
    // "空闲 · IDLE" style compounds: translate segments, then drop echoed duplicates.
    const segs = t.split(' · ').map((x) => (CJK.test(x) ? core(x) ?? x : x));
    out = segs.filter((x, i) => i === 0 || x.toLowerCase() !== segs[i - 1].toLowerCase()).join(' · ');
  }
  return out == null ? s : lead + out + tail;
}

function doText(n) {
  const p = n.parentNode;
  if (!p || SKIP.has(p.nodeName) || p.closest?.('[data-i18n-skip]')) return;
  const cur = n.data;
  const mine = setTo.get(n) === cur;
  const src = mine ? srcOf.get(n) : cur;
  // data-en on a single-text element supplies a context-specific (usually shorter) English label
  const override = lang === 'en' && p.nodeType === 1 && p.hasAttribute('data-en') && p.firstChild === n ? p.getAttribute('data-en') : null;
  const want = lang === 'zh' ? src : override ?? tr(src);
  if (!mine) srcOf.set(n, src);
  setTo.set(n, want);
  if (want !== cur) n.data = want;
}

function doAttr(el, a) {
  if (!el.hasAttribute(a) || el.closest('[data-i18n-skip]')) return;
  const rec = attrSrc.get(el) || {};
  const cur = el.getAttribute(a);
  const mine = rec[a] && rec[a][1] === cur;
  const src = mine ? rec[a][0] : cur;
  const want = lang === 'zh' ? src : tr(src);
  rec[a] = [src, want];
  attrSrc.set(el, rec);
  if (want !== cur) el.setAttribute(a, want);
}

function walk(root) {
  if (!root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1 || SKIP.has(root.nodeName)) return;
  for (const a of ATTRS) doAttr(root, a);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3) doText(n);
    else if (!SKIP.has(n.nodeName)) for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
  }
}

const observer = new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === 'characterData') doText(m.target);
    else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
    else m.addedNodes.forEach(walk);
  }
});

export function currentLang() { return lang; }

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.documentElement.dataset.lang = lang;
  document.title = lang === 'en' ? TITLE.en : TITLE.zh;
  walk(document.body);
  for (const button of document.querySelectorAll('[data-lang-set]')) {
    const on = button.dataset.langSet === lang;
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('on', on);
  }
  try { localStorage.setItem(KEY, lang); } catch { /* storage may be blocked */ }
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

export function initI18n() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-lang-set]');
    if (button) { event.preventDefault(); setLang(button.dataset.langSet); }
  });
  let initial = new URLSearchParams(location.search).get('lang');
  if (!initial) { try { initial = localStorage.getItem(KEY); } catch { initial = null; } }
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  setLang(initial === 'en' ? 'en' : 'zh');
}

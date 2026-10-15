/* global pf, i18n, ScriptParser */
const { t } = i18n;
const $ = (s) => document.querySelector(s);
const isMac = pf.platform === 'darwin';

const viewport = $('#viewport');
const content = $('#content');

let settings = {};
let script = null;
let sections = [];
let secEls = [];
let pauseEls = [];
let endEl = null;
let clickThrough = false;

let pos = 0;               // desplazamiento actual en px
let target = null;         // destino de una animación suave (saltos)
let playing = false;
let counting = false;
let countTimer = null;
let elapsed = 0;
let lastTs = 0;
let readingOffset = 0;
let maxPos = 0;

// ---------- Ajustes visuales ----------

const FONTS = {
  sans: 'var(--font)',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  mono: 'var(--mono)',
};

function applySettings(s) {
  const anchor = captureAnchor();
  const langChanged = s.language !== settings.language;
  settings = s;
  const root = document.documentElement.style;
  root.setProperty('--fs', `${s.fontSize}px`);
  root.setProperty('--lh', s.lineHeight);
  root.setProperty('--color', s.textColor);
  root.setProperty('--bg-a', s.bgOpacity);
  root.setProperty('--width', `${s.textWidth}%`);
  root.setProperty('--reading', `${s.readingLine}%`);
  root.setProperty('--reading-font', FONTS[s.fontFamily] || FONTS.sans);
  document.body.classList.toggle('hl', !!s.highlight);
  document.body.classList.toggle('compact', !!s.compact);
  viewport.classList.toggle('masked', !!s.highlight);
  content.classList.toggle('mirror', !!s.mirror);
  $('#bCompact').classList.toggle('on', !!s.compact);

  const prot = $('#bProt');
  prot.classList.toggle('off', !s.captureProtection);
  prot.querySelector('use').setAttribute('href', s.captureProtection ? '#i-shield' : '#i-shield-off');
  prot.title = t(s.captureProtection ? 'pProtected' : 'pUnprotected');

  setRange($('#speed'), s.speed);
  setRange($('#opacity'), s.bgOpacity);
  $('#speedVal').textContent = `${Number(s.speed).toFixed(2).replace(/\.?0+$/, '')}x`;

  if (s.scrollMode === 'manual' && (playing || counting)) pause();

  if (langChanged) {
    i18n.setLang(s.language);
    renderScript(true);
  }
  layout();
  restoreAnchor(anchor);
  updateUi();
  sendStatus(true);
}

function setRange(input, v) {
  if (document.activeElement !== input) input.value = v;
  input.style.setProperty('--p', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
}

// ---------- Guion ----------

function renderScript(keepPosition) {
  const anchor = keepPosition ? captureAnchor() : null;
  sections = script ? ScriptParser.parse(script.content) : [];
  $('#empty').hidden = !!(script && sections.length);
  content.innerHTML = ScriptParser.toHtml(sections, t) + (sections.length ? `<div class="end">— ${t('pEnd')} —</div>` : '');
  secEls = [...content.querySelectorAll('.sec')];
  pauseEls = [...content.querySelectorAll('[data-pause]')];
  endEl = content.querySelector('.end');
  layout();
  if (anchor) restoreAnchor(anchor);
  else { pos = 0; elapsed = 0; target = null; }
  updateUi();
  sendStatus(true);
}

// Mantiene la misma frase en la línea de lectura al cambiar tamaño, fuente o texto.
function blocks() { return [...content.querySelectorAll('.sec-head, p, .end')]; }
function captureAnchor() {
  if (!content.children.length) return null;
  const y = pos + readingOffset;
  const list = blocks();
  let idx = 0;
  for (let i = 0; i < list.length; i++) if (list[i].offsetTop <= y) idx = i;
  const el = list[idx];
  return { idx, frac: el ? Math.min(1, (y - el.offsetTop) / Math.max(1, el.offsetHeight)) : 0 };
}
function restoreAnchor(a) {
  if (!a) return;
  const el = blocks()[a.idx];
  if (!el) return;
  pos = clampPos(el.offsetTop + a.frac * el.offsetHeight - readingOffset);
  target = null;
  render();
}

function layout() {
  const h = viewport.clientHeight;
  readingOffset = Math.round(h * (settings.readingLine || 30) / 100);
  content.style.paddingTop = `${readingOffset}px`;
  content.style.paddingBottom = `${h}px`;
  maxPos = endEl ? Math.max(0, endEl.offsetTop - readingOffset) : 0;
  pos = clampPos(pos);
  render();
}

const clampPos = (p) => Math.min(maxPos, Math.max(0, p));
const lineHeightPx = () => settings.fontSize * settings.lineHeight;
const pxPerSec = () => settings.speed * lineHeightPx() * 0.13;

// ---------- Reproducción ----------

function play() {
  if (!script || !sections.length || settings.scrollMode === 'manual') return;
  if (pos >= maxPos - 1) { pos = 0; elapsed = 0; target = null; render(); }
  const n = Number(settings.countdown) || 0;
  if (n > 0) startCountdown(n);
  else { playing = true; }
  updateUi();
  sendStatus(true);
}

function pause() {
  playing = false;
  stopCountdown();
  updateUi();
  sendStatus(true);
}

function toggle() {
  if (playing || counting) pause();
  else play();
}

function startCountdown(n) {
  stopCountdown();
  counting = true;
  const box = $('#countdown');
  box.hidden = false;
  const tick = () => {
    if (n <= 0) {
      stopCountdown();
      playing = true;
      lastTs = performance.now();
      updateUi();
      sendStatus(true);
      return;
    }
    box.innerHTML = `<span>${n}</span>`;
    n -= 1;
    countTimer = setTimeout(tick, 1000);
  };
  tick();
}

function stopCountdown() {
  counting = false;
  clearTimeout(countTimer);
  $('#countdown').hidden = true;
}

function jumpTo(p) {
  target = clampPos(p);
}

function currentSection() {
  const y = pos + readingOffset + 2;
  let idx = 0;
  for (let i = 0; i < secEls.length; i++) if (secEls[i].offsetTop <= y) idx = i;
  return idx;
}

function sectionPos(i) {
  const el = secEls[i];
  return el ? el.offsetTop - readingOffset : 0;
}

function handleCmd({ cmd, arg }) {
  const step = lineHeightPx() * 2;
  switch (cmd) {
    case 'toggle': return toggle();
    case 'play': return play();
    case 'pause': return pause();
    case 'back': return jumpTo((target ?? pos) - step);
    case 'forward': return jumpTo((target ?? pos) + step);
    case 'top': elapsed = 0; return jumpTo(0);
    case 'nextSection': return jumpTo(sectionPos(Math.min(secEls.length - 1, currentSection() + 1)));
    case 'prevSection': {
      const i = currentSection();
      // Si ya avanzaste dentro de la diapositiva, vuelve a su inicio; si no, a la anterior.
      return jumpTo(pos - sectionPos(i) > lineHeightPx() ? sectionPos(i) : sectionPos(Math.max(0, i - 1)));
    }
    case 'gotoSection': return jumpTo(sectionPos(Number(arg) || 0));
  }
}

// Bucle de animación
function frame(ts) {
  const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  const prev = pos;

  if (target !== null) {
    pos += (target - pos) * Math.min(1, dt * 12);
    if (Math.abs(target - pos) < 0.5) { pos = target; target = null; }
  } else if (playing) {
    pos = clampPos(pos + pxPerSec() * dt);
    elapsed += dt;
    if (settings.autoPause) {
      for (const el of pauseEls) {
        const y = el.offsetTop - readingOffset;
        if (prev < y && pos >= y) { pos = y; pause(); break; }
      }
    }
    if (pos >= maxPos) pause();
  }
  if (pos !== prev) render();
  requestAnimationFrame(frame);
}

function render() {
  content.style.transform = `translate3d(0, ${-pos}px, 0)`;
}

// ---------- Interfaz y estado ----------

function updateUi() {
  const active = playing || counting;
  const start = $('#bStart');
  start.classList.toggle('playing', active);
  start.querySelector('use').setAttribute('href', active ? '#i-pause' : '#i-play');
  $('#startLabel').textContent = active ? t('pPause') : t('pStart');
  start.style.display = settings.scrollMode === 'manual' ? 'none' : '';
  $('#bCt').classList.toggle('on', clickThrough);
  document.body.classList.toggle('ct', clickThrough);
  const k = isMac ? '⌘⌥X' : 'Ctrl+Alt+X';
  $('#ctBadge').textContent = t('pClickThroughOn', { k });
}

const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

let lastSent = 0;
let lastSection = -1;
function sendStatus(force) {
  const now = performance.now();
  const sec = currentSection();
  const remaining = maxPos > 0 ? (maxPos - pos) / Math.max(1, pxPerSec()) : 0;

  $('#tE').textContent = fmt(elapsed);
  $('#tR').textContent = fmt(remaining);
  $('#progress').style.width = `${maxPos ? (pos / maxPos) * 100 : 0}%`;
  const s = sections[sec];
  const label = !s ? '—' : s.implicit ? t('start') : `${t('slide')} ${String(sec + 1).padStart(2, '0')} / ${String(sections.length).padStart(2, '0')}`;
  $('#secBadge').textContent = label;
  $('#secName').textContent = s && !s.implicit ? s.title : script?.title || '';

  if (!force && now - lastSent < 250 && sec === lastSection) return;
  lastSent = now;
  lastSection = sec;
  pf.send('prompter:status', {
    scriptId: script?.id || null,
    title: script?.title || '',
    playing,
    counting,
    manual: settings.scrollMode === 'manual',
    section: sec,
    sectionCount: sections.length,
    sectionLabel: label,
    sections: sections.map((x, i) => ScriptParser.sectionTitle(x, i, t)),
    elapsed,
    remaining,
    progress: maxPos ? pos / maxPos : 0,
    speed: settings.speed,
  });
}
setInterval(() => sendStatus(false), 250);

// ---------- Eventos ----------

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => {
    const cmd = b.dataset.cmd;
    if (cmd === 'fontUp' || cmd === 'fontDown') pf.send('prompter:cmd', { cmd });
    else handleCmd({ cmd });
  })
);

$('#speed').addEventListener('input', (e) => {
  setRange(e.target, e.target.value);
  pf.invoke('settings:set', { speed: Number(e.target.value) });
});
$('#opacity').addEventListener('input', (e) => {
  setRange(e.target, e.target.value);
  document.documentElement.style.setProperty('--bg-a', e.target.value);
  pf.invoke('settings:set', { bgOpacity: Number(e.target.value) });
});
$('#bProt').onclick = () => pf.invoke('settings:set', { captureProtection: !settings.captureProtection });
$('#bCompact').onclick = () => pf.invoke('settings:set', { compact: !settings.compact });
$('#bCt').onclick = () => pf.send('prompter:cmd', { cmd: 'clickThrough' });
$('#bClose').onclick = () => pf.send('prompter:close');

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  target = null;
  pos = clampPos(pos + e.deltaY * 0.7);
  render();
  sendStatus(false);
}, { passive: false });

// Arrastrar el texto con el mouse para moverlo manualmente.
let dragY = null;
viewport.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  dragY = e.clientY;
  target = null;
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener('pointermove', (e) => {
  if (dragY === null) return;
  pos = clampPos(pos - (e.clientY - dragY));
  dragY = e.clientY;
  render();
});
viewport.addEventListener('pointerup', () => { dragY = null; });

// Cambiar el tamaño desde la esquina (las ventanas transparentes no siempre tienen bordes).
const grip = $('#grip');
let resize = null;
grip.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  resize = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
  grip.setPointerCapture(e.pointerId);
});
grip.addEventListener('pointermove', (e) => {
  if (!resize) return;
  pf.send('prompter:resize', { width: resize.w + (e.screenX - resize.x), height: resize.h + (e.screenY - resize.y) });
});
grip.addEventListener('pointerup', () => { resize = null; });

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const map = {
    ' ': 'toggle', Enter: 'toggle', Escape: 'pause',
    ArrowLeft: 'back', ArrowRight: 'forward',
    PageDown: 'nextSection', PageUp: 'prevSection', Home: 'top',
  };
  if (map[e.key]) { e.preventDefault(); handleCmd({ cmd: map[e.key] }); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); pf.send('prompter:cmd', { cmd: 'faster' }); }
  if (e.key === 'ArrowDown') { e.preventDefault(); pf.send('prompter:cmd', { cmd: 'slower' }); }
  if (e.key === '+' || e.key === '=') pf.send('prompter:cmd', { cmd: 'fontUp' });
  if (e.key === '-') pf.send('prompter:cmd', { cmd: 'fontDown' });
});

let resizeTimer;
new ResizeObserver(() => {
  const anchor = captureAnchor();
  layout();
  restoreAnchor(anchor);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => sendStatus(true), 100);
}).observe(viewport);

pf.on('settings', applySettings);
pf.on('script', (s) => {
  const same = s && script && s.id === script.id;
  script = s;
  renderScript(same);
});
pf.on('cmd', handleCmd);
pf.on('testpattern', (on) => document.body.classList.toggle('testpattern', on));
pf.on('clickthrough', (on) => { clickThrough = on; updateUi(); });

// ---------- Inicio ----------

(async function init() {
  const data = await pf.invoke('prompter:init');
  settings = data.settings;
  i18n.setLang(settings.language);
  i18n.apply();
  clickThrough = data.clickThrough;
  script = data.script;
  applySettings(data.settings);
  renderScript(false);
  requestAnimationFrame(frame);
})();

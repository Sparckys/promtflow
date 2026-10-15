/* global pf, i18n, ScriptParser */
const { t } = i18n;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const isMac = pf.platform === 'darwin';

const WPM = 140; // palabras por minuto para estimar la duración

let scripts = [];
let settings = {};
let currentId = null;
let status = { open: false };
let shortcuts = [];
let sysInfo = null;
let filter = '';

// ---------- Utilidades ----------

const fmtTime = (sec) => {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const current = () => scripts.find((s) => s.id === currentId);

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function relDate(ts) {
  const locale = i18n.lang === 'en' ? 'en-US' : 'es';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

// ---------- Biblioteca ----------

function renderList() {
  const list = $('#list');
  const q = norm(filter);
  const matches = scripts.filter((s) => !q || norm(s.title).includes(q) || norm(s.content).includes(q) || norm(s.folder).includes(q));
  if (!matches.length) {
    list.innerHTML = `<div class="list-empty">${t('noScripts')}</div>`;
    return;
  }
  const groups = new Map();
  for (const s of matches) {
    const key = s.folder?.trim() || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  list.innerHTML = '';
  for (const key of keys) {
    const label = document.createElement('div');
    label.className = 'group-label';
    label.innerHTML = `<svg><use href="#i-folder"/></svg>`;
    label.append(key || t('noFolder'));
    list.append(label);
    for (const s of groups.get(key).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const words = ScriptParser.countWords(s.content);
      const b = document.createElement('button');
      b.className = 'item' + (s.id === currentId ? ' active' : '');
      b.innerHTML = `<div class="item-title"></div><div class="item-meta"></div>`;
      b.querySelector('.item-title').textContent = s.title || t('untitled');
      b.querySelector('.item-meta').textContent = `${relDate(s.updatedAt)} · ${words} ${t('words')} · ${fmtTime((words / WPM) * 60)}`;
      b.onclick = () => select(s.id);
      list.append(b);
    }
  }
  $('#folders').innerHTML = [...new Set(scripts.map((s) => s.folder).filter(Boolean))].map((f) => `<option value="${f.replace(/"/g, '&quot;')}">`).join('');
}

function select(id) {
  flushSave();
  currentId = id;
  const s = current();
  $('#title').value = s ? s.title : '';
  $('#folder').value = s ? s.folder || '' : '';
  $('#content').value = s ? s.content : '';
  $('#saveState').textContent = '';
  renderList();
  renderStats();
  // Si el teleprompter está abierto, cambia también al guion seleccionado.
  if (status.open && s) pf.invoke('prompter:open', s.id);
}

function renderStats() {
  const s = current();
  const content = s ? $('#content').value : '';
  const words = ScriptParser.countWords(content);
  const sections = ScriptParser.parse(content);
  $('#stWords').textContent = words.toLocaleString(i18n.lang);
  $('#stSlides').textContent = sections.filter((x) => !x.implicit).length;
  $('#stDuration').textContent = fmtTime((words / WPM) * 60);

  const chips = $('#chips');
  chips.innerHTML = '';
  if (sections.length > 1 || (sections[0] && !sections[0].implicit)) {
    sections.forEach((sec, i) => {
      const c = document.createElement('button');
      c.className = 'chip' + (status.open && status.section === i ? ' live' : '');
      c.innerHTML = `<span class="n">${sec.implicit ? '·' : i + 1}</span><span></span>`;
      c.lastChild.textContent = sec.implicit ? t('start') : sec.title || `${t('slide')} ${i + 1}`;
      c.title = ScriptParser.sectionTitle(sec, i, t);
      c.onclick = async () => {
        if (!status.open) await pf.invoke('prompter:open', currentId);
        setTimeout(() => pf.send('prompter:cmd', { cmd: 'gotoSection', arg: i }), status.open ? 0 : 350);
      };
      chips.append(c);
    });
  }
}

// ---------- Guardado automático ----------

let saveTimer = null;
function scheduleSave() {
  $('#saveState').textContent = t('saving');
  $('#saveState').classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}

async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const s = current();
  if (!s) return;
  const saved = await pf.invoke('script:save', {
    id: s.id,
    title: $('#title').value.trim() || t('untitled'),
    folder: $('#folder').value.trim(),
    content: $('#content').value,
  });
  Object.assign(s, saved);
  $('#saveState').textContent = t('saved');
  $('#saveState').classList.remove('saving');
  renderList();
}

async function newScript() {
  flushSave();
  const s = await pf.invoke('script:save', { title: t('newScript'), folder: current()?.folder || '', content: '' });
  scripts.unshift(s);
  select(s.id);
  $('#title').select();
}

// ---------- Ajustes ----------

const FORMAT = {
  speed: (v) => `${Number(v).toFixed(2).replace(/0$/, '')}x`,
  fontSize: (v) => `${v}px`,
  lineHeight: (v) => Number(v).toFixed(2),
  textWidth: (v) => `${v}%`,
  readingLine: (v) => `${v}%`,
  bgOpacity: (v) => `${Math.round(v * 100)}%`,
};

function setRangeFill(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', `${p}%`);
}

function renderSettings() {
  $$('[data-setting]').forEach((el) => {
    const k = el.dataset.setting;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else if (document.activeElement !== el) el.value = settings[k];
    if (el.type === 'range') setRangeFill(el);
  });
  $$('[data-out]').forEach((o) => { o.textContent = FORMAT[o.dataset.out](settings[o.dataset.out]); });
  $$('[data-seg]').forEach((seg) => {
    const v = String(settings[seg.dataset.seg]);
    $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.value === v));
  });
  $$('#swatches button').forEach((b) => b.classList.toggle('on', b.dataset.color.toLowerCase() === String(settings.textColor).toLowerCase()));
  $$('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === settings.language));
  $('#protCard').classList.toggle('off', !settings.captureProtection);
  $('#tmSpeed').textContent = FORMAT.speed(settings.speed);
  $('#btnCountN').textContent = Number(settings.countdown) || 3;
  renderPreview();
  renderLastCheck();
  renderRcButtons();
}

function renderPreview() {
  const box = $('#previewText');
  const fam = { sans: 'var(--font)', serif: 'Georgia, "Times New Roman", serif', mono: 'var(--mono)' }[settings.fontFamily] || 'var(--font)';
  box.style.fontFamily = fam;
  box.style.fontSize = `${Math.max(11, Math.round(settings.fontSize * 0.42))}px`;
  box.style.lineHeight = settings.lineHeight;
  box.style.color = settings.textColor;
  box.style.setProperty('--pv-bg', settings.bgOpacity);
  box.style.transform = settings.mirror ? 'scaleX(-1)' : '';
  const line = $('.preview-line');
  line.style.fontSize = box.style.fontSize;
  line.style.background = settings.highlight ? 'linear-gradient(90deg, rgba(123,140,255,.28), rgba(123,140,255,.06))' : 'transparent';
  line.style.borderLeft = settings.highlight ? '3px solid var(--accent)' : '0';
  const [a, b, c] = i18n.lang === 'en'
    ? ['Today, I want to show you something important…', 'Your next big idea starts here.', "And today, I'm going to show you how."]
    : ['Hoy quiero mostrarte algo importante…', 'Tu próxima gran idea empieza aquí.', 'Y hoy te voy a enseñar cómo.'];
  const ps = $$('p', box);
  ps[0].textContent = a; ps[1].textContent = b; ps[2].textContent = c;
}

async function setSetting(patch) {
  settings = await pf.invoke('settings:set', patch);
  renderSettings();
}

function bindSettings() {
  $$('[data-setting]').forEach((el) => {
    const k = el.dataset.setting;
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => setSetting({ [k]: el.checked }));
    } else {
      el.addEventListener('input', () => {
        const v = Number(el.value);
        settings[k] = v;
        setRangeFill(el);
        $(`[data-out="${k}"]`).textContent = FORMAT[k](v);
        renderPreview();
        pf.invoke('settings:set', { [k]: v });
      });
    }
  });
  $$('[data-seg]').forEach((seg) => {
    $$('button', seg).forEach((b) => b.addEventListener('click', () => {
      if (b.disabled) return;
      const k = seg.dataset.seg;
      const v = k === 'countdown' ? Number(b.dataset.value) : b.dataset.value;
      setSetting({ [k]: v });
    }));
  });
  $$('#swatches button').forEach((b) => b.addEventListener('click', () => setSetting({ textColor: b.dataset.color })));
  $$('#langSeg button').forEach((b) => b.addEventListener('click', () => setSetting({ language: b.dataset.lang })));
}

// ---------- Estado del teleprompter ----------

function renderStatus() {
  const dot = $('#liveDot');
  dot.className = 'live-dot' + (status.open ? (status.playing || status.counting ? ' playing' : ' paused') : '');
  $('#stState').textContent = !status.open ? t('stClosed') : status.counting ? t('stCountdown') : status.playing ? t('stPlaying') : t('stPaused');
  $('#stSection').textContent = status.open ? (status.sectionLabel || '—') + (status.title ? ` · ${status.title}` : '') : current()?.title || '—';
  $('#btnPlay use').setAttribute('href', status.open && (status.playing || status.counting) ? '#i-pause' : '#i-play');
  $('#btnCount').classList.toggle('counting', !!(status.open && status.counting));
  $('#btnCount').style.visibility = status.open && status.playing ? 'hidden' : '';
  $('#tmE').textContent = fmtTime(status.open ? status.elapsed : 0);
  $('#tmR').textContent = fmtTime(status.open ? status.remaining : 0);
  $$('#chips .chip').forEach((c, i) => c.classList.toggle('live', !!status.open && status.section === i && status.scriptId === currentId));
  $('#ctToggle').checked = !!status.clickThrough;
}

// ---------- Ventana, atajos, sistema ----------

async function renderDisplays() {
  const displays = await pf.invoke('displays:list');
  $('#displaySelect').innerHTML = displays
    .map((d) => `<option value="${d.id}">${t('monitorN', { n: d.index })}${d.primary ? ` (${t('primary')})` : ''} — ${d.size}</option>`)
    .join('');
}

const keyLabel = (k) =>
  k.replace('CommandOrControl', isMac ? '⌘' : 'Ctrl').replace('Alt', isMac ? '⌥' : 'Alt').replace('Up', '↑').replace('Down', '↓');

function renderShortcuts() {
  $('#shortcuts').innerHTML = shortcuts
    .map((s) => {
      const keys = keyLabel(s.keys).split('+').map((k) => `<kbd>${k}</kbd>`).join('');
      return `<li><span>${t('sc_' + s.cmd)}${s.ok ? '' : ` <span class="busy">· ${t('shortcutBusy')}</span>`}</span><span class="keys">${keys}</span></li>`;
    })
    .join('');
  $('.kbd-line .mod').textContent = isMac ? '⌘' : 'Ctrl';
  $('.kbd-line .mod2').textContent = isMac ? '⌥' : 'Alt';
}

function renderSysNote() {
  if (!sysInfo) return;
  const p = sysInfo.protection;
  const el = $('#sysNote');
  el.className = 'sys-note ' + p.level;
  el.textContent = t(p.code, { build: p.build, win: p.win });
}

function renderLastCheck() {
  const el = $('#lastCheck');
  const lc = settings.lastCheck;
  if (!lc) {
    el.className = 'last-check';
    el.textContent = t('neverChecked');
    return;
  }
  const d = new Date(lc.date).toLocaleString(i18n.lang === 'en' ? 'en-US' : 'es', { dateStyle: 'medium', timeStyle: 'short' });
  el.className = 'last-check ' + (lc.passed ? 'ok' : 'fail');
  el.innerHTML = `<svg><use href="#${lc.passed ? 'i-check' : 'i-x'}"/></svg>`;
  el.append(`${t('lastCheck', { d })} — ${lc.passed ? t('lastCheckOk') : t('lastCheckFail')}`);
}

// ---------- Prueba de invisibilidad ----------

function renderSelfTest(el, r) {
  el.hidden = false;
  if (!r) { el.className = 'st-result'; el.textContent = t('stRunning'); return; }
  const kind = r.error ? (r.error === 'permission' ? 'warn' : 'bad') : !r.protection ? 'warn' : r.visible ? 'bad' : 'ok';
  const [title, text] = r.error === 'permission' ? [t('stPermissionT'), t('stPermission')]
    : r.error ? [t('stError', { e: r.error }), '']
    : !r.protection ? [t('stOffT'), t('stOff')]
    : r.visible ? [t('stVisibleT'), t('stVisible')]
    : [t('stHiddenT'), t('stHidden')];
  el.className = 'st-result ' + kind;
  el.innerHTML = '<b></b><span></span>';
  el.firstChild.textContent = (kind === 'ok' ? '✓ ' : kind === 'bad' ? '✗ ' : '! ') + title;
  el.lastChild.textContent = text;
  if (r.date) {
    const small = document.createElement('small');
    small.textContent = t('stWhen', { d: new Date(r.date).toLocaleString(i18n.lang === 'en' ? 'en-US' : 'es', { dateStyle: 'medium', timeStyle: 'short' }) });
    el.append(small);
  }
}

async function runSelfTest(el) {
  renderSelfTest(el, null);
  await flushSave();
  if (!status.open && currentId) await pf.invoke('prompter:open', currentId);
  const r = await pf.invoke('capture:selftest');
  renderSelfTest(el, r);
  if (!r.error) settings.lastSelfTest = r;
}

// ---------- Control remoto ----------

async function renderRemote(info) {
  info = info || (await pf.invoke('remote:info'));
  $('#remoteToggle').checked = !!info.running;
  $('#remoteBox').classList.toggle('on', !!info.running);
  $('#remoteErr').textContent = info.error ? t('remoteError', { e: info.error }) : '';
  if (info.running) {
    $('#qrImg').src = info.qr;
    $('#remoteUrl').textContent = info.url;
    renderFirewall(await pf.invoke('firewall:status'));
  }
}

function renderFirewall(st, extra) {
  $('#fwBox').hidden = !st.needed || st.allowed;
  $('#fwOk').hidden = !st.needed || !st.allowed;
  $('#fwOk').textContent = '✓ ' + t('fwOk');
  $('#fwTitle').textContent = t('fwBlocked');
  $('#fwDesc').textContent = extra || t('fwBlockedDesc');
  $('#btnFw').textContent = t('fwAllow');
  $('#btnFw').disabled = false;
}

// ---------- Recording Check ----------

function renderRcButtons() {
  const b = $('#rcProt');
  b.textContent = settings.captureProtection ? `✓ ${t('rcEnabled')}` : t('rcEnable');
  b.disabled = !!settings.captureProtection;
}

function openCheck() {
  $$('.rcq').forEach((c) => (c.checked = false));
  renderRcButtons();
  $('#rcModal').hidden = false;
}

function closeCheck() {
  $('#rcModal').hidden = true;
}

// ---------- Eventos ----------

function bindUi() {
  $('#search').addEventListener('input', (e) => { filter = e.target.value; renderList(); });
  $('#btnNew').onclick = newScript;
  $('#btnImport').onclick = async () => {
    const { imported, errors } = await pf.invoke('script:import');
    if (imported.length) {
      scripts.unshift(...imported);
      select(imported[0].id);
      toast(t('importedN', { n: imported.length }));
    }
    if (errors.length) toast(`${t('importErrors')}\n${errors.join('\n')}`);
  };
  $('#btnDup').onclick = async () => {
    if (!current()) return;
    await flushSave();
    const s = await pf.invoke('script:duplicate', currentId);
    scripts.unshift(s);
    select(s.id);
  };
  $('#btnDel').onclick = async () => {
    const s = current();
    if (!s || !confirm(t('confirmDelete', { t: s.title }))) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await pf.invoke('script:delete', s.id);
    scripts = scripts.filter((x) => x.id !== s.id);
    if (!scripts.length) return newScript();
    select(scripts[0].id);
  };

  $('#title').addEventListener('input', scheduleSave);
  $('#folder').addEventListener('input', scheduleSave);
  $('#content').addEventListener('input', () => { scheduleSave(); renderStats(); });
  $('#title').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#content').focus(); });

  $('#btnOpen').onclick = async () => { await flushSave(); pf.invoke('prompter:open', currentId); };
  $$('[data-cmd]').forEach((b) => b.addEventListener('click', async () => {
    const cmd = b.dataset.cmd;
    if (!status.open) {
      await flushSave();
      const then = cmd === 'toggle' ? 'play' : cmd === 'countdown' ? 'playCountdown' : null;
      return pf.invoke('prompter:open', currentId, then);
    }
    pf.send('prompter:cmd', { cmd });
  }));

  $$('#tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
    if (b.dataset.tab === 'window') renderDisplays();
  }));

  $$('[data-pos]').forEach((b) => b.addEventListener('click', async () => {
    if (!status.open) { await flushSave(); await pf.invoke('prompter:open', currentId); }
    pf.invoke('prompter:position', { preset: b.dataset.pos, displayId: Number($('#displaySelect').value) });
  }));
  $('#ctToggle').addEventListener('change', (e) => {
    if (e.target.checked !== !!status.clickThrough) pf.send('prompter:cmd', { cmd: 'clickThrough' });
  });

  $('#remoteToggle').addEventListener('change', async (e) => renderRemote(await pf.invoke('remote:set', e.target.checked)));
  $('#btnFw').onclick = async () => {
    $('#btnFw').disabled = true;
    $('#btnFw').textContent = t('fwAllowing');
    const st = await pf.invoke('firewall:allow');
    renderFirewall(st, st.allowed ? '' : t(st.canceled ? 'fwCanceled' : 'fwFailed'));
  };
  $('#btnCopyUrl').onclick = () => {
    navigator.clipboard.writeText($('#remoteUrl').textContent);
    $('#btnCopyUrl').textContent = t('copied');
    setTimeout(() => ($('#btnCopyUrl').textContent = t('copy')), 1500);
  };

  // Recording Check
  $('#btnCheck').onclick = openCheck;
  $('#rcClose').onclick = closeCheck;
  $('#rcCancel').onclick = closeCheck;
  $('#rcProt').onclick = () => setSetting({ captureProtection: true });
  $('#btnSelfTest').onclick = () => runSelfTest($('#selfTestResult'));
  $('#rcSelfTestBtn').onclick = () => runSelfTest($('#rcSelfTest'));
  $('#rcOpen').onclick = async () => { await flushSave(); await pf.invoke('prompter:open', currentId, 'play'); };
  $('#rcLoom').onclick = () => window.open('https://www.loom.com/');
  $('#rcSave').onclick = async () => {
    const passed = $$('.rcq').every((c) => c.checked);
    await setSetting({ lastCheck: { date: Date.now(), passed } });
    closeCheck();
    toast(passed ? t('rcPassed') : t('rcFailed'));
  };
  $('#rcModal').addEventListener('click', (e) => { if (e.target.id === 'rcModal') closeCheck(); });

  // Ayuda de formato
  $('#btnSyntax').onclick = (e) => {
    const pop = $('#syntaxPop');
    if (!pop.hidden) { pop.hidden = true; return; }
    const r = e.currentTarget.getBoundingClientRect();
    pop.hidden = false;
    pop.style.top = `${r.bottom + 8}px`;
    pop.style.left = `${Math.max(12, r.right - pop.offsetWidth)}px`;
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#syntaxPop') && !e.target.closest('#btnSyntax')) $('#syntaxPop').hidden = true;
  });

  document.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newScript(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); $('#btnOpen').click(); }
    if (e.key === 'Escape') { closeCheck(); $('#syntaxPop').hidden = true; }
  });
  window.addEventListener('beforeunload', () => flushSave());
}

function applyLanguage() {
  i18n.setLang(settings.language);
  renderList();
  renderStats();
  renderStatus();
  renderShortcuts();
  renderSysNote();
  renderDisplays();
  if (settings.lastSelfTest) renderSelfTest($('#selfTestResult'), settings.lastSelfTest);
  renderSettings();
  if ($('#saveState').textContent) $('#saveState').textContent = t('saved');
}

// ---------- Inicio ----------

(async function init() {
  const data = await pf.invoke('data:get');
  scripts = data.scripts;
  settings = data.settings;
  shortcuts = await pf.invoke('shortcuts:list');
  sysInfo = await pf.invoke('system:info');
  i18n.setLang(settings.language);

  bindUi();
  bindSettings();
  applyLanguage();
  renderRemote();

  if (scripts.length) select(scripts[0].id);
  else newScript();

  pf.on('settings', (s) => {
    const langChanged = s.language !== settings.language;
    settings = s;
    if (langChanged) applyLanguage();
    else renderSettings();
  });
  pf.on('status', (s) => {
    const sectionChanged = s.section !== status.section;
    status = s;
    renderStatus();
    if (sectionChanged) renderStats();
  });
  pf.on('clickthrough', (on) => { status.clickThrough = on; renderStatus(); });
})();

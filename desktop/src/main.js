const { app, BrowserWindow, ipcMain, globalShortcut, dialog, screen, shell, desktopCapturer, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const store = require('./store');
const { importFile } = require('./importers');
const remote = require('./remote-server');

let mainWin = null;
let prompterWin = null;
let currentScriptId = null;
let clickThrough = false;
let lastStatus = null;

const RENDERER = path.join(__dirname, 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

// Atajos globales: funcionan aunque PowerPoint, Slides o Canva tengan el foco.
// Solo letras y flechas verticales: evitan choques con AltGr (teclado español)
// y con los atajos de cambio de pestaña del navegador.
const SHORTCUTS = [
  { keys: 'CommandOrControl+Alt+P', cmd: 'countdown' },
  { keys: 'CommandOrControl+Alt+I', cmd: 'toggle' },
  { keys: 'CommandOrControl+Alt+Up', cmd: 'faster' },
  { keys: 'CommandOrControl+Alt+Down', cmd: 'slower' },
  { keys: 'CommandOrControl+Alt+B', cmd: 'back' },
  { keys: 'CommandOrControl+Alt+F', cmd: 'forward' },
  { keys: 'CommandOrControl+Alt+N', cmd: 'nextSection' },
  { keys: 'CommandOrControl+Alt+V', cmd: 'prevSection' },
  { keys: 'CommandOrControl+Alt+X', cmd: 'clickThrough' },
  { keys: 'CommandOrControl+Alt+H', cmd: 'hide' },
];

// ---------- Ventanas ----------

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    title: 'GuionFlow',
    backgroundColor: '#0b0d12',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  mainWin.setMenuBarVisibility(false);
  applyProtection(mainWin);
  mainWin.loadFile(path.join(RENDERER, 'index.html'));
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
  denyNavigation(mainWin);
}

function defaultPrompterBounds() {
  // Arriba al centro, justo debajo de donde suele estar la cámara web.
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(900, Math.round(wa.width * 0.55));
  const height = Math.min(360, Math.round(wa.height * 0.38));
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + 12, width, height };
}

function boundsAreVisible(b) {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return b.x < wa.x + wa.width - 40 && b.x + b.width > wa.x + 40 && b.y >= wa.y - 20 && b.y < wa.y + wa.height - 40;
  });
}

// thenCmd: comando a ejecutar cuando el teleprompter termine de cargar (p. ej. iniciar).
function openPrompter(scriptId, thenCmd) {
  if (scriptId) currentScriptId = scriptId;
  if (prompterWin) {
    if (prompterWin.isMinimized()) prompterWin.restore();
    prompterWin.show();
    sendScriptToPrompter();
    if (thenCmd) prompterWin.webContents.send('cmd', { cmd: thenCmd });
    return;
  }
  const saved = store.getSettings().prompterBounds;
  const bounds = saved && boundsAreVisible(saved) ? saved : defaultPrompterBounds();

  prompterWin = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 140,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    fullscreenable: false,
    title: 'GuionFlow — Teleprompter',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // Nivel 'screen-saver': queda por encima incluso de presentaciones a pantalla completa.
  prompterWin.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') prompterWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyProtection(prompterWin);
  prompterWin.loadFile(path.join(RENDERER, 'prompter.html'));
  denyNavigation(prompterWin);
  if (thenCmd) {
    prompterWin.webContents.once('did-finish-load', () =>
      setTimeout(() => prompterWin && prompterWin.webContents.send('cmd', { cmd: thenCmd }), 400));
  }

  let boundsTimer;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (prompterWin && !prompterWin.isDestroyed()) store.setSettings({ prompterBounds: prompterWin.getBounds() });
    }, 300);
  };
  prompterWin.on('move', rememberBounds);
  prompterWin.on('resize', rememberBounds);
  prompterWin.on('closed', () => {
    prompterWin = null;
    clickThrough = false;
    updateStatus({ open: false, playing: false });
    sendToMain('clickthrough', false);
  });
}

function sendScriptToPrompter() {
  if (!prompterWin) return;
  const script = currentScriptId && store.getScript(currentScriptId);
  prompterWin.webContents.send('script', script || null);
}

function applyProtection(win) {
  if (!win || win.isDestroyed()) return;
  // Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE). macOS: NSWindowSharingNone.
  win.setContentProtection(!!store.getSettings().captureProtection);
}

function setClickThrough(on) {
  clickThrough = !!on;
  if (prompterWin) {
    // forward:true deja que el teleprompter siga recibiendo el movimiento del mouse
    // (para mostrar la barra al pasar), pero los clics llegan a la app de abajo.
    prompterWin.setIgnoreMouseEvents(clickThrough, { forward: true });
    if (!clickThrough) prompterWin.focus();
    prompterWin.webContents.send('clickthrough', clickThrough);
  }
  sendToMain('clickthrough', clickThrough);
}

function positionPrompter(preset, displayId) {
  if (!prompterWin) openPrompter();
  const display = screen.getAllDisplays().find((d) => d.id === displayId) || screen.getDisplayMatching(prompterWin.getBounds());
  const wa = display.workArea;
  const cur = prompterWin.getBounds();
  let b;
  const w = (f) => Math.round(wa.width * f);
  const h = (f) => Math.round(wa.height * f);
  switch (preset) {
    case 'camera': b = { width: w(0.5), height: h(0.34) }; b.x = wa.x + (wa.width - b.width) / 2; b.y = wa.y + 10; break;
    case 'bottom': b = { width: w(0.6), height: h(0.3) }; b.x = wa.x + (wa.width - b.width) / 2; b.y = wa.y + wa.height - b.height - 10; break;
    case 'left': b = { width: w(0.3), height: h(0.8) }; b.x = wa.x + 10; b.y = wa.y + (wa.height - b.height) / 2; break;
    case 'right': b = { width: w(0.3), height: h(0.8) }; b.x = wa.x + wa.width - b.width - 10; b.y = wa.y + (wa.height - b.height) / 2; break;
    case 'full': b = { x: wa.x, y: wa.y, width: wa.width, height: wa.height }; break;
    default: b = { ...cur, x: wa.x + (wa.width - cur.width) / 2, y: wa.y + 10 };
  }
  b = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  prompterWin.setBounds(b);
  prompterWin.show();
}

function denyNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function sendToMain(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

function broadcastSettings() {
  const s = store.getSettings();
  for (const w of [mainWin, prompterWin]) if (w && !w.isDestroyed()) w.webContents.send('settings', s);
}

function updateStatus(patch) {
  lastStatus = { ...(lastStatus || {}), ...patch, clickThrough, open: !!prompterWin && (patch.open ?? true), lang: store.getSettings().language };
  sendToMain('status', lastStatus);
  remote.broadcast(lastStatus);
}

// ---------- Comandos (atajos, celular, botones) ----------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = (v) => Math.round(v * 100) / 100;

function handleCommand(cmd, arg) {
  const s = store.getSettings();
  switch (cmd) {
    case 'faster':
      store.setSettings({ speed: round2(clamp(s.speed + 0.25, 0.25, 10)) });
      return broadcastSettings();
    case 'slower':
      store.setSettings({ speed: round2(clamp(s.speed - 0.25, 0.25, 10)) });
      return broadcastSettings();
    case 'setSpeed':
      store.setSettings({ speed: round2(clamp(Number(arg) || s.speed, 0.25, 10)) });
      return broadcastSettings();
    case 'fontUp':
      store.setSettings({ fontSize: clamp(s.fontSize + 2, 16, 140) });
      return broadcastSettings();
    case 'fontDown':
      store.setSettings({ fontSize: clamp(s.fontSize - 2, 16, 140) });
      return broadcastSettings();
    case 'clickThrough':
      return setClickThrough(!clickThrough);
    case 'hide':
      if (!prompterWin) return openPrompter();
      if (prompterWin.isMinimized()) return prompterWin.restore();
      return prompterWin.isVisible() ? prompterWin.hide() : prompterWin.showInactive();
    default:
      // toggle, countdown, play, pause, back, forward, top, nextSection, prevSection, gotoSection
      if (!prompterWin) {
        if (cmd === 'toggle' || cmd === 'play') openPrompter(null, 'play');
        if (cmd === 'countdown') openPrompter(null, 'playCountdown');
        return;
      }
      if (prompterWin.isMinimized() && ['toggle', 'countdown', 'play'].includes(cmd)) prompterWin.restore();
      prompterWin.webContents.send('cmd', { cmd, arg });
  }
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  return SHORTCUTS.map((sc) => {
    let ok = false;
    try {
      ok = globalShortcut.register(sc.keys, () => handleCommand(sc.cmd));
    } catch { ok = false; }
    return { ...sc, ok };
  });
}

// ---------- Prueba de invisibilidad ----------
// Pinta el teleprompter de magenta un instante, captura la pantalla con la misma API
// que usan los grabadores (Loom, OBS) y comprueba si el magenta aparece en la captura.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureSelfTest() {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    // Sin este permiso la captura saldría vacía y la prueba daría un falso "invisible".
    try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch { /* abre el aviso del sistema */ }
    if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { error: 'permission' };
  }
  if (!prompterWin) openPrompter();
  if (prompterWin.webContents.isLoading()) {
    await new Promise((r) => prompterWin.webContents.once('did-finish-load', r));
    await wait(400);
  }
  if (!prompterWin.isVisible()) prompterWin.showInactive();

  const bounds = prompterWin.getBounds();
  const display = screen.getDisplayMatching(bounds);
  prompterWin.webContents.send('testpattern', true);
  await wait(450);
  let result;
  try {
    const { width, height } = display.size;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const src = sources.find((x) => x.display_id === String(display.id)) || sources[0];
    const img = src.thumbnail;
    const size = img.getSize();
    const bmp = img.toBitmap(); // BGRA
    const sx = size.width / display.bounds.width;
    const sy = size.height / display.bounds.height;
    let total = 0;
    let magenta = 0;
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 12; j++) {
        const x = Math.floor((bounds.x - display.bounds.x + (bounds.width * i) / 20) * sx);
        const y = Math.floor((bounds.y - display.bounds.y + (bounds.height * j) / 12) * sy);
        if (x < 0 || y < 0 || x >= size.width || y >= size.height) continue;
        const o = (y * size.width + x) * 4;
        const b = bmp[o], g = bmp[o + 1], r = bmp[o + 2];
        total++;
        if (r > 200 && b > 200 && g < 80) magenta++;
      }
    }
    const ratio = total ? magenta / total : 0;
    result = { visible: ratio > 0.25, ratio, protection: !!store.getSettings().captureProtection, date: Date.now() };
  } catch (err) {
    result = { error: err.message };
  } finally {
    if (prompterWin) prompterWin.webContents.send('testpattern', false);
  }
  if (!result.error) store.setSettings({ lastSelfTest: result });
  return result;
}

// ---------- Firewall de Windows (control desde el celular) ----------
// Si la red Wi-Fi está como "Pública" o se rechazó el aviso del firewall, Windows bloquea
// la conexión del celular aunque el QR se escanee bien. Se crea una regla para esta app.

const FW_RULE = 'GuionFlow (control desde el celular)';

function firewallStatus() {
  if (process.platform !== 'win32') return Promise.resolve({ needed: false, allowed: true });
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FW_RULE}`, 'verbose'], { windowsHide: true }, (err, stdout) => {
      const allowed = !err && String(stdout).toLowerCase().includes(process.execPath.toLowerCase());
      resolve({ needed: true, allowed });
    });
  });
}

function allowFirewall() {
  if (process.platform !== 'win32') return Promise.resolve({ needed: false, allowed: true });
  const { execFile } = require('child_process');
  const exe = process.execPath.replace(/'/g, "''");
  const args = `advfirewall firewall add rule name="${FW_RULE}" dir=in action=allow program="${exe}" enable=yes profile=any`;
  // Start-Process -Verb RunAs muestra el aviso de administrador de Windows una sola vez.
  const ps = `Start-Process -FilePath netsh -ArgumentList '${args.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true }, async (err) => {
      const st = await firewallStatus();
      resolve({ ...st, canceled: !!err && !st.allowed });
    });
  });
}

// ---------- IPC ----------

function setupIpc() {
  ipcMain.handle('data:get', () => store.getAll());

  ipcMain.handle('script:save', (_e, script) => {
    const saved = store.saveScript(script);
    if (saved.id === currentScriptId) sendScriptToPrompter();
    return saved;
  });
  ipcMain.handle('script:delete', (_e, id) => store.deleteScript(id));
  ipcMain.handle('script:duplicate', (_e, id) => store.duplicateScript(id));

  ipcMain.handle('script:import', async () => {
    const res = await dialog.showOpenDialog(mainWin, {
      title: store.getSettings().language === 'en' ? 'Import scripts' : 'Importar guiones',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: store.getSettings().language === 'en' ? 'Scripts' : 'Guiones', extensions: ['txt', 'md', 'docx', 'pdf'] }],
    });
    if (res.canceled) return { imported: [], errors: [] };
    const imported = [];
    const errors = [];
    for (const f of res.filePaths) {
      try {
        const { title, content } = await importFile(f);
        imported.push(store.saveScript({ title, content, folder: 'Importados' }));
      } catch (err) {
        errors.push(`${path.basename(f)}: ${err.message}`);
      }
    }
    return { imported, errors };
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    const before = store.getSettings();
    const s = store.setSettings(patch);
    if ('captureProtection' in patch && patch.captureProtection !== before.captureProtection) {
      applyProtection(mainWin);
      applyProtection(prompterWin);
    }
    broadcastSettings();
    return s;
  });

  ipcMain.handle('prompter:open', (_e, scriptId, thenCmd) => openPrompter(scriptId, thenCmd));
  ipcMain.handle('prompter:init', () => ({
    script: currentScriptId ? store.getScript(currentScriptId) : null,
    settings: store.getSettings(),
    clickThrough,
  }));
  ipcMain.handle('prompter:position', (_e, { preset, displayId }) => positionPrompter(preset, displayId));
  ipcMain.on('prompter:cmd', (_e, { cmd, arg }) => handleCommand(cmd, arg));
  ipcMain.on('prompter:status', (_e, status) => updateStatus(status));
  ipcMain.on('prompter:close', () => prompterWin && prompterWin.close());
  ipcMain.on('prompter:minimize', () => prompterWin && prompterWin.minimize());
  ipcMain.on('prompter:resize', (_e, { width, height }) => {
    if (!prompterWin) return;
    const b = prompterWin.getBounds();
    prompterWin.setBounds({ ...b, width: Math.max(320, Math.round(width)), height: Math.max(140, Math.round(height)) });
  });

  ipcMain.handle('displays:list', () =>
    screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      index: i + 1,
      primary: d.id === screen.getPrimaryDisplay().id,
      size: `${d.size.width}×${d.size.height}`,
    }))
  );

  ipcMain.handle('remote:set', async (_e, enabled) => {
    store.setSettings({ remoteEnabled: !!enabled });
    if (enabled) {
      try {
        await remote.start(handleCommand);
      } catch (err) {
        store.setSettings({ remoteEnabled: false });
        return { running: false, error: err.message };
      }
    } else {
      remote.stop();
    }
    return remote.info();
  });
  ipcMain.handle('remote:info', () => remote.info());
  ipcMain.handle('firewall:status', () => firewallStatus());
  ipcMain.handle('firewall:allow', () => allowFirewall());

  ipcMain.handle('shortcuts:list', () => shortcutState);
  ipcMain.handle('capture:selftest', () => captureSelfTest());

  ipcMain.handle('system:info', () => {
    const [major, , build] = os.release().split('.').map(Number);
    // El texto se traduce en la interfaz a partir de 'code'.
    let protection;
    if (process.platform === 'win32') {
      protection = major >= 10 && build >= 19041
        ? { level: 'ok', code: 'protWinOk', build, win: build >= 22000 ? '11' : '10' }
        : { level: 'warn', code: 'protWinOld', build };
    } else if (process.platform === 'darwin') {
      protection = { level: 'warn', code: 'protMac' };
    } else {
      protection = { level: 'warn', code: 'protLinux' };
    }
    return { platform: process.platform, release: os.release(), version: app.getVersion(), protection };
  });
}

let shortcutState = [];

// Solo para desarrollo: PF_CAPTURETEST=<carpeta> compara capturas externas con y sin protección.
async function runCaptureTest(dir) {
  const { execFileSync } = require('child_process');
  await wait(2000);
  openPrompter(store.getAll().scripts[0].id);
  await wait(1500);
  const grabbers = {
    ddagrab: ['-y', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:draw_mouse=0:framerate=5,hwdownload,format=bgra', '-frames:v', '1'],
    gdigrab: ['-y', '-f', 'gdigrab', '-i', 'desktop', '-frames:v', '1'],
  };
  for (const prot of [true, false]) {
    store.setSettings({ captureProtection: prot });
    applyProtection(prompterWin);
    applyProtection(mainWin);
    await wait(500);
    console.log('SELFTEST protection=' + prot, JSON.stringify(await captureSelfTest()));
    prompterWin.webContents.send('testpattern', true);
    await wait(500);
    for (const [name, args] of Object.entries(grabbers)) {
      try {
        execFileSync('ffmpeg', [...args, path.join(dir, `${name}-protection-${prot}.png`)], { stdio: 'ignore', timeout: 20000 });
        console.log('captured', name, prot);
      } catch (e) { console.log('fail', name, e.message); }
    }
    prompterWin.webContents.send('testpattern', false);
  }
  store.setSettings({ captureProtection: true });
  app.quit();
}

// Solo para desarrollo: PF_SNAPSHOT=<carpeta> guarda capturas de ambas ventanas y cierra la app.
async function runSnapshot(dir) {
  const fs = require('fs');
  const shot = async (win, name) => {
    try { win.showInactive(); await wait(200); fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG()); console.log('ok', name); }
    catch (e) { console.log('fail', name, e.message); }
  };
  await wait(2500);
  await shot(mainWin, 'main.png');
  openPrompter(store.getAll().scripts[0].id);
  await wait(1500);
  prompterWin.webContents.send('cmd', { cmd: 'gotoSection', arg: 1 });
  await wait(1200);
  await shot(prompterWin, 'prompter.png');
  prompterWin.webContents.send('cmd', { cmd: 'countdown' });
  await wait(1300);
  await shot(prompterWin, 'prompter-countdown.png');
  prompterWin.webContents.send('cmd', { cmd: 'pause' });
  await wait(300);
  await wait(300);
  await shot(mainWin, 'main-live.png');
  await mainWin.webContents.executeJavaScript(`document.querySelector('[data-tab="privacy"]').click(); document.querySelector('#btnSelfTest').click();`);
  await wait(3000);
  await shot(mainWin, 'selftest.png');
  const lang = store.getSettings().language;
  store.setSettings({ language: 'en' });
  broadcastSettings();
  await mainWin.webContents.executeJavaScript(`document.querySelector('[data-tab="privacy"]').click()`);
  await wait(600);
  await shot(mainWin, 'main-en-privacy.png');
  await shot(prompterWin, 'prompter-en.png');
  await remote.start(handleCommand);
  const info = await remote.info();
  const phone = new BrowserWindow({ width: 390, height: 844 });
  await phone.loadURL(info.url);
  await wait(1200);
  await shot(phone, 'remote.png');
  store.setSettings({ language: lang });
  await mainWin.webContents.executeJavaScript(`document.querySelector('[data-tab="remote"]').click(); document.querySelector('#remoteToggle').checked = true;`);
  await mainWin.webContents.executeJavaScript(`window.pf.invoke('remote:info')`);
  remote.stop();
  app.quit();
}

// ---------- Arranque ----------

// Las pruebas de desarrollo usan su propia carpeta de datos (no tocan los guiones reales).
if (process.env.PF_SNAPSHOT || process.env.PF_CAPTURETEST || process.env.PF_LANDING) {
  app.setPath('userData', path.join(app.getPath('temp'), process.env.PF_LANDING ? 'GuionFlow-landing' : 'GuionFlow-test'));
}

// Solo para desarrollo: PF_LANDING=<carpeta> graba los videos y capturas reales de la landing.
async function runLandingCapture(dir) {
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const script = store.getAll().scripts[0];
  const display = screen.getPrimaryDisplay();
  const slide = new BrowserWindow({ ...display.bounds, frame: false, focusable: false, skipTaskbar: true, show: false, fullscreen: true, backgroundColor: '#fbf8f2' });
  slide.setAlwaysOnTop(true, 'floating');
  await slide.loadFile(path.join(__dirname, '..', 'tools', 'slide.html'));
  slide.showInactive();
  store.setSettings({ speed: 4, fontSize: 40, countdown: 3, bgOpacity: 0.9, highlight: true, compact: false, prompterBounds: null });
  openPrompter(script.id);
  await new Promise((r) => prompterWin.webContents.once('did-finish-load', r));
  prompterWin.setFocusable(false);
  const wa = display.workArea;
  const w = Math.round(wa.width * 0.46), h = Math.round(wa.height * 0.3);
  prompterWin.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + 14, width: w, height: h });
  await wait(1500);
  prompterWin.setAlwaysOnTop(true, 'screen-saver');
  prompterWin.moveTop();
  prompterWin.showInactive();
  await wait(500);
  const shot = async (win, name) => fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
  const grab = (name, secs) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:draw_mouse=0:framerate=30,hwdownload,format=bgra',
    '-t', String(secs), '-vf', 'scale=1280:-2,format=yuv420p', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-an', '-movflags', '+faststart', path.join(dir, name)], { timeout: 60000 });
  const still = (name) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'ddagrab=output_idx=0:framerate=5,hwdownload,format=bgra', '-frames:v', '1', path.join(dir, name)], { timeout: 30000 });
  for (const [prot, tag] of [[false, 'see'], [true, 'rec']]) {
    store.setSettings({ captureProtection: prot });
    applyProtection(prompterWin);
    applyProtection(mainWin);
    prompterWin.webContents.send('cmd', { cmd: 'top' });
    await wait(900);
    still(`${tag}.png`);
    prompterWin.webContents.send('cmd', { cmd: 'play' });
    grab(`${tag}.mp4`, 9);
    prompterWin.webContents.send('cmd', { cmd: 'pause' });
    console.log('ok', tag);
  }
  store.setSettings({ captureProtection: true });
  applyProtection(prompterWin);
  slide.close();
  if (process.env.PF_LANDING_VIDEO_ONLY) return app.quit();
  // Capturas de la interfaz
  prompterWin.webContents.send('cmd', { cmd: 'gotoSection', arg: 1 });
  await wait(1200);
  await shot(prompterWin, 'ui-prompter.png');
  mainWin.setBounds({ x: wa.x + 40, y: wa.y + 40, width: 1440, height: 880 });
  mainWin.showInactive();
  await wait(800);
  await shot(mainWin, 'ui-main.png');
  await mainWin.webContents.executeJavaScript(`document.querySelector('[data-tab="privacy"]').click(); document.querySelector('#btnSelfTest').click();`);
  await wait(3500);
  await shot(mainWin, 'ui-privacy.png');
  await remote.start(handleCommand);
  const phone = new BrowserWindow({ width: 390, height: 844, focusable: false, show: false });
  phone.showInactive();
  await phone.loadURL((await remote.info()).url);
  await wait(1500);
  await shot(phone, 'ui-remote.png');
  remote.stop();
  console.log('done');
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  app.whenReady().then(async () => {
    store.load();
    setupIpc();
    createMainWindow();
    shortcutState = registerShortcuts();
    if (store.getSettings().remoteEnabled) {
      remote.start(handleCommand).catch(() => store.setSettings({ remoteEnabled: false }));
    }
    if (process.env.PF_SNAPSHOT) runSnapshot(process.env.PF_SNAPSHOT);
    if (process.env.PF_CAPTURETEST) runCaptureTest(process.env.PF_CAPTURETEST);
    if (process.env.PF_LANDING) runLandingCapture(process.env.PF_LANDING);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    remote.stop();
    store.flush();
  });

  app.on('window-all-closed', () => app.quit());
}

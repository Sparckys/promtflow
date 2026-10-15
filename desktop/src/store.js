// Almacenamiento local: un archivo JSON en la carpeta de datos del usuario.
// Sin internet, sin cuentas, sin módulos nativos (funciona igual en Windows y Mac).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  language: 'es',            // 'es' | 'en'
  scrollMode: 'auto',        // 'auto' | 'manual'
  speed: 3,                  // 0.5x – 10x
  fontSize: 42,              // px
  lineHeight: 1.5,
  fontFamily: 'sans',        // 'sans' | 'serif' | 'mono'
  textColor: '#ffffff',
  bgOpacity: 0.9,            // 0 – 1, solo el fondo (el texto queda nítido)
  textWidth: 92,             // % del ancho de la ventana
  readingLine: 30,           // % desde arriba: dónde está la línea de lectura
  highlight: true,           // resaltar línea de lectura
  mirror: false,             // espejo horizontal (para cristal de teleprompter físico)
  countdown: 3,              // segundos de cuenta atrás al iniciar (0 = sin cuenta)
  autoPause: true,           // detenerse en las marcas [PAUSA]
  compact: false,            // barra superior oculta hasta pasar el mouse
  captureProtection: true,   // excluir de la captura de pantalla (Windows 10 2004+)
  remoteEnabled: false,      // control desde el celular
  prompterBounds: null,
  lastCheck: null,           // resultado del último Recording Check
};

const SAMPLE = `[Diapositiva 1] Bienvenida

Hoy quiero mostrarte algo importante.

¿Y si pudieras convertir lo que ya sabes en un negocio real?

[PAUSA]

[Diapositiva 2] El problema

La mayoría de las personas pasa años sentada sobre una idea. La piensa, la imagina... pero nunca la graba.

**No es falta de conocimiento. Es falta de un sistema.**

[Diapositiva 3] La solución

La verdad es que no necesitas millones de seguidores. Necesitas un mensaje claro, una estructura simple y la constancia de presentarlo.

[mirar a cámara]

[Diapositiva 4] Cierre

Si llegaste hasta aquí, ya estás haciendo lo que el 99% no hace.

Empecemos.`;

let file;
let data;

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function load() {
  file = path.join(app.getPath('userData'), 'guionflow-data.json');
  migrateFromPromptFlow();
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.scripts)) {
    const now = Date.now();
    data = {
      scripts: [{ id: newId(), title: 'Guion de ejemplo', folder: 'Ejemplos', content: SAMPLE, createdAt: now, updatedAt: now }],
      settings: {},
    };
  }
  data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (!data.settings.countdown) data.settings.countdown = 3;
  save();
}

// La app se llamaba PromptFlow: si existen guiones guardados con ese nombre, se traspasan una vez.
function migrateFromPromptFlow() {
  if (fs.existsSync(file)) return;
  const old = [
    path.join(app.getPath('userData'), 'promptflow-data.json'),
    path.join(app.getPath('appData'), 'PromptFlow', 'promptflow-data.json'),
  ].find((f) => fs.existsSync(f));
  if (old) {
    try { fs.copyFileSync(old, file); } catch { /* si falla, se empieza con el guion de ejemplo */ }
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

function flush() {
  clearTimeout(saveTimer);
  if (!file || !data) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getAll() {
  return { scripts: data.scripts, settings: data.settings };
}

function getSettings() {
  return data.settings;
}

function setSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  save();
  return data.settings;
}

function getScript(id) {
  return data.scripts.find((s) => s.id === id) || null;
}

function saveScript(script) {
  const now = Date.now();
  const existing = script.id && getScript(script.id);
  if (existing) {
    Object.assign(existing, {
      title: script.title ?? existing.title,
      folder: script.folder ?? existing.folder,
      content: script.content ?? existing.content,
      updatedAt: now,
    });
    save();
    return existing;
  }
  const created = {
    id: newId(),
    title: script.title || 'Nuevo guion',
    folder: script.folder || '',
    content: script.content || '',
    createdAt: now,
    updatedAt: now,
  };
  data.scripts.unshift(created);
  save();
  return created;
}

function deleteScript(id) {
  data.scripts = data.scripts.filter((s) => s.id !== id);
  save();
}

function duplicateScript(id) {
  const s = getScript(id);
  if (!s) return null;
  return saveScript({ title: s.title + ' (copia)', folder: s.folder, content: s.content });
}

module.exports = { load, flush, getAll, getSettings, setSettings, getScript, saveScript, deleteScript, duplicateScript, DEFAULT_SETTINGS };

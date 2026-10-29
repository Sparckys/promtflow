/* global PFNative, i18n */
// Capa de Android: se inyecta en index.html y prompter.html (después de i18n.js, antes de app.js / prompter.js).
// 1) window.pf: el mismo puente que preload.js en Electron, conectado al código nativo (Hub.java).
// 2) Textos propios de la tablet (permisos, grabación en Android).
// 3) Gestos táctiles: arrastrar el teleprompter, mostrar las barras en modo compacto, aviso de grabación.
(function () {
  const N = window.PFNative;
  if (!N) return;
  document.documentElement.classList.add('android');

  // ---------- Puente window.pf ----------
  const calls = new Map();
  const listeners = {};
  let seq = 0;
  window.__pf = {
    resolve(id, json) {
      const done = calls.get(id);
      if (!done) return;
      calls.delete(id);
      done(JSON.parse(json));
    },
    emit(channel, json) {
      const payload = JSON.parse(json);
      (listeners[channel] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
    },
  };
  window.pf = {
    platform: 'android',
    invoke: (channel, ...args) => new Promise((resolve) => {
      const id = ++seq;
      calls.set(id, resolve);
      N.invoke(id, channel, JSON.stringify(args));
    }),
    send: (channel, ...args) => N.send(channel, JSON.stringify(args)),
    on: (channel, fn) => {
      (listeners[channel] = listeners[channel] || []).push(fn);
      return () => { listeners[channel] = listeners[channel].filter((f) => f !== fn); };
    },
  };

  // ---------- Textos de la tablet ----------
  const TEXT = {
    es: {
      importHint: 'TXT, DOCX o MD',
      offline: 'Todo se guarda en tu tablet. Sin internet, sin cuentas.',
      protectionDesc: 'Android protege el guion: ninguna grabación ni captura de pantalla puede copiar lo que dice. Tú lo sigues viendo en la tablet.',
      protAndroid: 'Android {build}: protección activa. Si grabas la pantalla completa, el teleprompter sale como un recuadro negro (sin texto). Si grabas solo una app o con la cámara, no aparece en absoluto.',
      modeInvisible: 'Grabar con la cámara',
      modeInvisibleDesc: 'Abre la cámara o Loom en modo solo cámara y lee el guion flotante encima. La cámara graba tu cara, no la pantalla: el guion nunca sale.',
      modeWindow: 'Grabar solo una app',
      modeWindowDesc: 'Al grabar la pantalla con Loom o con el grabador de Android, elige «Una sola app» y selecciona tu presentación (Android 14 o superior). El guion no aparece, ni siquiera tapado.',
      clickThroughDesc: 'Los toques atraviesan el teleprompter y llegan a la app de abajo (Loom, Slides, Canva…). Para volver a tocarlo, apágalo aquí o pulsa «Tocar guion» en la notificación.',
      shortcutsDesc: 'Con el teclado de la tablet, mientras GuionFlow está en pantalla.',
      rcStep1Desc: 'El teleprompter queda protegido contra grabaciones y capturas de pantalla.',
      rcStep3Desc: 'Usa exactamente la misma configuración que en tu video real (pantalla completa, una sola app o cámara).',
      pClickThroughOn: 'Toques atraviesan · apágalo en la notificación',
      recBlack: 'Grabación de pantalla completa: el guion sale tapado en negro. Para que no salga nada, elige «Una sola app» en Loom.',
      recVisible: '¡La grabación está viendo tu guion! Toca el escudo para protegerlo.',
    },
    en: {
      importHint: 'TXT, DOCX or MD',
      offline: 'Everything is stored on your tablet. No internet, no accounts.',
      protectionDesc: 'Android protects the script: no recording or screenshot can copy what it says. You still see it on your tablet.',
      protAndroid: 'Android {build}: protection on. If you record the full screen, the teleprompter shows as a black box (no text). If you record a single app or the camera, it does not appear at all.',
      modeInvisible: 'Record with the camera',
      modeInvisibleDesc: 'Open the camera or Loom in camera-only mode and read the floating script on top. The camera records your face, not the screen: the script never shows.',
      modeWindow: 'Record a single app',
      modeWindowDesc: 'When recording the screen with Loom or Android\'s recorder, choose "A single app" and pick your presentation (Android 14 or later). The script does not appear, not even covered.',
      clickThroughDesc: 'Touches pass through the teleprompter to the app below (Loom, Slides, Canva…). To touch it again, turn this off here or tap "Touch script" in the notification.',
      shortcutsDesc: 'With the tablet keyboard, while GuionFlow is on screen.',
      rcStep1Desc: 'The teleprompter is protected from recordings and screenshots.',
      rcStep3Desc: 'Use exactly the same setup as your real video (full screen, single app or camera).',
      pClickThroughOn: 'Touches pass through · turn off in the notification',
      recBlack: 'Full-screen recording: the script shows as a black box. To hide it completely, choose "A single app" in Loom.',
      recVisible: 'The recording can see your script! Tap the shield to protect it.',
    },
  };
  const base = window.i18n;
  const t = (key, params) => {
    const own = (TEXT[base.lang] || TEXT.es)[key];
    if (own === undefined) return base.t(key, params);
    let s = own;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(v);
    return s;
  };
  const apply = (root = document) => {
    base.apply(root);
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  };
  window.i18n = { t, apply, setLang(l) { base.setLang(l); apply(); }, get lang() { return base.lang; } };

  const isPrompter = !!document.getElementById('viewport');
  if (isPrompter) setupPrompter();
  else setupMain();

  // ---------- Teleprompter flotante ----------
  function setupPrompter() {
    // Arrastrar la barra superior mueve la ventana (lo hace Android con el dedo).
    document.querySelector('.bar.top').addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      N.dragStart();
    });

    // Modo compacto: sin mouse no hay "hover", así que un toque muestra las barras unos segundos.
    let revealTimer;
    document.addEventListener('pointerdown', () => {
      if (!document.body.classList.contains('compact')) return;
      document.body.classList.add('reveal');
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => document.body.classList.remove('reveal'), 4000);
    }, true);

    // Aviso cuando una grabación de pantalla está captando la tablet (Android 15+).
    const badge = document.createElement('div');
    badge.className = 'rec-badge';
    badge.hidden = true;
    document.getElementById('stage').append(badge);
    window.pf.on('recording', (r) => {
      badge.hidden = !r.captured;
      badge.classList.toggle('danger', !r.protected);
      badge.textContent = (r.protected ? '● ' : '⚠ ') + t(r.protected ? 'recBlack' : 'recVisible');
    });
  }

  // ---------- Editor ----------
  function setupMain() {
    // Atajos con el teclado de la tablet (los mismos que en Windows: Ctrl+Alt+letra).
    const KEYS = {
      p: 'countdown', i: 'toggle', arrowup: 'faster', arrowdown: 'slower', b: 'back',
      f: 'forward', n: 'nextSection', v: 'prevSection', x: 'clickThrough', h: 'hide',
    };
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || !e.altKey) return;
      const cmd = KEYS[e.key.toLowerCase()];
      if (!cmd) return;
      e.preventDefault();
      e.stopPropagation();
      window.pf.send('prompter:cmd', { cmd });
    }, true);
  }
})();

# PromptFlow — Teleprompter para presentar y grabar

**Descargar:** https://sparckys.github.io/promtflow/

Teleprompter de escritorio para Windows y Mac, pensado para grabar con Loom, presentar diapositivas y leer guiones sin que la audiencia lo vea. Interfaz en **español e inglés** (se cambia abajo a la izquierda, en *Idioma*).

## Instalar

| Sistema | Archivo | Cómo se obtiene |
|---|---|---|
| Windows | `dist/PromptFlow-Setup-1.0.0.exe` (instalador) | `npm run dist:win` |
| Windows | `dist/PromptFlow-Portable-1.0.0.exe` (sin instalar) | `npm run dist:win` |
| Mac | `dist/PromptFlow-1.0.0-mac.dmg` | En un Mac: `npm run dist:mac`, o con GitHub Actions (abajo) |

> Los instaladores aún no tienen firma digital. Windows mostrará "Windows protegió su PC" → *Más información* → *Ejecutar de todas formas*. En Mac: clic derecho sobre la app → *Abrir*.

### Compilar la versión de Mac sin tener un Mac

1. Sube esta carpeta a un repositorio de GitHub.
2. Ve a la pestaña **Actions** → **Build installers** → **Run workflow**.
3. Al terminar, descarga los artefactos `PromptFlow-macOS` (.dmg) y `PromptFlow-Windows` (.exe).

## Cómo se usa

1. Escribe o importa tu guion (TXT, DOCX, PDF o MD).
2. Pulsa **Abrir teleprompter**: aparece una ventana flotante siempre visible, encima de PowerPoint, Google Slides o Canva.
3. Arrástrala desde la barra superior, cámbiale el tamaño desde la esquina o usa **Ventana → Posición rápida** (*Junto a la cámara* la coloca arriba al centro).
4. Pulsa **INICIAR** para arrancar al instante, o el botón **3** (a su izquierda) para una cuenta atrás 3·2·1. El botón **—** minimiza el teleprompter.

### Formato del guion

| Escribe | Resultado |
|---|---|
| `[Diapositiva 1] Título` o `# Título` | Empieza una nueva diapositiva (puedes saltar a ella) |
| `[PAUSA]` | El teleprompter se detiene solo al llegar ahí |
| `[mirar a cámara]` | Indicación escénica, se muestra como etiqueta |
| `**texto**` | Énfasis en amarillo |

### Atajos globales (funcionan aunque estés en otra app)

| Windows | Mac | Acción |
|---|---|---|
| `Ctrl+Alt+P` | `⌘⌥P` | Iniciar con cuenta atrás 3·2·1 / pausar |
| `Ctrl+Alt+I` | `⌘⌥I` | Iniciar al instante / pausar |
| `Ctrl+Alt+↑ / ↓` | `⌘⌥↑ / ↓` | Más rápido / más lento |
| `Ctrl+Alt+B / F` | `⌘⌥B / F` | Retroceder / adelantar unas líneas |
| `Ctrl+Alt+N / V` | `⌘⌥N / V` | Siguiente / anterior diapositiva |
| `Ctrl+Alt+X` | `⌘⌥X` | Click-through (los clics atraviesan el teleprompter) |
| `Ctrl+Alt+H` | `⌘⌥H` | Mostrar / ocultar el teleprompter |

## Privacidad: que Loom no grabe el guion

- **Modo invisible** (*Privacidad → Invisible en la grabación*): en Windows 10 (2004+) y 11 usa `WDA_EXCLUDEFROMCAPTURE`. Tú ves el teleprompter; Loom, Zoom y Meet no lo ven.
- **Grabar solo la presentación**: en Loom elige *Ventana* y selecciona tu presentación. Es el método más seguro, también en Mac.
- **Doble monitor**: presentación en una pantalla, teleprompter en la otra.

**Antes de cada video importante haz el *Recording Check*** (pestaña Privacidad). En macOS algunas apps de grabación modernas ignoran la protección; ahí usa "grabar solo la presentación" o doble monitor.

## Control desde el celular

Pestaña **Celular** → activa el control remoto → escanea el código QR con el teléfono (misma red Wi-Fi). Desde ahí puedes pausar, retroceder, cambiar la velocidad y saltar a cualquier diapositiva. Si Windows pregunta por el firewall, permite el acceso en redes privadas.

## Desarrollo

```bash
npm install
npm start          # abre la app
npm run dist:win   # genera los .exe en dist/
npm run dist:mac   # genera el .dmg (solo en un Mac)
```

Los guiones y ajustes se guardan en un archivo local (`promptflow-data.json`, en la carpeta de datos del usuario). Sin internet y sin cuentas.

## Próximas versiones

- **V2**: perfiles de lectura, organización avanzada de proyectos, atajos personalizables.
- **V3**: seguimiento por voz (el texto avanza al ritmo de lo que dices), sincronización automática con PowerPoint.
- **V4**: firma digital, actualizaciones automáticas, licencias.

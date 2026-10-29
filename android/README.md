# GuionFlow para tablets Android

Descarga: https://github.com/Sparckys/promtflow/releases/download/android/GuionFlow-Android.apk

App nativa (Java, sin librerías de terceros) que reutiliza la interfaz de `desktop/src/renderer`:
la misma biblioteca, editor y teleprompter, con una capa táctil (`app/src/main/assets/android.*`).

- **Teleprompter flotante** encima de Loom, la cámara, Slides o Canva (permiso *Mostrar sobre otras apps*).
- **Invisible en la grabación**: la ventana lleva `FLAG_SECURE`. Grabación de pantalla completa → recuadro negro sin texto;
  grabación de *una sola app* (Android 14+) o con la cámara → no aparece. En Android 15+ avisa si una grabación lo está captando.
- Controles en la notificación (iniciar/pausar, ocultar, cerrar) y atajos `Ctrl+Alt+letra` con teclado.
- Sin permiso de Internet; la interfaz se sirve desde el APK y cualquier otra petición se bloquea.

Se compila y firma en GitHub Actions (`.github/workflows/android.yml`) con los secretos
`GF_KEYSTORE_B64` y `GF_KEYSTORE_PASSWORD`. En local: `gradle assembleDebug` dentro de `android/`.

"""Prueba real del APK en un emulador de tablet (la usa .github/workflows/android-test.yml).

Instala la app, abre el editor, abre el teleprompter flotante encima, lo pone a correr y guarda
capturas y el árbol de la interfaz en out/. Falla si la interfaz no carga o hay errores de JavaScript.
"""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PKG = 'com.guionflow.tablet'
OUT = 'out'


def adb(*args, check=True):
    r = subprocess.run(['adb', *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        print(r.stdout, r.stderr)
        raise SystemExit(f'adb {" ".join(args)} failed')
    return r.stdout


def shot(name):
    with open(f'{OUT}/{name}.png', 'wb') as f:
        f.write(subprocess.run(['adb', 'exec-out', 'screencap', '-p'], capture_output=True).stdout)


def dump(name):
    adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml', check=False)
    xml = adb('shell', 'cat', '/sdcard/ui.xml', check=False)
    with open(f'{OUT}/{name}.xml', 'w', encoding='utf-8') as f:
        f.write(xml)
    try:
        return ET.fromstring(xml[xml.index('<?xml'):] if '<?xml' in xml else xml)
    except Exception:
        return None


def find(root, pattern):
    if root is None:
        return None
    rx = re.compile(pattern, re.I)
    for n in root.iter('node'):
        if rx.search(n.get('text', '')) or rx.search(n.get('content-desc', '')):
            return n
    return None


def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def wait_for(pattern, name, secs=40):
    for _ in range(secs // 4):
        root = dump(name)
        n = find(root, pattern)
        if n is not None:
            return root, n
        time.sleep(4)
    raise SystemExit(f'No apareció "{pattern}" ({name})')


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    adb('install', '-r', sys.argv[1])
    adb('shell', 'appops', 'set', PKG, 'SYSTEM_ALERT_WINDOW', 'allow')
    adb('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS', check=False)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')

    root, btn = wait_for(r'^Abrir teleprompter$', '1-editor')
    print('Editor OK. Guion de ejemplo:', find(root, r'Guion de ejemplo') is not None)
    shot('1-editor-protegido')  # con la protección activa la captura debe salir negra

    tap(btn)
    root, start = wait_for(r'^INICIAR$', '2-teleprompter')
    print('Teleprompter flotante OK')
    shot('2-teleprompter-protegido')

    tap(start)
    time.sleep(5)
    shot('3-corriendo-protegido')

    # Quitar la protección desde el escudo del teleprompter para revisar cómo se ve.
    shield = find(dump('3-corriendo'), r'Oculto en grabaciones')
    if shield is not None:
        tap(shield)
        time.sleep(2)
        shot('4-corriendo-sin-proteccion')
        adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
        time.sleep(3)
        shot('5-encima-de-otra-app-sin-proteccion')
        shield = find(dump('5-home'), r'Visible en grabaciones')
        if shield is not None:
            tap(shield)
            time.sleep(2)
        shot('6-encima-de-otra-app-protegido')

    log = adb('logcat', '-d')
    with open(f'{OUT}/logcat.txt', 'w', encoding='utf-8') as f:
        f.write(log)
    errors = [l for l in log.splitlines() if 'Uncaught' in l or ('chromium' in l and 'ERROR:CONSOLE' in l)]
    crashes = [l for l in log.splitlines() if 'FATAL EXCEPTION' in l or ('AndroidRuntime' in l and PKG in l)]
    print('\n'.join(errors + crashes))
    if errors or crashes:
        raise SystemExit('Errores en la app')
    print('Prueba completa sin errores')


if __name__ == '__main__':
    main()

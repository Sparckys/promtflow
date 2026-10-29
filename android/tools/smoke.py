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
    try:
        run(os)
    finally:
        with open(f'{OUT}/logcat.txt', 'w', encoding='utf-8') as f:
            f.write(adb('logcat', '-d', check=False))


def run(os):
    os.makedirs(OUT, exist_ok=True)
    adb('install', '-r', sys.argv[1])
    adb('shell', 'appops', 'set', PKG, 'SYSTEM_ALERT_WINDOW', 'allow')
    adb('shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS', check=False)
    adb('logcat', '-c')
    adb('shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')

    root, btn = wait_for(r'^Abrir teleprompter$', '1-editor')
    print('Editor OK. Guion de ejemplo:', find(root, r'Guion de ejemplo') is not None)
    shot('0-editor-protegido')  # con la protección activa la captura sale vacía o negra

    # Quitar la protección (pestaña Privacidad) para poder ver la pantalla en las capturas.
    tap(find(root, r'^Privacidad$'))
    time.sleep(2)
    root = dump('1-privacidad')
    toggle = next((n for n in root.iter('node') if n.get('checkable') == 'true' and n.get('checked') == 'true'), None)
    if toggle is None:
        raise SystemExit('No encontré el interruptor de protección')
    tap(toggle)
    time.sleep(2)
    shot('1-editor-privacidad')

    tap(find(dump('1b'), r'^Abrir teleprompter$'))
    # La ventana flotante no aparece en el árbol de uiautomator: se comprueba por el estado que envía al editor.
    root, _ = wait_for(r'^Diapositiva 01 / 04', '2-teleprompter-abierto')
    print('Teleprompter flotante OK')
    shot('2-teleprompter')

    play = find(root, r'^Iniciar al instante / pausar$')
    print('Botón iniciar:', play.get('bounds'))
    tap(play)
    time.sleep(1.5)
    shot('3a-tras-iniciar')
    time.sleep(5)
    shot('3b-corriendo')
    root = dump('3-corriendo')
    playing = find(root, r'^En pausa$') is None
    print('Desplazamiento:', 'OK' if playing else 'NO ARRANCÓ')

    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    time.sleep(4)
    shot('4-encima-de-otra-app')
    print(adb('shell', 'dumpsys', 'window', 'windows', check=False).count('GuionFlow'), 'ventanas GuionFlow')
    if not playing:
        raise SystemExit('El teleprompter no arrancó')

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

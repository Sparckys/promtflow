// Control remoto desde el celular: servidor HTTP + WebSocket en la red local.
// La URL lleva una clave aleatoria para que nadie más en la red pueda controlarlo.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PREFERRED_PORT = 4545;
const key = crypto.randomBytes(6).toString('hex');

let server = null;
let wss = null;
let port = null;
let onCommand = () => {};
let lastStatus = null;

function localIp() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      // Evita adaptadores virtuales comunes (VirtualBox, WSL, VPN, Docker).
      const virtual = /virtual|vbox|vmware|wsl|docker|hyper-v|vethernet|tailscale|zerotier/i.test(name);
      candidates.push({ addr: a.address, score: (virtual ? 0 : 2) + (/^192\.168\./.test(a.address) ? 1 : 0) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.addr || '127.0.0.1';
}

function start(handler) {
  onCommand = handler;
  if (server) return Promise.resolve(info());

  const page = fs.readFileSync(path.join(__dirname, 'remote', 'remote.html'), 'utf8');

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/' && url.searchParams.get('k') === key) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page);
    } else {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acceso no autorizado. Escanea el código QR desde GuionFlow.\nUnauthorized. Scan the QR code from GuionFlow.');
    }
  });

  wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws' || url.searchParams.get('k') !== key) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (lastStatus) ws.send(JSON.stringify({ type: 'status', status: lastStatus }));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg && typeof msg.cmd === 'string') onCommand(msg.cmd, msg.arg);
        } catch { /* mensaje inválido: se ignora */ }
      });
    });
  });

  return new Promise((resolve, reject) => {
    const tryListen = (p) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p !== 0) tryListen(0); // puerto ocupado → uno libre
        else reject(err);
      });
      server.listen(p, '0.0.0.0', () => {
        port = server.address().port;
        resolve(info());
      });
    };
    tryListen(PREFERRED_PORT);
  });
}

function stop() {
  if (wss) { for (const c of wss.clients) c.terminate(); wss.close(); wss = null; }
  if (server) { server.close(); server = null; }
  port = null;
}

function info() {
  if (!server || !port) return { running: false };
  return { running: true, url: `http://${localIp()}:${port}/?k=${key}`, clients: wss ? wss.clients.size : 0 };
}

async function infoWithQr() {
  const i = info();
  if (!i.running) return i;
  i.qr = await QRCode.toDataURL(i.url, { margin: 3, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  return i;
}

function broadcast(status) {
  lastStatus = status;
  if (!wss) return;
  const msg = JSON.stringify({ type: 'status', status });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

module.exports = { start, stop, info: infoWithQr, broadcast };

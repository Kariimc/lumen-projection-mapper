// server.js — serves the phone controller page, media files, and runs the
// realtime WebSocket channel. Zero external HTTP framework: Node's http module
// is enough and keeps the dependency surface tiny.
// FIX APPLIED (see wargames/07-bugs.md): B4 — oversize uploads now get an
// explicit HTTP 413 response instead of a silent socket kill, so the phone's
// fetch() resolves instead of hanging forever.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const HTTP_PORT = 8090;
const WS_PORT = 8091;

// Packaged-app path fix (see blueprint §7.3): controller/ ships inside
// resources/ once electron-builder packages the app; in dev it's three
// directories up from this file.
const CONTROLLER_DIR = (process.resourcesPath && !process.defaultApp)
  ? path.join(process.resourcesPath, 'controller')
  : path.join(__dirname, '..', '..', '..', 'controller');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif' };

/** Find the PC's LAN IPv4 address (what goes in the QR code). */
function getLanIp() {
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    // S2 (wargame RECON): de-prioritize virtual/VPN adapters so the QR
    // doesn't point phones at an unreachable interface.
    if (/virtual|vethernet|wsl|vpn|loopback/i.test(name)) continue;
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  // fall back to any non-internal IPv4 if nothing matched the preferred list
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

/**
 * Start both servers.
 * @param {object} state    - the state store from state.js
 * @param {string} mediaDir - absolute path where uploads live
 * @param {function} onChange - called after any state mutation (main uses it
 *                              to refresh the output window and broadcast)
 * @param {object} [opts]   - { httpPort, wsPort, controllerDir } overrides for testing
 */
function startServers(state, mediaDir, onChange, opts = {}) {
  const httpPort = opts.httpPort || HTTP_PORT;
  const wsPort = opts.wsPort || WS_PORT;
  const controllerDir = opts.controllerDir || CONTROLLER_DIR;

  // ---------- HTTP: controller page, media files, uploads ----------
  const httpServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/media') {
      return handleUpload(req, res, mediaDir, state, onChange);
    }
    if (req.url.startsWith('/media/')) {
      const file = path.join(mediaDir, path.basename(req.url)); // basename() blocks path traversal
      return streamFile(file, req, res);
    }
    // everything else: serve the controller SPA
    const rel = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
    const file = path.normalize(path.join(controllerDir, rel));
    if (!file.startsWith(controllerDir)) { res.writeHead(403); return res.end(); }
    streamFile(file, req, res);
  });
  httpServer.listen(httpPort);

  // ---------- WebSocket: realtime control ----------
  const wss = new WebSocketServer({ port: wsPort });
  const broadcast = (obj) => {
    const msg = JSON.stringify(obj);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };

  wss.on('connection', (sock) => {
    sock.send(JSON.stringify({ type: 'state', ...state.snapshot() }));

    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; } // ignore garbage
      const changed = state.apply(msg);                 // state.js does validation
      if (!changed) return;
      if (msg.type === 'corner.move') {
        // hot path: tiny echo, full state only on drag end isn't needed —
        // corner.moved keeps other phones live at 60fps cheaply
        broadcast({ type: 'corner.moved', surfaceId: msg.surfaceId,
                    corner: msg.corner, x: msg.x, y: msg.y });
      } else {
        broadcast({ type: 'state', ...state.snapshot() });
      }
      onChange(msg);
    });
  });

  return { lanIp: getLanIp(), httpPort, wsPort, broadcast, httpServer, wss };
}

function streamFile(file, req, res) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // Range support so <video> can seek
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = parseInt(s, 10), end = e ? parseInt(e, 10) : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    }
  });
}

const MAX_UPLOAD = 500 * 1024 * 1024; // 500 MB

/** Minimal multipart parser for a single file field. */
function handleUpload(req, res, mediaDir, state, onChange) {
  const boundary = (req.headers['content-type'] || '').split('boundary=')[1];
  if (!boundary) { res.writeHead(400); return res.end(); }
  const chunks = [];
  let size = 0;
  let responded = false;

  const fail = (code, msg) => {
    if (responded) return;
    responded = true;
    req.removeAllListeners('data');
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
    req.destroy();
  };

  req.on('data', (c) => {
    size += c.length;
    // B4 FIX: respond with 413 immediately instead of silently destroying
    // the socket with no reply — the old behavior hung the phone's fetch().
    if (size > MAX_UPLOAD) return fail(413, 'File is too large (max 500 MB).');
    chunks.push(c);
  });
  req.on('error', () => { responded = true; }); // swallow post-destroy errors
  req.on('end', () => {
    if (responded) return;
    const body = Buffer.concat(chunks);
    const marker = Buffer.from('--' + boundary);
    const headerEnd = body.indexOf('\r\n\r\n');
    if (headerEnd === -1) return fail(400, 'Malformed upload.');
    const header = body.slice(0, headerEnd).toString();
    const nameMatch = header.match(/filename="([^"]+)"/);
    if (!nameMatch) return fail(400, 'No file field found.');
    const safeName = nameMatch[1].replace(/[^\w.\-]/g, '_');
    const fileStart = headerEnd + 4;
    const fileEnd = body.indexOf(marker, fileStart) - 2; // strip trailing \r\n
    const ext = path.extname(safeName).toLowerCase();
    if (!['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      return fail(415, 'Unsupported file type. Use a video (mp4/webm) or image (jpg/png/gif).');
    }
    const id = 'm_' + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(path.join(mediaDir, id + ext), body.slice(fileStart, fileEnd));
    const kind = ['.mp4', '.webm'].includes(ext) ? 'video' : 'image';
    state.addMedia({ id, name: safeName, file: id + ext, kind });
    responded = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, name: safeName, kind }));
    onChange({ type: 'media.added' });
  });
}

module.exports = { startServers, getLanIp };

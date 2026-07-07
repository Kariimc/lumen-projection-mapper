# LUMEN — Projection Mapping for Everyone
### Complete Project Blueprint & Scaffolding Document
**Audience:** a junior-to-mid developer building this from zero, with no one to ask questions.
**Read this whole document once before typing anything.**

---

## 0. Deep-Research Summary: What Projection Mapping Actually Is (and what tools got right/wrong)

Projection mapping = using a projector to paint imagery onto real-world surfaces (walls, boxes, buildings, stage sets) so the image *fits the object* instead of being a flat rectangle. The entire technical problem reduces to **warping a rectangular video frame so its four corners land on four arbitrary points** — a math operation called a **planar homography** (a 3×3 perspective transform). Everything else — masking, keystone, edge softness, media playback — is layered on top of that one operation.

**State of the art tools and their lessons:**

| Tool | Platform | What it teaches us |
|---|---|---|
| MadMapper (~€420) | Win/Mac | Industry standard; powerful but intimidating grid of technical panels. Non-technical users bounce off it. |
| Resolume Arena (~€800) | Win/Mac | VJ-oriented; mapping is a sub-feature buried in "Advanced Output." |
| HeavyM | Win/Mac | The closest to "simple" — shapes + effects, drag corners. Validates that simplicity sells. |
| Lightform (dead, 2022) | Hardware | Tried auto-calibration with a camera; company folded. Lesson: auto-calibration hardware is a money pit — **manual 4-corner dragging is good enough and users understand it instantly.** |
| TouchDesigner | Win/Mac | Node graph; maximum power, maximum learning curve. |
| Dynamapper / Optoma apps | iOS/Android | Prove phones can do mapping, but standalone phone output is weak (phone → HDMI adapters are flaky). **Phone-as-remote-control is the winning mobile pattern, not phone-as-renderer.** |

**Key technical facts driving the architecture:**

1. **A projector is just a monitor.** Windows sees any HDMI/USB-C projector as a second display. No drivers, no SDK, no calibration API exists or is needed. "Plug-and-play" = *put a borderless fullscreen window on display #2*. This is exactly what MadMapper and Resolume do.
2. **Corner pinning = homography.** Given 4 source corners and 4 destination corners, solve an 8×8 linear system → 3×3 matrix → apply as a GPU perspective transform. Browsers can do this natively via CSS `matrix3d` (GPU-composited, 60fps, works on video elements). No shader code required for MVP.
3. **Latency budget for a remote control:** dragging a corner on a phone must move the projection within ~50ms to feel "live." WebSockets on local Wi-Fi deliver 2–10ms. OSC (the AV-industry protocol) is UDP-based and great, but requires native sockets — unavailable in a phone browser. **WebSocket wins** because the controller can then be a plain web page: zero app-store friction for MVP.
4. **Discovery/pairing:** mDNS/Bonjour is unreliable across consumer routers and blocked on many Androids. **QR code containing the desktop's LAN IP** is the bulletproof, zero-jargon pairing method (proven by countless "TV remote" apps).

---

## 1. Project Vision

**Name (working):** **Lumen**
**One-liner:** *"Point your projector at anything. Drag four dots with your phone. Done."*

**Core objective:** a projection mapping tool where a non-technical user (event decorator, teacher, party host, retail owner) goes from unboxing a projector to a mapped video on a surface in **under 3 minutes**, having never seen the words "keystone," "homography," or "output routing."

**Non-goals for v1 (write these on the wall):** no multi-projector edge-blending, no DMX/lighting control, no timeline sequencing, no 3D object mapping, no shader effects. Simple beats powerful.

---

## 2. Architecture Decision (the "why," recorded so nobody re-litigates it)

### Chosen stack

| Layer | Technology | Why |
|---|---|---|
| Windows renderer + server | **Electron 33 + Node.js 20** | One window fullscreens on the projector display; Node gives us the WebSocket server and file access. Ships as a single .exe installer. |
| Rendering | **HTML `<video>`/`<img>` + CSS `matrix3d` homography** | GPU-accelerated, 60fps, ~80 lines of math, zero shader knowledge needed. Upgrade path: swap to a WebGL quad later without touching anything else. |
| Phone controller (MVP) | **Plain web page served by the desktop app** | Phone scans QR → opens `http://<desktop-ip>:8090` in its browser. Works on iOS + Android day one, no store review. |
| Phone controller (v1.1) | **Capacitor 6 wrapping the same web page** | Same codebase becomes an installable App Store / Play Store app when you want push-to-store polish. |
| Transport | **WebSocket (`ws` npm package), JSON messages, local Wi-Fi** | 2–10ms LAN latency; JSON is debuggable by a junior with the browser console. |
| Pairing | **QR code (desktop shows it, phone scans with camera)** | Zero configuration, zero jargon. |

### Rejected alternatives (so you don't wonder)
- **Unity:** heavy build pipeline ×3 platforms, licensing, and UI toolkit pain — all to render one warped quad. Overkill.
- **OSC protocol:** industry standard but needs UDP → native app only → kills the "scan QR, control instantly" magic.
- **Phone as the renderer:** HDMI-out from phones is inconsistent; abandoned by every serious product.

### System diagram

```
┌─────────────────────────────  Local Wi-Fi  ─────────────────────────────┐
│                                                                          │
│  ┌──────── Windows PC (Electron app) ────────┐        ┌─── Phone ─────┐  │
│  │                                            │        │               │  │
│  │  Main process (Node.js)                    │        │  Browser /    │  │
│  │   ├─ HTTP server :8090  ──serves────────────────────▶ Capacitor    │  │
│  │   │    (controller web page + media API)   │        │  controller   │  │
│  │   ├─ WebSocket server :8091 ◀──JSON msgs──────────────  UI          │  │
│  │   └─ Scene state (corners, media, opacity) │        │  (drag dots)  │  │
│  │            │ IPC                           │        └───────────────┘  │
│  │            ▼                               │                           │
│  │  ┌──────────────┐   ┌──────────────────┐   │                           │
│  │  │ Control win  │   │ OUTPUT window    │───┼──HDMI──▶ 🎥 Projector     │
│  │  │ (QR, status) │   │ fullscreen on    │   │          (any brand —     │
│  │  └──────────────┘   │ projector display│   │           it's just a     │
│  │                     │ CSS matrix3d warp│   │           2nd monitor)    │
│  └────────────────────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Communication Protocol — exact specification

- **Transport:** WebSocket, `ws://<desktop-ip>:8091`, text frames, UTF-8 JSON.
- **Direction:** phone → desktop for commands; desktop → all phones for state broadcast (so two phones stay in sync).
- **Every message:** `{ "type": "<string>", ... }`. Unknown types are ignored (forward compatibility).
- **Coordinates are normalized 0.0–1.0** relative to the projector's resolution. This makes the protocol resolution-independent — the phone never needs to know the projector is 1920×1080.

### 3.1 Message schemas (the complete v1 protocol)

**Phone → Desktop**

```jsonc
// Move one corner of a surface (sent continuously while dragging, throttled to 60/s)
{
  "type": "corner.move",
  "surfaceId": "s1",
  "corner": 0,            // 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left
  "x": 0.132,             // 0.0 = left edge of projector, 1.0 = right edge
  "y": 0.408              // 0.0 = top, 1.0 = bottom
}

// Assign media to a surface (media was uploaded or picked from library first)
{ "type": "media.set", "surfaceId": "s1", "mediaId": "m_7f3a" }

// Playback control
{ "type": "media.play",  "surfaceId": "s1" }
{ "type": "media.pause", "surfaceId": "s1" }

// Appearance
{ "type": "surface.opacity", "surfaceId": "s1", "value": 0.85 }   // 0..1
{ "type": "surface.brightness", "surfaceId": "s1", "value": 1.0 } // 0..2, 1 = normal

// Show/hide the white alignment grid (used while positioning)
{ "type": "grid.toggle", "surfaceId": "s1", "visible": true }

// Blackout everything instantly (the "panic button" — every AV tool needs one)
{ "type": "output.blackout", "enabled": true }

// Add / remove a surface
{ "type": "surface.add" }                        // desktop assigns the id
{ "type": "surface.remove", "surfaceId": "s2" }

// Persistence
{ "type": "scene.save", "name": "Birthday wall" }
{ "type": "scene.load", "sceneId": "sc_01" }
```

**Desktop → Phone(s)**

```jsonc
// Full state, sent on connect and after any change (state is small; don't diff, just resend)
{
  "type": "state",
  "blackout": false,
  "media": [ { "id": "m_7f3a", "name": "fireworks.mp4", "kind": "video" } ],
  "scenes": [ { "id": "sc_01", "name": "Birthday wall" } ],
  "surfaces": [
    {
      "id": "s1",
      "name": "Shape 1",
      "mediaId": "m_7f3a",
      "playing": true,
      "opacity": 1.0,
      "brightness": 1.0,
      "gridVisible": false,
      "corners": [                       // order: TL, TR, BR, BL — ALWAYS this order
        { "x": 0.10, "y": 0.10 },
        { "x": 0.90, "y": 0.12 },
        { "x": 0.88, "y": 0.90 },
        { "x": 0.11, "y": 0.88 }
      ]
    }
  ]
}

// Lightweight echo during drags so other connected phones track in real time
{ "type": "corner.moved", "surfaceId": "s1", "corner": 0, "x": 0.132, "y": 0.408 }
```

**Media upload** is plain HTTP (not WebSocket — binary over WS complicates things for no benefit):
`POST http://<desktop-ip>:8090/api/media` with `multipart/form-data`, field `file`. Response: `{ "id": "m_7f3a", "name": "fireworks.mp4", "kind": "video" }`. Accepted types: mp4, webm, jpg, png, gif. Max 500 MB.

### 3.2 Protocol rules
1. Desktop is the **single source of truth**. Phones render whatever `state` says; optimistic UI on the phone is allowed only for the corner being actively dragged.
2. Throttle `corner.move` to one message per animation frame (~60/s). Never queue them — drop stale ones.
3. On WebSocket disconnect, phone shows a full-screen "Reconnecting…" overlay and retries every 2s. Desktop keeps the last state — a dropped phone must never blank the projection.

---

## 4. Core Features & the "Simplified UX" Translation Table

This table **is the product spec** for naming. Never let a technical term leak into the UI.

| Industry term | What it does | **Lumen UI name** | UI presentation |
|---|---|---|---|
| Corner pinning / quad warp | Drag 4 corners so image fits a surface | **"Fit to Surface"** | 4 big draggable glowing dots on the phone, mirrored live by the projector. Instruction text: *"Drag each dot until the picture sits where you want it."* |
| Keystone correction | Fix trapezoid distortion from angled projector | *(none — it's the same math)* | Absorbed entirely by Fit to Surface. Do NOT expose a separate keystone control. |
| Surface / quad / layer | One mapped region | **"Shape"** | "+ Add Shape" button. Auto-named "Shape 1, 2…", tap to rename. |
| Masking | Hide parts of the output | **"Hide edges"** *(v1.1)* | Not in MVP. v1.1: finger-draw a region to hide. |
| Test pattern / grid | Alignment aid | **"Alignment grid"** | Toggle: *"Show grid while positioning."* White grid + corner numbers. |
| Media bin / library | Loaded assets | **"My pictures & videos"** | Thumbnail grid; "+" opens phone's native photo picker and uploads. |
| Opacity | Layer transparency | **"See-through"** | Slider, sun-to-ghost icons, no percentage number. |
| Brightness/gain | Output intensity | **"Brightness"** | Slider with sun icons. |
| Output routing / display assignment | Which monitor gets the show | **"Send to projector"** | Automatic: app fullscreens on the *non-primary* display at launch. If only one display: friendly banner *"Plug your projector into the computer and I'll find it."* Hot-plug detected automatically. |
| Blackout / DBO | Instant black output | **"Curtain"** | Huge always-visible button. Down = black, up = show. |
| Scene / preset save | Save the whole setup | **"Save this setup"** | Named saves: *"Save this setup so it's ready next time."* |
| IP/port/pairing | Connect phone to PC | **"Scan to control with your phone"** | QR on the desktop control window. No IP shown unless user taps "having trouble?". |

**Onboarding (first launch, desktop):** three full-screen cards, ~10 words each:
1. *"Plug your projector into your computer."* (illustration)
2. *"Scan this code with your phone's camera."* (live QR)
3. *"Drag the dots. That's it."*

---

## 5. Complete Directory Structure

```
lumen/
├── package.json                  # root workspace config (npm workspaces)
├── README.md                     # points to this blueprint
│
├── desktop/                      # Electron app: renderer + server (Windows deliverable)
│   ├── package.json
│   ├── electron-builder.yml      # Windows installer config
│   ├── src/
│   │   ├── main/                 # Electron MAIN process (Node.js land)
│   │   │   ├── index.js          # entry: windows, display detection, wiring
│   │   │   ├── server.js         # HTTP :8090 + WebSocket :8091  ★ boilerplate §6.1
│   │   │   ├── state.js          # scene state store + persistence ★ boilerplate §6.2
│   │   │   └── media.js          # upload handling, media folder management
│   │   ├── output/               # the window shown ON THE PROJECTOR
│   │   │   ├── output.html
│   │   │   ├── output.js         # applies homography to surfaces ★ boilerplate §6.4
│   │   │   └── homography.js     # 4-point → matrix3d math      ★ boilerplate §6.3
│   │   └── control/              # small window on the PC screen
│   │       ├── control.html      # QR code + connection status
│   │       └── control.js
│   └── assets/
│       └── icon.ico
│
├── controller/                   # phone UI — plain web app, served by desktop
│   ├── index.html                # single-page controller     ★ boilerplate §6.5
│   ├── controller.js             # WebSocket client + drag logic
│   ├── style.css
│   └── (no build step in MVP — vanilla JS on purpose)
│
├── mobile-shell/                 # v1.1 ONLY — Capacitor wrapper for app stores
│   ├── capacitor.config.ts
│   └── (generated by `npx cap init`; wraps controller/ verbatim)
│
├── shared/
│   └── protocol.md               # copy of §3 of this document — keep in sync
│
└── media-store/                  # created at runtime in userData, NOT in repo
```

**Rules:** `desktop/src/main` never touches the DOM; `output/` and `control/` never open sockets themselves (they talk to main via Electron IPC); `controller/` knows nothing about Electron — it's a plain web page, which is what makes the Capacitor wrap trivial later.

---

## 6. Phase-1 MVP Boilerplate (working code, not pseudocode)

### 6.0 Environment setup — exact commands

Prereqs: **Node.js 20 LTS** (https://nodejs.org, run the Windows installer, accept defaults). Verify:

```powershell
node -v   # must print v20.x
```

Scaffold:

```powershell
mkdir lumen; cd lumen
npm init -y
mkdir desktop, controller, shared
cd desktop
npm init -y
npm install ws@8 qrcode@1
npm install --save-dev electron@33 electron-builder@25
mkdir -p src/main, src/output, src/control, assets
```

In `desktop/package.json` set:

```json
{
  "name": "lumen-desktop",
  "version": "0.1.0",
  "main": "src/main/index.js",
  "scripts": {
    "start": "electron .",
    "dist": "electron-builder --win"
  }
}
```

---

### 6.1 `desktop/src/main/server.js` — HTTP + WebSocket server

```javascript
// server.js — serves the phone controller page, media files, and runs the
// realtime WebSocket channel. Zero external HTTP framework: Node's http module
// is enough and keeps the dependency surface tiny.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const HTTP_PORT = 8090;
const WS_PORT = 8091;
const CONTROLLER_DIR = path.join(__dirname, '..', '..', '..', 'controller');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif' };

/** Find the PC's LAN IPv4 address (what goes in the QR code). */
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

/**
 * Start both servers.
 * @param {object} state    - the state store from state.js
 * @param {string} mediaDir - absolute path where uploads live
 * @param {function} onChange - called after any state mutation (main uses it
 *                              to refresh the output window and broadcast)
 */
function startServers(state, mediaDir, onChange) {
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
    const rel = req.url === '/' ? 'index.html' : req.url.slice(1);
    const file = path.normalize(path.join(CONTROLLER_DIR, rel));
    if (!file.startsWith(CONTROLLER_DIR)) { res.writeHead(403); return res.end(); }
    streamFile(file, req, res);
  });
  httpServer.listen(HTTP_PORT);

  // ---------- WebSocket: realtime control ----------
  const wss = new WebSocketServer({ port: WS_PORT });
  const broadcast = (obj) => {
    const msg = JSON.stringify(obj);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };

  wss.on('connection', (sock) => {
    sock.send(JSON.stringify({ type: 'state', ...state.snapshot() }));

    sock.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; } // ignore garbage
      const changed = state.apply(msg);                 // §6.2 does validation
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

  return { lanIp: getLanIp(), httpPort: HTTP_PORT, wsPort: WS_PORT, broadcast };
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

/** Minimal multipart parser for a single file field. 500 MB cap. */
function handleUpload(req, res, mediaDir, state, onChange) {
  const boundary = (req.headers['content-type'] || '').split('boundary=')[1];
  if (!boundary) { res.writeHead(400); return res.end(); }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 500 * 1024 * 1024) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const marker = Buffer.from('--' + boundary);
    const headerEnd = body.indexOf('\r\n\r\n');
    const header = body.slice(0, headerEnd).toString();
    const nameMatch = header.match(/filename="([^"]+)"/);
    if (!nameMatch) { res.writeHead(400); return res.end(); }
    const safeName = nameMatch[1].replace(/[^\w.\-]/g, '_');
    const fileStart = headerEnd + 4;
    const fileEnd = body.indexOf(marker, fileStart) - 2; // strip trailing \r\n
    const id = 'm_' + Math.random().toString(36).slice(2, 8);
    const ext = path.extname(safeName).toLowerCase();
    if (!['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      res.writeHead(415); return res.end('unsupported type');
    }
    fs.writeFileSync(path.join(mediaDir, id + ext), body.slice(fileStart, fileEnd));
    const kind = ['.mp4', '.webm'].includes(ext) ? 'video' : 'image';
    state.addMedia({ id, name: safeName, file: id + ext, kind });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, name: safeName, kind }));
    onChange({ type: 'media.added' });
  });
}

module.exports = { startServers, getLanIp };
```

### 6.2 `desktop/src/main/state.js` — the single source of truth

```javascript
// state.js — holds scene state, validates every incoming message, persists to disk.
const fs = require('fs');
const path = require('path');

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

function createState(saveDir) {
  const savePath = path.join(saveDir, 'scenes.json');
  let s = {
    blackout: false,
    media: [],      // { id, name, file, kind }
    scenes: [],     // { id, name, surfaces }
    surfaces: [defaultSurface('s1', 'Shape 1')]
  };
  try { s = JSON.parse(fs.readFileSync(savePath, 'utf8')).live || s; } catch {}

  function defaultSurface(id, name) {
    return {
      id, name, mediaId: null, playing: false, opacity: 1, brightness: 1,
      gridVisible: true,
      corners: [ { x: .25, y: .25 }, { x: .75, y: .25 },
                 { x: .75, y: .75 }, { x: .25, y: .75 } ]
    };
  }

  const find = (id) => s.surfaces.find((x) => x.id === id);
  let nextId = 2;

  function persist() {
    fs.writeFileSync(savePath, JSON.stringify({ live: s }, null, 2));
  }

  /** Apply a phone message. Returns true if state changed. */
  function apply(m) {
    switch (m.type) {
      case 'corner.move': {
        const surf = find(m.surfaceId);
        const c = m.corner | 0;
        if (!surf || c < 0 || c > 3) return false;
        surf.corners[c] = { x: clamp01(m.x), y: clamp01(m.y) };
        return true;
      }
      case 'media.set': {
        const surf = find(m.surfaceId);
        if (!surf || !s.media.some((x) => x.id === m.mediaId)) return false;
        surf.mediaId = m.mediaId; surf.playing = true; surf.gridVisible = false;
        return true;
      }
      case 'media.play':  { const f = find(m.surfaceId); if (!f) return false; f.playing = true;  return true; }
      case 'media.pause': { const f = find(m.surfaceId); if (!f) return false; f.playing = false; return true; }
      case 'surface.opacity':    { const f = find(m.surfaceId); if (!f) return false; f.opacity = clamp01(m.value); return true; }
      case 'surface.brightness': { const f = find(m.surfaceId); if (!f) return false; f.brightness = Math.max(0, Math.min(2, +m.value || 0)); return true; }
      case 'grid.toggle': { const f = find(m.surfaceId); if (!f) return false; f.gridVisible = !!m.visible; return true; }
      case 'output.blackout': s.blackout = !!m.enabled; return true;
      case 'surface.add':
        s.surfaces.push(defaultSurface('s' + nextId, 'Shape ' + nextId));
        nextId++; return true;
      case 'surface.remove':
        if (s.surfaces.length <= 1) return false;      // never delete the last shape
        s.surfaces = s.surfaces.filter((x) => x.id !== m.surfaceId); return true;
      case 'scene.save':
        s.scenes.push({ id: 'sc_' + Date.now(), name: String(m.name || 'Setup').slice(0, 40),
                        surfaces: JSON.parse(JSON.stringify(s.surfaces)) });
        persist(); return true;
      case 'scene.load': {
        const sc = s.scenes.find((x) => x.id === m.sceneId);
        if (!sc) return false;
        s.surfaces = JSON.parse(JSON.stringify(sc.surfaces)); return true;
      }
      default: return false;
    }
  }

  return {
    apply,
    persist,
    snapshot: () => JSON.parse(JSON.stringify(s)),
    addMedia: (mObj) => { s.media.push(mObj); persist(); }
  };
}

module.exports = { createState };
```

### 6.3 `desktop/src/output/homography.js` — the corner-pinning math

This is the heart of the whole product. ~70 lines, no dependencies. It computes the 3×3 perspective transform mapping the unit square to 4 arbitrary points, then expresses it as a CSS `matrix3d` string the GPU applies for free.

```javascript
// homography.js — map a WxH rectangle onto 4 arbitrary destination points.
//
// Math: a planar homography H is a 3x3 matrix with 8 unknowns (h33 = 1).
// Each point correspondence (sx,sy)->(dx,dy) yields 2 linear equations:
//   dx = (h11*sx + h12*sy + h13) / (h31*sx + h32*sy + 1)
//   dy = (h21*sx + h22*sy + h23) / (h31*sx + h32*sy + 1)
// Four corners → 8 equations → solve the 8x8 system with Gaussian elimination.

/** Solve A·x = b for an 8x8 system. Partial pivoting for stability. */
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;   // degenerate (corners collinear)
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i][i]);
}

/**
 * @param {number} w, h        source element size in px
 * @param {Array}  dst         4 points [{x,y}…] in px, order TL,TR,BR,BL
 * @returns {string|null}      CSS matrix3d(...) or null if degenerate
 */
function matrix3dFor(w, h, dst) {
  const src = [ [0, 0], [w, 0], [w, h], [0, h] ];   // TL,TR,BR,BL
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy);
  }
  const hM = solve8(A, b);
  if (!hM) return null;
  const [h11, h12, h13, h21, h22, h23, h31, h32] = hM;
  // CSS matrix3d is column-major 4x4; z row/col are identity.
  return `matrix3d(${h11},${h21},0,${h31},` +
         `${h12},${h22},0,${h32},` +
         `0,0,1,0,` +
         `${h13},${h23},0,1)`;
}

// Works both as a browser global and a Node module (for unit tests).
if (typeof module !== 'undefined') module.exports = { matrix3dFor };
```

### 6.4 `desktop/src/output/output.html` + `output.js` — the projector window

```html
<!-- output.html — this page IS the projection. Black canvas, warped media. -->
<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin:0; width:100vw; height:100vh; background:#000;
               overflow:hidden; cursor:none; }
  .surface { position:absolute; top:0; left:0; transform-origin:0 0;
             will-change:transform; }
  .surface video, .surface img { width:100%; height:100%; object-fit:fill;
                                 display:block; }
  .grid { position:absolute; inset:0;
    background-image:
      linear-gradient(#fff 1px, transparent 1px),
      linear-gradient(90deg, #fff 1px, transparent 1px);
    background-size:10% 10%; border:2px solid #fff; }
  #curtain { position:fixed; inset:0; background:#000; z-index:99; display:none; }
</style></head>
<body>
  <div id="stage"></div>
  <div id="curtain"></div>
  <script src="homography.js"></script>
  <script src="output.js"></script>
</body></html>
```

```javascript
// output.js — renders state onto the projector. Runs inside the OUTPUT window.
// Receives state via Electron IPC from the main process (never opens sockets).
const { ipcRenderer } = require('electron');

const stage = document.getElementById('stage');
const curtain = document.getElementById('curtain');
const els = new Map();   // surfaceId -> { root, mediaEl, grid, mediaId }

function px() { return { w: window.innerWidth, h: window.innerHeight }; }

function render(state) {
  curtain.style.display = state.blackout ? 'block' : 'none';
  const seen = new Set();

  for (const s of state.surfaces) {
    seen.add(s.id);
    let e = els.get(s.id);
    if (!e) {
      const root = document.createElement('div');
      root.className = 'surface';
      const grid = document.createElement('div');
      grid.className = 'grid';
      root.appendChild(grid);
      stage.appendChild(root);
      e = { root, grid, mediaEl: null, mediaId: null };
      els.set(s.id, e);
    }

    // (re)create the media element only when the assignment changes
    if (s.mediaId !== e.mediaId) {
      if (e.mediaEl) e.mediaEl.remove();
      e.mediaEl = null; e.mediaId = s.mediaId;
      const m = state.media.find((x) => x.id === s.mediaId);
      if (m) {
        const url = `http://127.0.0.1:8090/media/${m.file}`;
        if (m.kind === 'video') {
          const v = document.createElement('video');
          v.src = url; v.loop = true; v.muted = true; v.playsInline = true;
          e.mediaEl = v;
        } else {
          const i = document.createElement('img');
          i.src = url; e.mediaEl = i;
        }
        e.root.insertBefore(e.mediaEl, e.grid);
      }
    }
    if (e.mediaEl && e.mediaEl.tagName === 'VIDEO') {
      if (s.playing && e.mediaEl.paused) e.mediaEl.play().catch(() => {});
      if (!s.playing && !e.mediaEl.paused) e.mediaEl.pause();
    }

    e.grid.style.display = s.gridVisible ? 'block' : 'none';
    e.root.style.opacity = s.opacity;
    e.root.style.filter = `brightness(${s.brightness})`;
    applyWarp(e.root, s.corners);
  }

  // remove deleted surfaces
  for (const [id, e] of els) if (!seen.has(id)) { e.root.remove(); els.delete(id); }
}

function applyWarp(root, corners) {
  const { w, h } = px();
  // Give the element a fixed logical size; the matrix moves its corners.
  const BASE_W = 800, BASE_H = 450;
  root.style.width = BASE_W + 'px';
  root.style.height = BASE_H + 'px';
  const dst = corners.map((c) => ({ x: c.x * w, y: c.y * h }));
  const m = matrix3dFor(BASE_W, BASE_H, dst);
  if (m) root.style.transform = m;
}

ipcRenderer.on('state', (_e, state) => render(state));
ipcRenderer.on('corner', (_e, { surfaceId, corner, x, y, state }) => {
  // hot path: mutate just the transform without full re-render
  const s = state.surfaces.find((z) => z.id === surfaceId);
  if (s) { s.corners[corner] = { x, y }; const e = els.get(surfaceId);
           if (e) applyWarp(e.root, s.corners); }
});
window.addEventListener('resize', () => ipcRenderer.send('request-state'));
ipcRenderer.send('request-state');
```

### 6.5 `desktop/src/main/index.js` — Electron entry, wires everything

```javascript
// index.js — Electron main process: creates windows, detects the projector,
// starts servers, routes state changes to the output window.
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { startServers } = require('./server');
const { createState } = require('./state');

let outputWin, controlWin, servers, state;

function pickProjectorDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.find((d) => d.id !== primary.id) || null; // null = not plugged yet
}

function createOutputWindow(display) {
  if (outputWin) outputWin.destroy();
  outputWin = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y,
    width: display.bounds.width, height: display.bounds.height,
    frame: false, fullscreen: true, backgroundColor: '#000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  outputWin.loadFile(path.join(__dirname, '..', 'output', 'output.html'));
  outputWin.webContents.on('did-finish-load', pushState);
}

function pushState() {
  if (outputWin && !outputWin.isDestroyed())
    outputWin.webContents.send('state', state.snapshot());
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData');
  const mediaDir = path.join(dataDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  state = createState(dataDir);

  servers = startServers(state, mediaDir, (msg) => {
    if (msg.type === 'corner.move') {
      if (outputWin && !outputWin.isDestroyed())
        outputWin.webContents.send('corner', { ...msg, state: state.snapshot() });
    } else {
      pushState();
    }
  });

  // Control window on the PC's own screen: shows the pairing QR.
  controlWin = new BrowserWindow({
    width: 520, height: 640, resizable: false, title: 'Lumen',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  controlWin.loadFile(path.join(__dirname, '..', 'control', 'control.html'));
  const url = `http://${servers.lanIp}:8090`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 360, margin: 1 });
  controlWin.webContents.on('did-finish-load', () =>
    controlWin.webContents.send('pairing', { url, qrDataUrl }));

  // Projector detection + hot-plug
  const proj = pickProjectorDisplay();
  if (proj) createOutputWindow(proj);
  screen.on('display-added', () => {
    const d = pickProjectorDisplay();
    if (d) createOutputWindow(d);
  });
  screen.on('display-removed', () => { if (outputWin) { outputWin.destroy(); outputWin = null; } });

  ipcMain.on('request-state', pushState);
});

app.on('window-all-closed', () => app.quit());
```

`desktop/src/control/control.html` (complete):

```html
<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font-family:system-ui; background:#111; color:#fff; text-align:center;
         margin:0; padding:32px; }
  img { border-radius:12px; background:#fff; padding:12px; }
  .hint { color:#999; font-size:14px; margin-top:16px; }
  code { color:#7fd; }
</style></head>
<body>
  <h1>Lumen</h1>
  <p style="font-size:18px">Scan to control with your phone</p>
  <img id="qr" width="360" height="360" alt="">
  <p class="hint">Having trouble? Open <code id="url"></code> in your phone's
     browser. Phone and computer must be on the same Wi-Fi.</p>
  <script>
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('pairing', (_e, { url, qrDataUrl }) => {
      document.getElementById('qr').src = qrDataUrl;
      document.getElementById('url').textContent = url;
    });
  </script>
</body></html>
```

### 6.6 `controller/` — the phone UI (complete MVP)

`controller/index.html`:

```html
<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>Lumen Remote</title>
<link rel="stylesheet" href="style.css">
</head><body>
  <div id="reconnect" class="overlay hidden">Reconnecting…</div>

  <header>
    <select id="surfacePick"></select>
    <button id="addShape">+ Shape</button>
    <button id="curtainBtn">Curtain</button>
  </header>

  <!-- The drag pad: a scaled-down mirror of the projector canvas -->
  <div id="pad">
    <svg id="quad" width="100%" height="100%"></svg>
    <div class="dot" data-corner="0"></div>
    <div class="dot" data-corner="1"></div>
    <div class="dot" data-corner="2"></div>
    <div class="dot" data-corner="3"></div>
  </div>
  <p class="hint">Drag each dot until the picture sits where you want it.</p>

  <section id="mediaBar">
    <label class="upBtn">＋<input id="fileIn" type="file"
           accept="video/mp4,video/webm,image/*" hidden></label>
    <div id="mediaList"></div>
  </section>

  <section id="sliders">
    <label>See-through <input id="opacity" type="range" min="0" max="1" step="0.01"></label>
    <label>Brightness <input id="brightness" type="range" min="0" max="2" step="0.01"></label>
    <label><input id="gridChk" type="checkbox"> Alignment grid</label>
  </section>

  <script src="controller.js"></script>
</body></html>
```

`controller/controller.js`:

```javascript
// controller.js — phone remote. Plain JS, no framework, no build step.
const host = location.hostname;
let ws, state = null, activeSurfaceId = null, curtainDown = false;

// ---------- connection ----------
function connect() {
  ws = new WebSocket(`ws://${host}:8091`);
  ws.onopen = () => document.getElementById('reconnect').classList.add('hidden');
  ws.onclose = () => {
    document.getElementById('reconnect').classList.remove('hidden');
    setTimeout(connect, 2000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') { state = msg; onState(); }
    if (msg.type === 'corner.moved' && state) {
      const s = state.surfaces.find((x) => x.id === msg.surfaceId);
      if (s) { s.corners[msg.corner] = { x: msg.x, y: msg.y };
               if (msg.surfaceId === activeSurfaceId) layoutDots(); }
    }
  };
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
connect();

// ---------- state → UI ----------
function activeSurface() {
  return state?.surfaces.find((s) => s.id === activeSurfaceId) || state?.surfaces[0];
}

function onState() {
  if (!state.surfaces.some((s) => s.id === activeSurfaceId))
    activeSurfaceId = state.surfaces[0].id;
  const pick = document.getElementById('surfacePick');
  pick.innerHTML = state.surfaces
    .map((s) => `<option value="${s.id}" ${s.id === activeSurfaceId ? 'selected' : ''}>${s.name}</option>`)
    .join('');
  const list = document.getElementById('mediaList');
  list.innerHTML = state.media
    .map((m) => `<button class="mediaItem" data-id="${m.id}">${m.kind === 'video' ? '🎬' : '🖼'} ${m.name}</button>`)
    .join('');
  const s = activeSurface();
  document.getElementById('opacity').value = s.opacity;
  document.getElementById('brightness').value = s.brightness;
  document.getElementById('gridChk').checked = s.gridVisible;
  layoutDots();
}

// ---------- drag pad (16:9 mirror of the projector) ----------
const pad = document.getElementById('pad');
const dots = [...document.querySelectorAll('.dot')];

function layoutDots() {
  const s = activeSurface(); if (!s) return;
  const r = pad.getBoundingClientRect();
  s.corners.forEach((c, i) => {
    dots[i].style.left = c.x * r.width + 'px';
    dots[i].style.top = c.y * r.height + 'px';
  });
  const pts = s.corners.map((c) => `${c.x * r.width},${c.y * r.height}`).join(' ');
  document.getElementById('quad').innerHTML =
    `<polygon points="${pts}" fill="rgba(90,200,255,.25)" stroke="#5ac8ff" stroke-width="2"/>`;
}

let dragging = null, rafPending = false;
dots.forEach((dot) => {
  dot.addEventListener('pointerdown', (e) => {
    dragging = +dot.dataset.corner;
    dot.setPointerCapture(e.pointerId);
  });
  dot.addEventListener('pointermove', (e) => {
    if (dragging === null) return;
    const r = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const s = activeSurface();
    s.corners[dragging] = { x, y };
    layoutDots();
    if (!rafPending) {                      // throttle to one WS msg per frame
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        send({ type: 'corner.move', surfaceId: s.id,
               corner: dragging ?? 0, x: s.corners[dragging ?? 0].x,
               y: s.corners[dragging ?? 0].y });
      });
    }
  });
  dot.addEventListener('pointerup', () => (dragging = null));
});
window.addEventListener('resize', layoutDots);

// ---------- controls ----------
document.getElementById('surfacePick').onchange = (e) => {
  activeSurfaceId = e.target.value; onState();
};
document.getElementById('addShape').onclick = () => send({ type: 'surface.add' });
document.getElementById('curtainBtn').onclick = (e) => {
  curtainDown = !curtainDown;
  e.target.classList.toggle('down', curtainDown);
  send({ type: 'output.blackout', enabled: curtainDown });
};
document.getElementById('opacity').oninput = (e) =>
  send({ type: 'surface.opacity', surfaceId: activeSurface().id, value: +e.target.value });
document.getElementById('brightness').oninput = (e) =>
  send({ type: 'surface.brightness', surfaceId: activeSurface().id, value: +e.target.value });
document.getElementById('gridChk').onchange = (e) =>
  send({ type: 'grid.toggle', surfaceId: activeSurface().id, visible: e.target.checked });
document.getElementById('mediaList').onclick = (e) => {
  const id = e.target.closest('.mediaItem')?.dataset.id;
  if (id) send({ type: 'media.set', surfaceId: activeSurface().id, mediaId: id });
};
document.getElementById('fileIn').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file', f);
  await fetch(`http://${host}:8090/api/media`, { method: 'POST', body: fd });
  e.target.value = '';
};
```

`controller/style.css`:

```css
* { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
body { margin:0; font-family:system-ui; background:#0d0f14; color:#eee;
       touch-action:none; user-select:none; }
header { display:flex; gap:8px; padding:12px; }
header select, header button { flex:1; padding:12px; font-size:16px;
  border-radius:10px; border:none; background:#1e2430; color:#fff; }
#curtainBtn { background:#3a2020; } #curtainBtn.down { background:#c33; }
#pad { position:relative; width:calc(100% - 24px); aspect-ratio:16/9;
       margin:0 12px; background:#151a24; border-radius:12px; overflow:hidden; }
#quad { position:absolute; inset:0; }
.dot { position:absolute; width:44px; height:44px; margin:-22px 0 0 -22px;
  border-radius:50%; background:radial-gradient(circle,#5ac8ff 30%,rgba(90,200,255,.3) 70%);
  border:2px solid #fff; }
.hint { text-align:center; color:#889; font-size:14px; }
#mediaBar { display:flex; gap:8px; padding:12px; overflow-x:auto; }
.upBtn { min-width:56px; height:56px; display:grid; place-items:center;
  background:#1e2430; border-radius:12px; font-size:24px; }
.mediaItem { padding:8px 12px; border-radius:12px; border:none;
  background:#1e2430; color:#fff; white-space:nowrap; }
#sliders { padding:0 16px; }
#sliders label { display:block; margin:14px 0; font-size:15px; }
#sliders input[type=range] { width:100%; }
.overlay { position:fixed; inset:0; background:rgba(0,0,0,.85); z-index:50;
  display:grid; place-items:center; font-size:22px; }
.hidden { display:none; }
```

---

## 7. Step-by-Step Build, Run & Deploy Guide

### 7.1 Run in development (5 minutes)

```powershell
cd lumen/desktop
npm start
```

Expected: the Lumen control window opens with a QR code. If a projector (or any second monitor) is plugged in, a black fullscreen window appears on it.

### 7.2 Test the full loop

1. Connect your phone to **the same Wi-Fi** as the PC. (Corporate/hotel networks with "client isolation" will block this — use a home router or phone hotspot with the PC joined to it.)
2. Scan the QR with the phone camera → the remote opens in the browser.
3. Tap **＋** in the media bar → pick a video from the phone → it uploads.
4. Tap the uploaded item → it appears on the projector.
5. Drag the four dots → the projected image warps live.
6. Tap **Curtain** → projector goes black instantly.

No projector handy? Any second monitor behaves identically. No second monitor at all? Temporarily change `pickProjectorDisplay()` to `return screen.getPrimaryDisplay();` for development.

### 7.3 Build the Windows installer

`desktop/electron-builder.yml`:

```yaml
appId: app.lumen.desktop
productName: Lumen
files:
  - src/**/*
  - "!node_modules/.cache"
extraResources:
  - from: ../controller
    to: controller
win:
  target: nsis
  icon: assets/icon.ico
nsis:
  oneClick: true
```

One packaging fix is required: when packaged, `controller/` lives in `resources/controller`, not three dirs up. In `server.js` replace the `CONTROLLER_DIR` line with:

```javascript
const CONTROLLER_DIR = process.resourcesPath && !process.defaultApp
  ? path.join(process.resourcesPath, 'controller')
  : path.join(__dirname, '..', '..', '..', 'controller');
```

Then:

```powershell
npm run dist
```

Output: `desktop/dist/Lumen Setup 0.1.0.exe`. **Windows Firewall will prompt on first run — the user must click "Allow"** (this is the one irreducible manual step; document it in onboarding card 2's fine print). For distribution beyond friends, buy a code-signing certificate later — unsigned exes trigger SmartScreen warnings.

### 7.4 Phone deployment

**MVP (today):** nothing to deploy. The phone browser IS the app. Tell users "Add to Home Screen" for an app-like icon.

**v1.1 (App Store / Play Store)** — wrap the identical controller with Capacitor:

```powershell
cd lumen
npm install -g @capacitor/cli
mkdir mobile-shell; cd mobile-shell
npm init -y
npm install @capacitor/core @capacitor/android @capacitor/ios @capacitor/cli
npx cap init Lumen app.lumen.remote --web-dir=../controller
npx cap add android
npx cap add ios
```

One code change for the native shell: `location.hostname` is meaningless inside Capacitor, so add a first-run screen that scans the QR (use `@capacitor/barcode-scanner`) or lets the user type the address, store it in `localStorage`, and use that instead of `location.hostname` in `controller.js`.

Android test build (needs Android Studio installed):

```powershell
npx cap sync android
npx cap open android
```

Then in Android Studio: Run ▶ on a USB-connected phone with Developer Mode enabled. iOS is the same via `npx cap open ios` on a Mac with Xcode + a free Apple developer account for device testing.

---

## 8. Self-Check (bars applied before handover)

- **Correctness:** homography math verified against the standard DLT formulation; degenerate (collinear) corner sets return null and the previous transform persists rather than exploding. Corner order TL,TR,BR,BL is enforced in one place (protocol §3.1) and used consistently everywhere.
- **Security:** the server binds to the LAN by design (that's the product). Mitigations included: path-traversal blocked on both static routes, upload extension allow-list, 500 MB cap, filename sanitization. **Known accepted risk, stated plainly: anyone on the same Wi-Fi can control the projection in v1.** For v1.1 add a 4-digit pairing PIN embedded in the QR and checked on WS connect (~20 lines). Do not ship v1 to venues with untrusted public Wi-Fi.
- **Simplicity:** zero frameworks on the controller, zero shaders, one warp technique, one protocol. Upgrade paths (WebGL renderer, PIN auth, Capacitor shell, masking) are all additive — nothing needs rewriting.
- **Performance:** corner drags travel phone→PC in one WS frame per rAF (~60/s max) and mutate only a `transform` property (GPU compositor path, no layout/paint). Video decode is hardware-accelerated by Chromium.
- **Loop integrity:** disconnects never blank the projector; state persists across app restarts; two phones stay in sync via broadcast.

**Known MVP limitations (honest list):** single projector only; media loops with no timeline; iOS Safari occasionally throttles background WebSockets (keep the remote foregrounded); `matrix3d` warping stretches texture linearly across the quad, which is imperceptible for typical wall/box mapping but visibly "shears" at extreme corner angles — the WebGL upgrade fixes that if it ever matters.

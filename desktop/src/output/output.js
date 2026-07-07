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

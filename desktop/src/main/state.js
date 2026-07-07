// state.js — holds scene state, validates every incoming message, persists to disk.
// FIXES APPLIED (see wargames/07-bugs.md): B2 (duplicate surface IDs after
// restart) and B3 (corner/opacity edits were silently lost on restart).
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

  // --- B2 fix: derive nextId from every surface ID ever seen (live +
  // saved scenes), instead of a hardcoded 2. Prevents duplicate IDs when a
  // save file already contains s2, s3... from a previous session.
  function idNum(id) { return parseInt(String(id).slice(1), 10) || 0; }
  let nextId = 1 + Math.max(
    0,
    ...s.surfaces.map((x) => idNum(x.id)),
    ...s.scenes.flatMap((sc) => sc.surfaces.map((x) => idNum(x.id)))
  );

  function persist() {
    fs.writeFileSync(savePath, JSON.stringify({ live: s }, null, 2));
  }

  // --- B3 fix: debounce-persist so live edits (corner drags, sliders)
  // survive a restart, without hammering disk at 60/s during a drag.
  let persistTimer = null;
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 1000);
  }

  /** Apply a phone message. Returns true if state changed. */
  function apply(m) {
    let changed = false;
    switch (m.type) {
      case 'corner.move': {
        const surf = find(m.surfaceId);
        const c = m.corner | 0;
        if (!surf || c < 0 || c > 3) return false;
        surf.corners[c] = { x: clamp01(m.x), y: clamp01(m.y) };
        changed = true;
        break;
      }
      case 'media.set': {
        const surf = find(m.surfaceId);
        if (!surf || !s.media.some((x) => x.id === m.mediaId)) return false;
        surf.mediaId = m.mediaId; surf.playing = true; surf.gridVisible = false;
        changed = true;
        break;
      }
      case 'media.play':  { const f = find(m.surfaceId); if (!f) return false; f.playing = true;  changed = true; break; }
      case 'media.pause': { const f = find(m.surfaceId); if (!f) return false; f.playing = false; changed = true; break; }
      case 'surface.opacity':    { const f = find(m.surfaceId); if (!f) return false; f.opacity = clamp01(m.value); changed = true; break; }
      case 'surface.brightness': { const f = find(m.surfaceId); if (!f) return false; f.brightness = Math.max(0, Math.min(2, +m.value || 0)); changed = true; break; }
      case 'grid.toggle': { const f = find(m.surfaceId); if (!f) return false; f.gridVisible = !!m.visible; changed = true; break; }
      case 'output.blackout': s.blackout = !!m.enabled; changed = true; break;
      case 'surface.add':
        s.surfaces.push(defaultSurface('s' + nextId, 'Shape ' + nextId));
        nextId++; changed = true; break;
      case 'surface.remove':
        if (s.surfaces.length <= 1) return false;      // never delete the last shape
        s.surfaces = s.surfaces.filter((x) => x.id !== m.surfaceId); changed = true; break;
      case 'scene.save':
        s.scenes.push({ id: 'sc_' + Date.now(), name: String(m.name || 'Setup').slice(0, 40),
                        surfaces: JSON.parse(JSON.stringify(s.surfaces)) });
        persist(); return true; // scene.save always persists immediately, not debounced
      case 'scene.load': {
        const sc = s.scenes.find((x) => x.id === m.sceneId);
        if (!sc) return false;
        s.surfaces = JSON.parse(JSON.stringify(sc.surfaces)); changed = true; break;
      }
      default: return false;
    }
    if (changed) {
      if (m.type === 'corner.move') schedulePersist(); // hot path: debounced
      else persist();                                  // everything else: immediate
    }
    return changed;
  }

  return {
    apply,
    persist,
    snapshot: () => JSON.parse(JSON.stringify(s)),
    addMedia: (mObj) => { s.media.push(mObj); persist(); }
  };
}

module.exports = { createState };

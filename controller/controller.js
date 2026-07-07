// controller.js — phone remote. Plain JS, no framework, no build step.
// FIXES APPLIED (see wargames/07-bugs.md):
//   B1 — the corner index is now captured at drag-move time, not read from
//        `dragging` again inside the throttled rAF callback (which could
//        already be null after pointerup, causing a phantom corner-0 jump).
//   B5 — a `sliderActive` guard stops incoming state broadcasts from
//        yanking a slider the user is actively dragging.
const host = location.hostname;
let ws, state = null, activeSurfaceId = null, curtainDown = false;
let sliderActive = false; // B5 fix

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
  // B5 fix: don't stomp a slider the user currently has their finger on.
  if (!sliderActive) {
    document.getElementById('opacity').value = s.opacity;
    document.getElementById('brightness').value = s.brightness;
  }
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
    const corner = dragging;              // B1 fix: capture NOW, not in the rAF closure
    s.corners[corner] = { x, y };
    layoutDots();
    if (!rafPending) {                    // throttle to one WS msg per frame
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (corner === null) return;      // guard: nothing to send if capture failed
        send({ type: 'corner.move', surfaceId: s.id,
               corner, x: s.corners[corner].x, y: s.corners[corner].y });
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

const opacityEl = document.getElementById('opacity');
const brightnessEl = document.getElementById('brightness');
[opacityEl, brightnessEl].forEach((el) => {
  el.addEventListener('pointerdown', () => { sliderActive = true; });
  el.addEventListener('pointerup', () => { sliderActive = false; });
});
opacityEl.oninput = (e) =>
  send({ type: 'surface.opacity', surfaceId: activeSurface().id, value: +e.target.value });
brightnessEl.oninput = (e) =>
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
  try {
    const res = await fetch(`http://${host}:8090/api/media`, { method: 'POST', body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "That file couldn't be added. Try a smaller video or a jpg/png/gif.");
    }
  } catch {
    alert("Couldn't reach the computer. Make sure your phone is on the same Wi-Fi.");
  }
  e.target.value = '';
};

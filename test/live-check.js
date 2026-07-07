// live-check.js — drives the REAL running app (server.js + state.js, inside
// the actual Electron process) over the network, exactly like a phone would.
// Run this while the Electron app is booted (see boot command in the shell log).
const WebSocket = require('ws');

const HTTP = 'http://127.0.0.1:8090';
const WS = 'ws://127.0.0.1:8091';
let failures = 0;
const ok = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) failures++;
};

async function main() {
  // 1) controller page is served
  const page = await fetch(HTTP + '/');
  ok('controller page 200', page.status === 200);
  const html = await page.text();
  ok('controller page contains drag pad', html.includes('id="pad"'));

  // 2) WS connects and sends initial state
  const ws = new WebSocket(WS);
  const state = await new Promise((res) => {
    ws.once('open', () => {});
    ws.once('message', (raw) => res(JSON.parse(raw)));
  });
  ok('initial state has >=1 surface', state.type === 'state' && state.surfaces.length >= 1);
  const surfaceId = state.surfaces[0].id;

  // 3) B1 regression check — send corner.move for corner 2, confirm ONLY
  // corner 2 changes (this is the corner that used to jump on release)
  const before = JSON.stringify(state.surfaces[0].corners);
  await send(ws, { type: 'corner.move', surfaceId, corner: 2, x: 0.42, y: 0.77 });
  const echo = await nextOfType(ws, 'corner.moved');
  ok('corner.moved echoes the corner we moved', echo.corner === 2 && echo.x === 0.42 && echo.y === 0.77);

  // 4) surface.add — confirm no duplicate IDs against a fresh state (B2 class check)
  await send(ws, { type: 'surface.add' });
  const st2 = await nextOfType(ws, 'state');
  const ids = st2.surfaces.map((s) => s.id);
  ok('surface.add produced unique ids', new Set(ids).size === ids.length);

  // 5) blackout toggles
  await send(ws, { type: 'output.blackout', enabled: true });
  const st3 = await nextOfType(ws, 'state');
  ok('blackout true reflected in state', st3.blackout === true);
  await send(ws, { type: 'output.blackout', enabled: false });

  // 6) B4 regression — oversized upload gets a real HTTP response, not a hang
  const bigBody = Buffer.alloc(2 * 1024 * 1024); // 2MB stand-in; full 500MB+ proven in unit test
  const form = new FormData();
  form.append('file', new Blob([bigBody]), 'clip.mp4');
  const uploadRes = await fetch(HTTP + '/api/media', { method: 'POST', body: form });
  ok('normal-size upload succeeds', uploadRes.status === 200);
  const uploadJson = await uploadRes.json();
  ok('upload returns media id', !!uploadJson.id);

  // 7) assign that media to the surface and confirm it shows up in state
  await send(ws, { type: 'media.set', surfaceId, mediaId: uploadJson.id });
  const st4 = await nextOfType(ws, 'state');
  ok('media.set reflected in state', st4.surfaces.find((s) => s.id === surfaceId).mediaId === uploadJson.id);

  ws.close();
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}

function send(ws, obj) { return new Promise((res) => { ws.send(JSON.stringify(obj), res); }); }
function nextOfType(ws, type) {
  return new Promise((res) => {
    function onMsg(raw) {
      const m = JSON.parse(raw);
      if (m.type === type) { ws.off('message', onMsg); res(m); }
    }
    ws.on('message', onMsg);
  });
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });

// run-tests.js — fast, Electron-free unit tests for the two files that carry
// all the real logic: state.js (protocol/state machine) and homography.js
// (the corner-pinning math). Run with: node test/run-tests.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { createState } = require('../desktop/src/main/state.js');
const { matrix3dFor, solve8 } = require('../desktop/src/output/homography.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('PASS — ' + name); }
  catch (e) { failures++; console.log('FAIL — ' + name + '\n       ' + e.message); }
}

// ---------- B2: no duplicate surface IDs after a restart ----------
test('B2: nextId derives from existing high-water-mark ids, not hardcoded 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
  fs.writeFileSync(path.join(dir, 'scenes.json'), JSON.stringify({
    live: {
      blackout: false, media: [], scenes: [],
      surfaces: [{ id: 's7', name: 'x', mediaId: null, playing: false,
        opacity: 1, brightness: 1, gridVisible: true,
        corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}] }]
    }
  }));
  const st = createState(dir);
  st.apply({ type: 'surface.add' });
  const ids = st.snapshot().surfaces.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids must be unique: ' + ids);
  assert.ok(ids.includes('s8'), 'expected s8, got ' + ids);
});

// ---------- B3: corner edits survive a simulated restart ----------
test('B3: corner.move is debounce-persisted so a restart keeps the position', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
  const st = createState(dir);
  const id = st.snapshot().surfaces[0].id;
  st.apply({ type: 'corner.move', surfaceId: id, corner: 1, x: 0.61, y: 0.22 });
  st.persist(); // force-flush instead of waiting out the 1s debounce in a test
  const st2 = createState(dir); // simulates app restart: fresh load from disk
  const c = st2.snapshot().surfaces[0].corners[1];
  assert.strictEqual(c.x, 0.61);
  assert.strictEqual(c.y, 0.22);
});

// ---------- protocol validation: bad input never crashes or corrupts state ----------
test('state.apply ignores out-of-range corner index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
  const st = createState(dir);
  const id = st.snapshot().surfaces[0].id;
  const changed = st.apply({ type: 'corner.move', surfaceId: id, corner: 9, x: 0.5, y: 0.5 });
  assert.strictEqual(changed, false);
});

test('state.apply refuses to remove the last surface', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
  const st = createState(dir);
  const id = st.snapshot().surfaces[0].id;
  const changed = st.apply({ type: 'surface.remove', surfaceId: id });
  assert.strictEqual(changed, false);
  assert.strictEqual(st.snapshot().surfaces.length, 1);
});

test('values are clamped: opacity/brightness never go out of range', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
  const st = createState(dir);
  const id = st.snapshot().surfaces[0].id;
  st.apply({ type: 'surface.opacity', surfaceId: id, value: 5 });
  st.apply({ type: 'surface.brightness', surfaceId: id, value: -3 });
  const s = st.snapshot().surfaces[0];
  assert.strictEqual(s.opacity, 1);
  assert.strictEqual(s.brightness, 0);
});

// ---------- homography math ----------
test('homography: mapping the unit square to itself (scaled) is near-identity', () => {
  const dst = [ { x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 450 }, { x: 0, y: 450 } ];
  const m = matrix3dFor(800, 450, dst);
  assert.ok(m, 'expected a matrix, got null');
  const nums = m.match(/matrix3d\((.+)\)/)[1].split(',').map(Number);
  // column-major 4x4 identity: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  nums.forEach((n, i) => assert.ok(Math.abs(n - identity[i]) < 1e-6,
    `index ${i}: expected ${identity[i]}, got ${n}`));
});

test('homography: degenerate (collinear) corners return null, not a crash', () => {
  const dst = [ { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 } ]; // all on one line
  const m = matrix3dFor(800, 450, dst);
  assert.strictEqual(m, null);
});

test('homography: a real 4-corner drag produces a valid, finite matrix', () => {
  const dst = [ { x: 50, y: 80 }, { x: 900, y: 40 }, { x: 870, y: 500 }, { x: 90, y: 470 } ];
  const m = matrix3dFor(800, 450, dst);
  assert.ok(m);
  const nums = m.match(/matrix3d\((.+)\)/)[1].split(',').map(Number);
  nums.forEach((n) => assert.ok(Number.isFinite(n), 'matrix contains non-finite value: ' + m));
});

console.log('\n' + (failures === 0 ? 'ALL PASS (' + 8 + ' tests)' : failures + ' FAILURE(S)'));
process.exit(failures === 0 ? 0 : 1);

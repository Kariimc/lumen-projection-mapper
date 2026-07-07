# WARGAME 07 — BUG HUNT & FIX: Lumen MVP
**Executor:** Claude Code (cheap model). **Mode:** follow moves in order. Never improvise beyond a listed counter-move or fork. Every fix is a surgical edit — no rewrites, no new dependencies, no frameworks.

## 0. Ground truth from recon (read-only, already done)
- Source of truth: `PROJECTION_MAPPING_BLUEPRINT.md` §6 — the repo is scaffolded verbatim from it. If the repo already exists on disk, **diff it against the blueprint first** (Move M0); fix bugs in the repo files, not the doc.
- Core flow traced: phone WS msg → `server.js` → `state.apply()` → `onChange` → IPC → `output.js` render/`applyWarp`. Upload flow: HTTP multipart → `handleUpload` → `state.addMedia` → broadcast.
- Desk-trace verdicts:
  - `homography.js` solve8 / matrix3dFor: **correct** (Gauss-Jordan with pivoting; row/diagonal indexing checks out). Do not touch.
  - Range streaming, path-traversal guards, clamp logic: correct enough for MVP.
- **Confirmed bugs (fix these):** B1–B5 below. **Suspects (runtime-only):** S1–S3, each RECON NEEDED.

## 1. Confirmed bugs — the target list
| ID | File | Bug | Effect |
|---|---|---|---|
| B1 | `controller/controller.js` | rAF-throttled send uses `dragging ?? 0` — by the time the frame fires, `pointerup` may have set `dragging = null`, so the message sends **corner 0** with corner-0's coordinates | corner 0 "jumps" randomly on drag release |
| B2 | `desktop/src/main/state.js` | `nextId = 2` is hardcoded; persisted state loaded from disk may already contain `s2`, `s3`… | `surface.add` after restart creates **duplicate surface IDs** → two shapes fight over one DOM element |
| B3 | `desktop/src/main/state.js` | `persist()` only runs on `scene.save` / `addMedia`, but §8 of the blueprint claims "state persists across app restarts" | live corner/opacity edits silently lost on restart; doc/behavior mismatch |
| B4 | `desktop/src/main/server.js` | oversize upload calls `req.destroy()` with **no HTTP response** | phone `fetch` hangs forever; user sees frozen "+" with no error |
| B5 | `controller/controller.js` | every state broadcast runs `onState()` which resets slider `.value` — while a user drags a slider, their own echo (or a second phone) yanks it | slider stutter / fight; worse with 2 phones |

## 2. Moves
Run in order. Each move: **DO → EXPECT → IF-FAIL (cause → counter-move)**.

### M0 — Establish the battlefield
DO: `ls` repo root. If absent, scaffold every file verbatim from blueprint §6 (including `package.json` scripts). Then `cd desktop && npm install`.
EXPECT: install exits 0; `node -e "require('./src/main/state.js')"` exits 0.
IF-FAIL: `electron` postinstall download blocked → cause: no network to Electron mirror → counter-move: `npm install --ignore-scripts` for logic work; flag that runtime moves (M6+) need a networked machine. Syntax error on require → transcription typo → diff file against blueprint, fix the typo only.

### M1 — Pin B1 (corner-0 jump)
DO: in `controller.js`, inside `pointermove`, capture the corner index into the rAF closure at schedule time:
```js
const corner = dragging;           // capture NOW
requestAnimationFrame(() => { rafPending = false;
  send({ type:'corner.move', surfaceId:s.id, corner,
         x:s.corners[corner].x, y:s.corners[corner].y }); });
```
Remove both `?? 0` fallbacks. Guard: if `corner === null` skip the send.
EXPECT: `grep -n '?? 0' controller/controller.js` returns nothing.
IF-FAIL: grep still matches → edit landed in wrong block (there is only one rAF block) → re-open file, apply at the single `rafPending` site.

### M2 — Pin B2 (duplicate IDs)
DO: in `state.js`, after loading `s`, derive: `let nextId = 1 + Math.max(0, ...s.surfaces.map(x => parseInt(x.id.slice(1),10) || 0), ...s.scenes.flatMap(sc => sc.surfaces.map(x => parseInt(x.id.slice(1),10) || 0)));` replacing `let nextId = 2;`.
EXPECT: unit check (see V2) passes.
IF-FAIL: `Math.max` returns `-Infinity` on empty arrays → cause: no surfaces in a corrupt save → counter-move: the `Math.max(0, ...)` leading 0 already prevents this; if still failing, wrap in `try` and fall back to `Date.now()`-suffixed IDs.

### M3 — Pin B3 (persistence lie)
Fork — pick by trigger:
- **Route A (default):** make behavior match the doc. In `state.apply`, after any `return true` path, persist — cheapest surgical form: change the final dispatch so `apply` wraps: compute `changed`, and `if (changed && m.type !== 'corner.move') persist();` (skipping the 60 Hz hot path), **plus** debounce-persist corners: in `server.js`'s message handler, after a `corner.move`, `clearTimeout(t); t = setTimeout(() => state.persist(), 1000)`.
- **Route B trigger:** if write latency to `userData` on the target machine exceeds ~20 ms (check: time 100 `persist()` calls), take Route B: persist only on a 5 s interval when dirty.
EXPECT: kill and relaunch the app after moving a corner → corner position survives.
IF-FAIL: position resets → cause: load path reads `.live` but persist wrote a different shape → verify `persist()` writes `{ live: s }` exactly; fix the writer, never the reader.

### M4 — Pin B4 (hanging upload)
DO: in `handleUpload`, replace the oversize branch:
```js
if (size > 500*1024*1024) {
  res.writeHead(413, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ error:'too large' }));
  req.destroy(); return;
}
```
And in `controller.js` `fileIn.onchange`, check `res.ok`; on failure `alert('That file is too big or unsupported.')` (plain-language per UX law).
EXPECT: uploading a >500 MB file returns HTTP 413 within seconds; UI shows the message.
IF-FAIL: response never arrives → cause: headers can't be written after chunks consumed on some Node versions when socket already errored → counter-move: also add `req.on('error', ()=>{})` to swallow, and send the 413 **before** `destroy()` (order above is already correct — verify order wasn't flipped).

### M5 — Pin B5 (slider fight)
DO: in `controller.js`, track `let sliderActive = false;` set true on `pointerdown` of either slider, false on `pointerup`. In `onState()`, skip the two `.value =` assignments when `sliderActive`. Additionally, don't call full `onState()` for state echoes triggered by your own slider: acceptable MVP shortcut — the `sliderActive` guard alone is enough.
EXPECT: dragging See-through is smooth with no snap-back, even with a second browser tab connected as a second "phone."
IF-FAIL: still stutters → cause: `oninput` floods WS and each broadcast rebuilds `mediaList` innerHTML causing layout jank → counter-move: throttle slider sends with the same rAF pattern as M1.

### M6 — Runtime suspects (RECON NEEDED — these could not be settled from source)
- **S1 — Electron secondary-display fullscreen.** RECON: launch with a second display; check the output window covers display 2, not primary. Settling check: `outputWin.getBounds()` equals display 2's bounds. If it fullscreens on primary → known Electron quirk → counter-move: create window with `fullscreen:false`, then `outputWin.setBounds(display.bounds); outputWin.setFullScreen(true);` after `did-finish-load`.
- **S2 — Wrong LAN IP in QR.** RECON: on a machine with WSL/VPN/VirtualBox adapters, run `node -e "console.log(require('./src/main/server.js').getLanIp())"` and compare to `ipconfig`'s Wi-Fi adapter. If mismatched → counter-move: prefer interfaces whose name matches /wi-?fi|ethernet/i and de-prioritize /virtual|vethernet|wsl|vpn/i; if ambiguity remains, list all candidate URLs on the control window ("having trouble?" panel).
- **S3 — Multipart marker collision.** The parser scans for the boundary inside file bytes; a binary file *containing* the boundary string corrupts. Probability ~0 (boundaries are random), but RECON: upload a 50 MB mp4 and byte-compare (`fc /b` or `cmp`) stored file vs original. If corrupt → counter-move: swap the hand parser for streaming boundary scan, or (1-line path) accept the `busboy` dependency — this is the ONLY approved new dependency, and only on confirmed corruption.

## 3. Forks summary (trigger → route)
- Persist latency >20 ms → M3 Route B (interval persist).
- Electron fullscreen lands on primary → S1 counter-move (setBounds-then-fullscreen).
- `getLanIp` ≠ real Wi-Fi IP → S2 counter-move (interface ranking + URL list).
- Upload byte-compare fails → S3 counter-move (busboy).
- No second display available at all → skip S1, mark UNVERIFIED in the final report; do NOT fake it with the primary-display hack unless explicitly doing dev-only testing, and never commit that hack.

## 4. Abort conditions (stop, report, do not push)
- Any fix requires touching `homography.js` math → you have misdiagnosed; the math is verified correct. Abort and report the observed symptom verbatim.
- A fix balloons past ~30 changed lines in one file → wrong approach; abort and report.
- `npm install` cannot fetch Electron on any available machine → runtime verification impossible; ship only M1–M5 logic fixes with V1–V4 (node-only) proofs, and mark M6 wholesale RECON NEEDED.
- Verification V1–V4 cannot be made to pass after one counter-move cycle → abort, report the failing transcript.

## 5. Verification runs (executor MUST perform; pass criteria explicit)
- **V1 (B1, node-only):** simulate `pointerup` racing rAF by unit-extracting the send guard, or minimally: `grep -c '?? 0' controller/controller.js` → **pass = 0**, plus manual drag on device shows no corner-0 jump across 20 rapid drag-releases.
- **V2 (B2, node-only):**
```bash
node -e "
const fs=require('fs'),os=require('os'),p=require('path');
const d=fs.mkdtempSync(p.join(os.tmpdir(),'lum'));
fs.writeFileSync(p.join(d,'scenes.json'),JSON.stringify({live:{blackout:false,media:[],scenes:[],surfaces:[{id:'s7',name:'x',mediaId:null,playing:false,opacity:1,brightness:1,gridVisible:true,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}]}}));
const {createState}=require('./desktop/src/main/state.js');
const st=createState(d); st.apply({type:'surface.add'});
const ids=st.snapshot().surfaces.map(s=>s.id);
if(new Set(ids).size!==ids.length||!ids.includes('s8')) throw new Error('FAIL '+ids);
console.log('PASS',ids);"
```
**pass = prints `PASS [ 's7', 's8' ]`.**
- **V3 (B3):** launch app → move a corner → wait 2 s → force-kill → relaunch → **pass = corner position identical** (compare `scenes.json` corners before/after kill).
- **V4 (B4, node-only):** `curl -s -o /dev/null -w "%{http_code}" -F "file=@/dev/zero-slice" http://127.0.0.1:8090/api/media` with a 600 MB sparse file → **pass = 413 within 30 s, curl exits.**
- **V5 (B5, manual):** two browser tabs on the controller URL; drag See-through in tab 1 while tab 2 is open → **pass = no snap-back in tab 1, tab 2's slider tracks within ~1 s.**
- **V6 (regression, always last):** full happy path from blueprint §7.2 — QR pair, upload mp4, assign, drag 4 dots, Curtain on/off → **pass = every step behaves as §7.2 describes, projector never blanks on phone disconnect** (kill the phone tab mid-video and confirm playback continues).

## 6. Report format on completion
One block: `FIXED: B1..B5 (commit/file list)` · `VERIFIED: V1..V6 pass/fail` · `RECON RESOLVED: S1..S3 outcome` · `UNVERIFIED: <list or none>` · single most useful next step.

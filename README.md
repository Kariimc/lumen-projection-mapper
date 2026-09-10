# Lumen — Projection Mapping for Everyone

Point your projector at anything. Drag four dots with your phone. Done.

Full design rationale, protocol spec, and UX naming rules live in
`docs/PROJECTION_MAPPING_BLUEPRINT.md`. Known issues and their fixes are
tracked in `wargames/07-bugs.md` (all five are already applied in this repo)
and `wargames/RESULTS.md` (real bugs found by actually running the app, not
just reading it).

## Quick start (developer)

```bash
npm ci
npm start --workspace desktop
```

A control window opens showing a pairing QR code. Plug a projector or any
second monitor into your computer — a black fullscreen window appears on it
automatically. Scan the QR with your phone (same Wi-Fi) to open the remote.

No second monitor to test with? Set `LUMEN_FORCE_PRIMARY_DISPLAY=1` before
`npm start` to preview the output on your main screen instead.

## Run the automated tests

```bash
npm test
```

This runs eight fast state/math checks plus the real archive-extractor and
isolated HTTP/WebSocket security regressions. The state tests cover the
state machine (duplicate-ID prevention, persistence, input validation, value
clamping) and the corner-pinning math itself (including the real division
bug this project shipped with once already — see `wargames/RESULTS.md`).

## Build the Windows installer

```bash
npm ci
npm run dist --workspace desktop -- --config.win.signExecutable=false
```

Output: `desktop/dist/Lumen Setup 0.1.0.exe`. This command produces an unsigned
local installer; it does not publish anything. The build pins its Electron
runtime and includes the phone controller under `resources/controller`.
After packaging, `postdist` checks the ASAR contents and controller bytes and
runs an isolated loopback check through the packaged executable. Repeat those
checks with `npm run test:package --workspace desktop` after a build.

Windows may ask for firewall access when the installed app first starts.
Allow access on a trusted private network for the phone remote. Unsigned
installers may also show Windows reputation warnings; this build is not a
signed store release. Physical projector and phone testing remain separate
from the automated package checks.

## Project layout

```
desktop/       Electron app: WebSocket + HTTP server, state store, the
                fullscreen output window that renders onto the projector
controller/    The phone remote — plain HTML/JS/CSS, no build step, no
                framework. Served by the desktop app; also the future
                Capacitor app-store wrapper's source (v1.1).
test/          Automated tests. run-tests.js needs only Node — no Electron,
                no display. live-check.js drives a *running* instance of
                the real app over the network, the way a phone would.
docs/          The original blueprint document.
wargames/      Bug hunt brief + the real results of running it.
```

## Known limitations (v1, honest list)

- Single projector only.
- No authentication: anyone on the same Wi-Fi can control the output. Fine
  for a home, classroom, or private event; don't ship this to a venue with
  open public Wi-Fi yet.
- Media loops with no timeline/sequencing.
- Corner-pinning uses a linear (CSS `matrix3d`) warp — correct and
  imperceptible for normal wall/box mapping, but visibly shears texture at
  extreme corner angles. A WebGL-based warp is the documented upgrade path
  if that ever matters (see blueprint §8).

See `FEATURES_ROADMAP.md` for what's deliberately *not* in v1 and why.

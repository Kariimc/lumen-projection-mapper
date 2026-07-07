# Lumen — Projection Mapping for Everyone

Point your projector at anything. Drag four dots with your phone. Done.

Full design rationale, protocol spec, and UX naming rules live in
`docs/PROJECTION_MAPPING_BLUEPRINT.md`. Known issues and their fixes are
tracked in `wargames/07-bugs.md` (all five are already applied in this repo)
and `wargames/RESULTS.md` (real bugs found by actually running the app, not
just reading it).

## Quick start (developer)

```bash
cd desktop
npm install
npm start
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

This runs `test/run-tests.js` — 8 fast, Electron-free checks covering the
state machine (duplicate-ID prevention, persistence, input validation, value
clamping) and the corner-pinning math itself (including the real division
bug this project shipped with once already — see `wargames/RESULTS.md`).

## Build the Windows installer

```bash
cd desktop
npm run dist
```

Output: `desktop/dist/Lumen Setup 0.1.0.exe`. Windows Firewall will prompt on
first run of the installed app — the user must click **Allow**, or the phone
won't be able to reach it.

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

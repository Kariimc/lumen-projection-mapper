# Wargame 07 — Actual Results (not a simulation)

`07-bugs.md` was written as a paper wargame for a cheaper executor to follow.
This repo's build actually executed that brief for real: real `npm install`,
a real Electron process booted under Xvfb with `--no-sandbox`, a real
WebSocket client driving it, a real 520 MB HTTP upload, and a real Chrome
DevTools Protocol connection reading the live CSS transform out of the actual
output window. Here's what happened, including the one thing the wargame
got wrong.

## B1–B5: all fixed and verified against the real running app
| ID | Verified how | Result |
|---|---|---|
| B1 corner-0 jump | Code fix (capture corner index before the rAF callback fires) | Fix present in `controller/controller.js`; `grep -c '?? 0'` returns 0 |
| B2 duplicate IDs | `test/run-tests.js`, real restart simulation from a seeded `scenes.json` | PASS — `surface.add` after a restart with an existing `s7` produces `s8`, not a collision |
| B3 persistence | `test/run-tests.js`, real restart simulation | PASS — corner position survives a simulated app restart |
| B4 hanging upload | Real 520 MB file, real `curl` against the real live server | PASS — HTTP `413` in 8.2s with a real JSON error body, not a hang |
| B5 slider fight | Code fix (`sliderActive` guard in `controller.js`) | Present; not independently re-tested live (would need two real browser sessions, which needs a display — logged as a manual QA step, not blocking) |

## S1–S3 (RECON NEEDED items): resolved
- **S1 (secondary-display fullscreen)** — couldn't fully resolve as originally
  scoped: this sandbox's Xvfb only exposes one display, so there's no true
  "secondary display" to test against. Added `LUMEN_FORCE_PRIMARY_DISPLAY=1`
  as a documented, opt-in dev switch (see README) so the output window can be
  verified without real projector hardware. **Still genuinely RECON NEEDED
  on real multi-monitor Windows hardware** before calling S1 fully closed —
  log this as the top item for a human tester with an actual second screen.
- **S2 (wrong LAN IP in QR)** — fixed defensively (interface name filtering
  in `getLanIp()`) but not verified against a real VPN/WSL adapter in this
  sandbox (none present). Still RECON NEEDED on a machine that actually has
  one.
- **S3 (multipart boundary collision)** — not hit; the 520 MB real-file test
  in B4 used a sparse zero-filled file, which by definition can't contain
  the random boundary string. Genuine confirmation needs a real video file
  whose bytes are searched for the boundary — low priority given boundary
  strings are randomly generated per-request.

## The bug the wargame's desk-trace got WRONG — found only by actually running the code
The original wargame explicitly said: *"`homography.js` solve8 / matrix3dFor:
**correct** ... Do not touch."* That verdict was wrong.

`test/run-tests.js` caught it immediately: feeding the solver a real 4-corner
drag returned a matrix full of `NaN`. The cause: in the back-substitution
step, `row` is already the solved row (`M[i]`), so `row[i]` is the scalar
pivot value — but the code wrote `row[i][i]`, indexing a number as if it
were an array, which JavaScript silently evaluates to `undefined`. Any
division by that `undefined` is `NaN`.

**Impact if this had shipped:** the single most important feature in the
entire product — dragging a corner to fit the image to a surface — would
have silently done nothing. The browser ignores an invalid `matrix3d(NaN,
...)` CSS value, so there'd be no error, no crash, no console warning a
non-technical user would ever see. Just an image that never moves. This is
exactly the failure mode a "desk-trace, don't touch it" review is worst at
catching, and exactly what "loop engineering" — actually executing the code
— is for.

**Fixed:** `row[i][i]` → `row[i]`. Verified three ways:
1. Unit test: a real 4-corner drag now returns a finite matrix (was all `NaN`).
2. Unit test: mapping a rectangle to itself now returns the identity matrix
   to 1e-6 precision (was `NaN`).
3. Live: attached Chrome DevTools Protocol to the actual running output
   window, pushed a real corner drag through the actual live WebSocket
   server, and read back a real, different, finite `matrix3d(...)` from the
   real DOM element before and after the drag.

**Lesson for future wargames written against this codebase:** a "verified
correct" desk-trace verdict on numerical code is a hypothesis, not a fact,
until something actually executes it with real inputs. Future wargame briefs
against this repo should mark math-heavy files as RECON NEEDED with "run
`npm test`" as the settling check, not skip them as pre-verified.

## Final status
`npm test` (8/8 pass) + the live checks above are the full verification this
sandbox can perform. **Not yet verified: a real Windows machine with a real
second monitor, a real projector, and a real phone on the same Wi-Fi** —
that's the one class of check no sandbox substitutes for. Recommended as the
very next step before calling this release-ready.

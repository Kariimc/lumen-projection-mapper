# Feature Roadmap — why v1 is deliberately small

"Feature-packed" and "100% working, no bugs" pull in opposite directions when
they're both due in one pass with no human review gate in between: every
feature added is more surface area for exactly the kind of bug this repo's
own homography.js shipped with (see `wargames/RESULTS.md`) — code that reads
correctly and passes a desk review but is mathematically wrong until you
actually run it.

So v1 ships **one thing, working**: drag corners on your phone, projector
warps live, no jargon anywhere. Everything below is scoped, sequenced, and
explicitly *not* in v1 — this is the "feature packed" ambition, made honest
about order and cost instead of crammed in unverified.

## v1.1 — polish, still simple
- **4-digit pairing PIN**, shown in the QR, checked on WebSocket connect
  (~20 lines in `server.js`). Closes the "anyone on the Wi-Fi controls it"
  gap noted in the README.
- **Capacitor app-store wrapper** around the identical `controller/` code —
  installable icon instead of "scan a QR every time." Scaffolding for this
  is already in the blueprint (§7.4).
- **Scene switching UI** — `scene.save` / `scene.load` already exist in the
  protocol and state machine; v1 just doesn't expose them in the phone UI
  yet. This is a controller.js-only change, no new backend work.

## v1.2 — more surfaces, more control
- **Multiple independent shapes with a visual overview** — the protocol
  already supports N surfaces; add a "see all shapes at once" screen instead
  of the one-at-a-time picker.
- **Hide edges (masking)** — finger-draw a region to cut out of a shape
  (e.g., mask around a window on the wall you're projecting onto).
- **Per-shape media trimming** — in/out points for video clips, no timeline,
  just two handles on a scrubber.

## v2 — only if v1 usage justifies it
- **Multi-projector edge blending.** Genuinely hard (color/luminance
  matching across projector units); don't build until real users hit the
  single-projector ceiling.
- **WebGL-based warp** to replace the CSS `matrix3d` linear warp — fixes
  the extreme-angle shearing noted in the README. Purely an internal
  swap; the protocol and UI don't change.
- **DMX/lighting sync.** Out of scope for "projection mapping," but the
  most-requested adjacent feature in every competitor's forum — worth a
  dedicated design pass, not a bolt-on.

## Explicitly rejected, not just deferred
- **Auto-calibration via camera.** Lightform tried this and the company
  folded (see blueprint §0). Manual 4-corner dragging is fast enough that
  the added hardware/complexity isn't worth it.
- **A full timeline/sequencer.** That's Resolume/MadMapper's job; adding it
  here re-creates the complexity this project exists to avoid.

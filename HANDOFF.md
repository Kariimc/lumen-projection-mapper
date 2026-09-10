# Lumen release handoff — September 8, 2026

## Current state

The `audit/lumen-security-sep8` draft preserves current main and contains the
reviewed controller-input fixes, Electron security update and Windows packaging
repair. The original development checkout was not changed by release assembly.
Nothing has been merged, and the generated installer has not been run.

## Changed this session

Electron is pinned to 42.11.2 and electron-builder to 26.15.3. Packaging includes
only application source/runtime dependencies plus the exact phone-controller
assets under `resources/controller`. The distribution command never publishes.
Its post-build check verifies the archive and launches the packaged executable
in Node mode with temporary state and ephemeral loopback ports.

Verified: eight state/math checks, archive security regression, three HTTP/WS
scenarios, native Windows NSIS build, package inventory and packaged-runtime
HTTP checks. Removing an owned packaged stylesheet made the package check fail;
restoring it passed. Both built ASAR screens also passed hidden Electron renderer
load/IPC/DOM checks with external requests denied. Dependency audit reported zero
vulnerabilities. Independent source review approved the scoped repair.

## Exact next steps

Follow the root README for reproducible installation, tests and packaging.
The produced installer is unsigned; no certificate or publishing credentials
were used. Keep the draft open until the release/merge decision is explicit.

## Open decisions and limits

No installer installation, ordinary LAN startup, physical projector/hotplug,
real-media projection or phone-device interaction was tested here. The app still
has no LAN authentication and is intended for trusted private networks. These
checks do not establish hardware compatibility or signed distribution readiness.

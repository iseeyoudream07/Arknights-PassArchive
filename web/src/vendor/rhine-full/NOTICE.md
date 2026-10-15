# RhineLabUI source attribution

Source: https://github.com/LBEILC/RhineLabUI
Pinned commit: 12cc5e4013acb9408f753ff71de6b8492299b7c8
Copyright (c) 2026 LBEILC. Original code and original models: MIT.
Full license: ../../../public/licenses/rhine-full-MIT.txt

This directory retains the original boot, motion, Three.js scene, glass and
decryption pipeline, rolling titles and clocks, viewer, theme, responsive layout,
audio, quality and animation controls. Local changes integrate a real pass
catalogue, same-origin host navigation, preferences, data/privacy information,
independent array index/slot mapping and the host-owned service worker. Debug
query parameters only apply in development. Optional wallpaper/workbench modules
are retained as source references; they are not part of the pass collection API.

Models and required audio/font resources: /rhine/ under web/public.
The fetched source/asset manifest with original Git blob identities is
references/rhine-files.json. tools/fetch_rhine.py can reconstruct the unmodified
reference snapshot. No synced project source is modified.

MiSans: separate Xiaomi license at /rhine/fonts/MiSans-license.pdf and NOTICE.txt.
Rolling Number 0.4.1: /rhine/licenses/rolling-number.txt. Its glyph-measurement
patch is retained in web/scripts/patch-rolling-number.mjs.
Three.js 0.183.2: /licenses/three-MIT.txt.
Outlined Novecento lettering: /licenses/rhine-opening-lettering.txt. Font binaries
are not included. Copyrighted game branding/artwork and the three 38ms typing
samples are not relicensed by MIT; see /rhine/audio/README.md and the credits.

Workflow reference: https://github.com/LBEILC/RhineLabUI-Workflow
Pinned commit: 632bb9588076521ff70b43c986d1710d56e4b037.
The current simultaneous extraction and damped signed selection wave baseline
is used; superseded experiments from the historical workflow are not combined.

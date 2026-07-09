// Empty stub for fabric's optional `canvas` (node-canvas) dependency.
// The Electron renderer draws on Chromium's native canvas, so node-canvas is
// never required at runtime. Replacing it via package.json "overrides" keeps
// electron-builder / @electron/rebuild from trying to source-compile the real
// native module (which needs a Cairo/GTK toolchain and fails on CI runners).
module.exports = {}

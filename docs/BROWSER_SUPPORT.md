# Browser support policy

FileForge uses modern browser APIs and does not promise identical behavior in every browser version. Each operation checks the capabilities it requires and fails with an explicit message instead of producing an incorrectly typed result or weakening validation.

## Required capabilities by operation

| Capability                                            | Operation                           | When missing                                                                                         |
| ----------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Module Web Workers                                    | all heavy operations                | refuse the operation; no main-thread fallback for large tasks                                        |
| `createImageBitmap` + `OffscreenCanvas.convertToBlob` | image conversion                    | refuse image conversion                                                                              |
| `DOMParser`, `XMLSerializer`, DOMPurify               | SVG validation/sanitation           | reject SVG; raster operations remain available                                                       |
| `CompressionStream` `deflate-raw`                     | test fixture generation only        | not required at runtime                                                                              |
| `DecompressionStream` `deflate-raw`                   | DEFLATE ZIP import                  | reject that archive; STORE ZIP import can still work                                                 |
| `crypto.subtle`                                       | small-image duplicate detection     | skip optional duplicate detection; do not reject an otherwise valid image                            |
| `crypto.randomUUID`                                   | preferred operation IDs/history IDs | if unavailable, a non-cryptographic local identifier fallback is used; IDs are never security tokens |
| `URL.createObjectURL`                                 | previews and downloads              | cannot create browser download; user receives an explicit error if absent                            |
| localStorage                                          | theme/history persistence           | continue with system theme and in-memory defaults                                                    |

## Automated browser configuration

`playwright.config.ts` defines Chromium, Firefox, WebKit, Pixel 7 emulation and iPhone 15 emulation. These are automated browser contexts, not physical device certification. E2E tests that require optional APIs detect their absence and are marked skipped for that browser; a skip is not a pass for that capability and should be reviewed in the browser matrix.

## Manual release matrix

Before release, validate current stable Chrome, Edge, Firefox and Safari on desktop; Chrome Android and Safari iOS on physical devices. Include file chooser, drag/drop, actual download and fallback link, long-running operations, cancel, memory pressure, theme, keyboard navigation, VoiceOver/TalkBack, reduced motion, forced colors, 200% zoom and 320 CSS-pixel viewport.

Record browser version, OS version, device model, result, defect and reproducible steps in the release report. Do not claim support for an engine/device that has not been tested.

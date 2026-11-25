> Historical snapshot from the FileForge 5.3/5.4 audit cycle. Values and implementation notes in this report describe that earlier version; the active capacity policy is defined in `docs/LIMITS.md` and `src/core/config.ts` (5.5.2).

# FileForge 5.4.2 — fourth reliability and security audit

## Scope

This pass re-opened the 5.4 source tree and the earlier audit findings. The guiding decision was to remove avoidable attack surface and make release checks executable rather than add code for its own sake.

## Findings addressed

### 0. Raster image header validation was not equally strict across formats

**Finding:** PNG had an IHDR CRC check, but BMP validation did not confirm that the pixel-data offset was after the DIB metadata; WebP dimension parsing did not check the first image chunk length; JPEG SOF validation did not ensure that the component count matched the segment length.

**Change:** BMP preflight now accepts only standard DIB sizes (40, 52, 56, 108 or 124 bytes), requires the DIB header to fit the file and validates the pixel offset. WebP preflight checks RIFF length and the VP8X/VP8L/VP8 chunk minimum or exact size before reading dimensions. JPEG SOF preflight validates the component count and exact segment length. These checks reject malformed variants before native image decoding. Regression cases cover valid and malformed BMP, WebP and JPEG headers.

### 1. Production Content Security Policy was broader than necessary

**Finding:** the published HTML allowed WebSocket connections to localhost, `data:` images/fonts and blob Workers. The WebSocket exception is needed for local Vite HMR, not for the deployed application. Blob image URLs are used for local previews and downloads; Workers are emitted as same-origin module assets.

**Change:** production `index.html` now restricts `connect-src`, `worker-src` and `font-src` to `'self'`, allows only same-origin and Blob images, and disables form submission. A Vite plugin adds `ws://127.0.0.1:*` only when running the development server. The Vite server binds to loopback with a strict port. This does not replace response-header protections; GitHub Pages meta CSP cannot set `frame-ancestors`.

**Regression protection:** five Vitest source-policy tests check the production policy and the serve-only HMR exception. `scripts/check-production-csp.mjs` inspects the actual `dist/index.html` after a production build and makes the build fail if the policy contains a development WebSocket, `data:`, `unsafe-eval`, unexpected worker or network sources.

### 2. Dependency audit threshold was too permissive

**Finding:** `npm audit --audit-level=high` did not fail on low or moderate published advisories.

**Change:** the release audit gate now uses `--audit-level=low`. Any advisory severity causes a non-zero result and needs explicit review. The actual npm audit was not run in this environment because registry access and an installed dependency graph were unavailable.

### 3. Source manifest ordering depended on locale collation

**Finding:** `localeCompare(..., 'en')` is locale/ICU-sensitive. A generated hash manifest should not depend on the runner's locale implementation.

**Change:** manifest paths are now ordered using deterministic code-unit comparison. The manifest is regenerated from exact source bytes and verified before delivery.

### 4. ZIP central-directory parser work is bounded earlier

**Finding:** accepting and scanning the remainder of an archive after the merge file limit had been exceeded was unnecessary work.

**Change:** the parser rejects immediately on file entry 51, because the merge workflow supports at most 50 files. A regression test explicitly checks the 51st entry. The independent runtime harness also confirms the file-count ceiling.

### 5. Text-editor responsiveness

**Finding:** measuring UTF-8 size and code points on every input event could repeatedly traverse a multi-megabyte string.

**Change:** editor statistics are debounced by 220 ms. Export validation still occurs before creating a result, so debounce does not weaken the byte or Unicode limit.

### 6. ZIP merge temporary memory

**Finding:** extracted bounded ZIP entries were copied into an additional full-size ArrayBuffer solely for TextDecoder input.

**Change:** TextDecoder accepts the bounded Uint8Array directly. An abort check is performed after extraction and before decoding. Source files and bounded output buffers still coexist; no claim is made that the browser has a guaranteed memory budget.

### 7. Test cases that were testing the wrong limit

**Finding:** two JSON/HTML output-expansion tests originally supplied 9 MiB of input while the editor limit is 5 MiB. They would reject at the input boundary instead of verifying output expansion.

**Change:** test fixtures now use 5 MiB input, which fits the input ceiling but expands beyond the 25 MiB output ceiling. The expected output-limit assertion is now meaningful.

### 8. Dependency-lock bootstrap ordering

**Finding:** npm caching was enabled in the workflow whose first task is to create the lockfile. Cache-key discovery could fail before the lockfile existed.

**Change:** the prepare-lockfile workflow does not request npm caching until a lockfile is available. It generates the lock using the pinned npm, runs checks and uploads the lock, refreshed source manifest and SBOM as a reviewable artifact. This workflow has not been executed here.

## Reliability properties carried forward and rechecked

- Bounded file-count, per-file, aggregate, decompressed-output and decoded-pixel limits are centralized in `src/core/config.ts`.
- ZIP parser supports a deliberately small subset: conventional single-volume non-encrypted ZIP, STORE and DEFLATE, UTF-8/ASCII names. ZIP64, encryption, multi-volume, unsupported flags/methods and ambiguous names fail closed.
- ZIP entries are checked for header consistency, path traversal, file/directory collision, overlap, descriptor, actual output length and CRC32.
- ZIP import is atomic per archive; a corrupted selected text entry does not leave a partially imported archive behind.
- SVG sanitation fails closed when DOMPurify is unavailable and rejects DTD/entities and disallowed active/external references.
- Image headers are checked before native decoding; actual decoded dimensions are checked again before canvas allocation. Bitmap/canvas resources are released promptly.
- Image output MIME is checked; Canvas output is limited to PNG/JPEG/WebP. Animation preservation is not promised.
- TXT/Markdown preserve user text; HTML escapes it; JSON is one string; CSV is faithfully quoted but formula-like values produce a warning; XML rejects invalid XML 1.0 characters.
- User-controlled content is inserted into UI through DOM properties/text nodes, not interpolated into HTML. The only `innerHTML` assignment uses the fixed static application template.
- History is metadata-only, size-bounded and runtime-validated. Storage failures do not block file processing.
- Workers have timeout/cancellation/termination paths; heavy workflows are serialized; image-batch preparation cancellation is atomic.

## Checks actually performed

- Strict static TypeScript check across `src/`, `tests/`, `e2e/`, Vite and Playwright configuration: no diagnostics using globally installed TypeScript 5.8.3 plus temporary declarations for unavailable third-party packages. This is not the pinned TypeScript 7.0.2 compile with real library types.
- 29 independent runtime checks passed against transpiled core/engine modules under Node 22.16.0. ZIP DEFLATE fixtures use Node's built-in raw-DEFLATE implementation; real JSZip-generated archives were not tested here.
- Five CSP source-policy tests were added; they are present in the 95 declared Vitest cases but were not executed by Vitest.
- `node --check` passed for all project `.mjs` scripts.
- Project JSON files parsed. GitHub Actions YAML files parsed.
- The production CSP verification script was smoke-tested against the current source HTML copied into a temporary `dist/index.html`, and a deliberately broadened CSP was rejected. This is a test of the verifier only, not a Vite production build.
- Playwright is now configured to test the built production bundle through `vite preview`; CI/deploy build before E2E. The workflows install and assert the pinned npm version explicitly, and the missing-lock guard runs before npm cache setup.
- The final SHA-256 manifest and full-project ZIP were regenerated and independently checked after all source changes.

## Not verified — do not infer success

- No `npm ci`; no genuine `package-lock.json` is included.
- No real Vitest, Biome, pinned TypeScript 7.0.2, Vite production build or `npm audit` run.
- No SBOM generated from an installed final dependency graph.
- No Playwright/axe run in Chromium, Firefox or WebKit; the 16 E2E cases are prepared, not proven passing.
- No physical Android/iOS or low-memory device tests; no long-run memory profiling.
- No real DOMPurify adversarial SVG corpus test; the Node runtime harness used a stub only to load text/core modules.
- No deployed GitHub Pages CSP response-header or production network trace was verified.

## Release decision

**Status: hardened engineering candidate, not a certified production release.** The source now has stronger production CSP controls and a build-time CSP guard, a stricter audit threshold, a deterministic manifest generator, 95 unit/integration test cases and 16 browser E2E cases. However, the real dependency lock/install, all test runners, build, audit, browser matrix and device profiling remain external release gates. It would be inaccurate to claim verified Staff/Production quality until those gates pass and their evidence is reviewed.

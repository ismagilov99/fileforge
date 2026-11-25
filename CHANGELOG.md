# Changelog

## 5.5.2 — ZIP import folder-limit consistency and input-validation hardening

- Fixed the ZIP import folder-count bug: the parser now uses `LIMITS.merge.maxFolders` (150) for both the comparison and the user-facing error text instead of a stale hardcoded 100.
- Kept ZIP creation and ZIP import folder limits tied to one `MAX_ZIP_FOLDERS` constant; added configuration and boundary regression tests for exactly 150 accepted and 151 rejected explicit directory entries.
- Rejected malformed ZIP directory records with non-zero compressed/uncompressed sizes, non-zero CRC32 or a non-STORE method. The direct bounded extractor repeats this integrity check for directory metadata it receives outside the normal parser path.
- Corrected merge preflight counting: unsupported non-text files inside a ZIP are skipped and no longer consume the 100-file merged-text allowance. Supported text entries remain subject to the same hard limit before extraction.
- Centralized basename-based extension detection. Dots in parent folders no longer corrupt extension detection for ZIP entries; extensionless `Dockerfile`/`Makefile` and dotfiles such as `.gitignore` are recognized consistently by validation, merge and archive sorting.
- Hardened the text export Worker boundary against invalid runtime payload types and unsupported format values; merge export validates content/metadata sizes rather than trusting structured-clone input types.
- Added regression coverage for the reported ZIP folder-limit mismatch, the exact folder boundary, malformed directory CRC, invalid Worker payloads, dotted parent paths, extensionless text files and mixed text/non-text ZIP imports.
- Updated the active threat model and implementation status. Runtime checks listed in the delivery report were executed independently under Node; the pinned npm toolchain, Vitest, Biome, Vite build, Playwright and device checks remain unverified in this authoring environment.

## 5.5.1 — restore original capacity values and remove remaining undersized caps

- Restored original input limits: 150 images/archive files, 50 MiB per file, 400 MiB aggregate image/archive input, 10 MiB text input, 100 MiB ZIP input, 100 merge files, 50 MiB per merge text file/entry and 30 MiB merged output; retained the original 8,192 px canvas and 92% default quality.
- Raised image preflight to 67,108,864 pixels and 65,535 px input side so a full 8,192 × 8,192 output canvas is no longer blocked. Restored SVG input to the original 50 MiB per-image allowance (the interim 5 MiB internal cap is removed).
- Increased archive folder capacity to 150 and synchronized archive UI, ZIP parser and tests.
- Retained bounded output sizes, CRC32 validation, decompression-ratio guard, path validation, fail-closed checks, workers and cancellation.
- Added regression tests for the restored configuration profile and changed the UI hints to read directly from the central configuration.
- Documented the restored profile and the distinction between server load and client-side memory in `docs/LIMITS.md`.

## 5.4.2 — production E2E and pinned toolchain

- Changed Playwright's web server from the Vite development server to `vite preview`, so browser tests exercise the production bundle and production CSP.
- Reordered lockfile preparation and deployment workflows so production build completes before browser E2E tests.
- Explicitly install and verify npm 11.19.1 in all GitHub workflows; Node 24.22.3 and npm 11.19.1 are now checked, not merely assumed from `setup-node`.
- Moved the missing-lock check before npm cache setup in CI and deployment, producing a clear intentional failure instead of a cache-key error.
- Removed a non-enforceable `Permissions-Policy` meta tag; documented that the policy requires a response header and added a regression test to prevent a false security signal.
- Added a runtime iframe guard and a Playwright case because meta CSP cannot set `frame-ancestors` on GitHub Pages.
- Added a fifth audit follow-up and updated implementation evidence to reflect 29 independent runtime checks and the 95 unit/integration plus 16 browser test cases prepared.

## 5.4.1 — production CSP and reproducible source integrity

- Removed the local-development WebSocket exception from the production Content Security Policy; Vite adds the loopback-only HMR permission in serve mode only.
- Removed unnecessary `data:` image/font and blob Worker sources; retained Blob images for local previews/downloads and same-origin module Workers.
- Restricted HTML forms with `form-action 'none'`; FileForge does not submit user files or data to a form endpoint.
- Added a post-build CSP verifier so production builds fail if the generated HTML broadens network, script or worker sources.
- Tightened dependency audit severity gate from high to low; any published advisory severity blocks the release pending review.
- Made source-manifest ordering bytewise deterministic instead of locale-sensitive.
- Added source-level regression tests for the production CSP and dev-only HMR exception.
- Tightened BMP pixel offset/DIB version checks, WebP chunk-length checks and JPEG SOF component-table validation before native decoding.

## 5.4.0 — third audit, conservative resource budgets and runtime hardening

- Reduced default resource budgets for image conversion, archive creation, text export and ZIP/text merge to lower peak-memory risk on mobile devices. These are application limits, not a guarantee against browser/OS out-of-memory termination.
- Added a bounded history-storage parser and runtime validation for callers and stored metadata; malformed or oversized localStorage content is ignored without blocking file operations.
- Replaced per-keystroke Blob allocation and `Array.from()` character allocation with a single-pass UTF-8/code-point counter; malformed UTF-16 is reported and export is blocked rather than silently rewritten.
- Added per-batch compressed input limits before reading merge files, capped skipped-entry detail memory while retaining an exact skip count, and removed an unnecessary Blob allocation when measuring decoded UTF-8 source bytes.
- Tightened image header preflight for PNG IHDR CRC, GIF signature, BMP header size and WebP RIFF declared length; retained a second pixel/dimension check after native decode in the Worker.
- Release image bitmap and OffscreenCanvas backing storage promptly after each conversion.
- Validate download basenames at the final download boundary; invalid path-like/control names cannot be passed to the browser download attribute.
- Added `.npmrc` `engine-strict=true` and removed npm-cache lookup from the lockfile-bootstrap workflow so it can run before a lockfile exists.
- Corrected documentation to match the actual 5.4 resource limits and the Node/npm runtime pinned by CI.
- Added regression tests for history tampering, impossible File-like sizes and large ZIP batches with capped skip details.
- Added an explicit `Prepare dependency lock` GitHub Actions workflow. It generates a real lockfile with npm on a compatible runner, runs release checks and uploads lockfile, manifest and SBOM for review; no lockfile is fabricated in the authoring environment.
- Added a third-audit report and updated implementation status. Actual pinned npm install, Vitest, Biome, Vite build, Playwright, npm audit, SBOM and physical-device tests remain release gates until they are executed in the runner/device environment.

## 5.3.0 — second deep-audit hardening

- Corrected the SBOM script to use npm 10's stdout output instead of the unsupported `--output-file` option.
- Changed Vite dev/preview defaults to loopback (`127.0.0.1`) so the development server is not exposed to the local network by default.
- Reviewed the current Vite GHSA-p4f5-76q4-ffq7 advisory: pinned Vite 8.3.8 is above the patched 8.3.7 version; network exposure is still avoided by default.
- Extended independent runtime checks for the text/merge engine and synchronized filename previews with the selected output format.
- Added explicit PNG IHDR chunk validation and a hard count for explicit ZIP directory entries.
- Added accessible progressbar semantics for indeterminate operations.
- Enforced the 100-unique-folder limit across both explicitly created folders and folders assigned to files; added a regression test for the combined limit.

- Centralized operation exclusion now includes image and merge preparation, not only final processing; overlapping heavy workflows are rejected consistently.
- Added cancellation for image-batch preparation and SHA-256 duplicate checks. Cancelling is atomic: the incoming batch is not partially committed and previously selected images remain intact.
- Corrected the CSV formula-injection warning. CSV bytes remain faithful to the source; the interface explicitly warns that spreadsheet applications may interpret leading `=`, `+`, `-` or `@` as formulas.
- Hardened drag-and-drop `dragleave` handling for non-Node `relatedTarget` values.
- Avoided an unnecessary copy of compressed ZIP entry bytes before streaming decompression.
- Added a documented non-cryptographic identifier fallback for environments without `crypto.randomUUID()`; these identifiers are not security tokens.
- Expanded tests for operation-state exclusion, cancellation, CSV formula-like values, fallback IDs and 320 px mobile layout.
- Strengthened the deploy workflow so production publication also requires browser E2E tests.
- Added a second-audit report listing verified fixes and remaining release blockers.

## 5.2.0 — deep-audit hardening

- Split all major UI responsibilities into focused modules; kept `main.ts` as a composition root.
- Added dedicated Workers for image conversion, text export/merge output, ZIP creation and ZIP/text input preparation.
- Added worker timeout, cancellation and cleanup handling for image conversion.
- Fixed archive file/directory path conflicts so an output ZIP cannot contain an entry that is both a file and a parent directory.
- Added regression tests for archive path collisions and additional real-browser image conversion flow.
- Made output-name preview deterministic: the filename shown before download is the filename actually used; a new automatic suggestion is prepared for the next run.
- Added a browser E2E case for automatic output naming and narrow-viewport overflow.
- Updated release, architecture, threat-model, browser, accessibility and performance documentation.
- Tightened CI release gate: no lockfile means CI/deploy intentionally stop.

## 5.1.0 — engineering hardening

- Added UI module separation and centralized operation state.
- Moved ZIP/text export, archive creation and merge-input preparation into dedicated Web Workers.
- Removed fabricated progress percentages from text export.
- Added ZIP DEFLATE, data-descriptor, archive-creation and history test coverage.
- Added SHA-256 duplicate detection for small images and stricter image signature/extension validation.
- Added visible manual download fallbacks, Playwright/axe configuration, Biome and SHA-256 manifest tooling.

## 5.0.0 — modular TypeScript rebuild

- First rebuild of the original single-file application using TypeScript and Vite.
- Preserved local-first file processing and four initial workflows.

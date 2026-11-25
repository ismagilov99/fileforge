# FileForge 5.4.2 — fifth audit follow-up

## Objective

This follow-up focused on the last release-readiness gaps rather than adding product features. The main goals were to make browser E2E exercise the exact production bundle and make the CI toolchain deterministic.

## Additional issues found and corrected

### 1. A non-enforceable Permissions-Policy meta tag created a false security signal

**Risk:** the source contained `meta http-equiv="Permissions-Policy"`. Permissions Policy is delivered as an HTTP response header; MDN documents the header and iframe `allow` attribute as its mechanisms, and the supported `meta http-equiv` values do not include Permissions-Policy. The tag therefore could not be relied upon to disable those capabilities.

**Correction:** removed the unsupported meta tag, added a regression test to prevent its reintroduction, and documented that the current app does not call camera, microphone, geolocation, payment or USB APIs. If a deployment needs a Permissions Policy, it must be configured by a host/CDN capable of sending response headers.

Sources: MDN [Permissions Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Permissions_Policy) and [meta http-equiv](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/http-equiv).

### 2. Meta CSP cannot set frame-ancestors on GitHub Pages

**Risk:** the meta policy's `frame-src 'none'` restricts frames created by FileForge; it does not prevent another site from embedding FileForge. The required `frame-ancestors` control is unavailable in a meta CSP.

**Correction:** the application now refuses to initialize when `window.top !== window.self` and displays a clear message. This is defense in depth only; it does not replace the `frame-ancestors`/`X-Frame-Options` HTTP response headers a configurable host should set. A Playwright E2E case is prepared for framed use.

### 3. Browser E2E previously targeted Vite development mode

**Risk:** Playwright's web server used `vite --host`, which meant E2E verified the development server, including its HMR behavior, rather than the built bundle that GitHub Pages would publish. It could miss broken hashed asset paths, build-only behavior and production CSP regressions.

**Correction:** Playwright now starts `vite preview` on loopback. CI, Deploy and lockfile-bootstrap workflows run the production build before E2E. The test suite now exercises the actual `dist` artifact.

**Verification status:** configuration and workflow ordering were inspected and parsed; Playwright itself was not run because the package installation and browser binaries are unavailable in this authoring environment.

### 4. The npm toolchain was specified but not actively pinned in GitHub Actions

**Risk:** `actions/setup-node` selects Node but does not guarantee the project-specific npm version declared in `packageManager` and `engines`. A runner-bundled npm release could differ from the version used to create `package-lock.json`.

**Correction:** each workflow explicitly installs npm 11.19.1 and asserts both Node `v24.22.3` and npm `11.19.1`. CI and Deploy now check for `package-lock.json` before invoking `setup-node` with npm caching, so a missing lock produces the intended diagnostic rather than an early cache-key failure.

**Verification status:** workflow YAML parsed successfully; the GitHub-hosted workflow has not been run.

### 5. Production preview requires a completed build

**Risk:** changing Playwright from a dev server to `vite preview` means a standalone `npm run test:e2e` requires `dist` to exist.

**Correction:** README documents the required `npm run build` step; the release workflows build before E2E. The full `npm run verify` sequence also builds before starting Playwright.

## Existing code hardening rechecked in this pass

- Single-pass UTF-8/code-point counting avoids allocating a Blob and a copied character array on each text input event.
- History is read only after a serialized-size ceiling is checked; runtime validation rejects malformed metadata and history remains optional.
- ZIP merge validates aggregate compressed input before reading, limits the number/size of files and directories, bounds actual decompressed bytes and verifies CRC32.
- The ZIP parser rejects unsupported ZIP64, encryption, multi-volume archives, unsupported flags, unsafe names, path collisions, overlapping records and malformed descriptors.
- PNG IHDR CRC, GIF signatures, BMP DIB/pixel offsets, WebP RIFF/chunk lengths and JPEG SOF component tables are checked before native image decoding. The image Worker checks actual decoded dimensions again before canvas allocation.
- Worker operations have cancellation, timeouts and termination paths. Heavy workflows are serialized to reduce simultaneous memory spikes.
- Production CSP is same-origin for scripts, connections and Workers; Blob URLs are allowed only for locally created image previews/downloads. A post-build verifier checks the generated `dist/index.html` and a serve-only HMR exception is added by Vite only in development.
- The full UI template is static; user content is inserted through text/value properties or binary Blobs. No runtime user content is interpolated into `innerHTML`.

## Checks performed

- Strict static TypeScript check completed without diagnostics for application, tests, E2E and Vite/Playwright configuration, using the global TypeScript 5.8.3 compiler and temporary ambient declarations for unavailable external packages. This is not a run with the pinned TypeScript 7.0.2 and actual dependency type declarations.
- 29 independent runtime checks passed against transpiled core/engine modules under Node 22.16.0. The checks cover text metrics and exports, filename/path validation, image header parsing for PNG/GIF/BMP/JPEG/WebP, ZIP STORE/DEFLATE bounds and CRC, aggregate limits and history validation.
- The temporary runtime harness used a DOMPurify stub only to load the module in Node. It did not test real SVG sanitation or adversarial DOM payloads.
- Project JSON files and all GitHub Actions YAML files parse successfully. Project `.mjs` scripts pass `node --check`.
- Production CSP verifier positive/negative smoke checks passed against a temporary `dist/index.html` copied from source HTML. This verifies the checker logic, not a real Vite production build.
- Current source contains 95 Vitest unit/integration test declarations and 16 Playwright/axe E2E test declarations. Their presence does not establish that they pass.

## Not performed

- No `npm ci`; no authentic `package-lock.json` was generated because npm registry access was unavailable. A hand-written lockfile would not be trustworthy and was not created.
- No run with pinned Node 24.22.3/npm 11.19.1/TypeScript 7.0.2 and actual package declarations.
- No actual Vitest, Biome format/lint, Vite production build, npm audit or SBOM from an installed dependency graph.
- No Playwright run against the production preview; no browser-level axe results.
- No real JSZip dependency runtime verification in this environment; ZIP runtime fixtures were created independently with Node raw-DEFLATE.
- No physical Android/iOS, desktop browser matrix, screen-reader, low-memory, repeated-operation or memory-leak profiling.
- No production GitHub Pages deployment, response-header CSP or final network trace.

## Release checklist

- [x] Browser E2E configuration targets the production preview, not the dev server.
- [x] Release workflows build before running Playwright.
- [x] Node and npm versions are explicitly installed and asserted by each workflow.
- [x] Missing-lock detection occurs before npm cache setup in CI and Deploy.
- [x] Static TypeScript check completed in the available authoring environment.
- [x] 29 independent runtime checks completed successfully.
- [x] JSON/YAML parsing and Node syntax checks completed.
- [x] Production CSP verifier positive and negative smoke checks completed.
- [x] Removed unsupported Permissions-Policy meta declaration and added a regression test.
- [x] Added a framed-context initialization guard and a browser E2E case.
- [ ] Generate and commit a genuine `package-lock.json` from the pinned toolchain.
- [ ] Run `npm ci`, Biome, pinned typecheck, Vitest, Vite build and npm audit.
- [ ] Run all 16 Playwright/axe scenarios on the production bundle.
- [ ] Verify the published Pages artifact and production CSP/network behavior.
- [ ] Complete physical-device, accessibility and memory-pressure testing.

## Decision

**FileForge 5.4.2 remains a hardened engineering candidate, not a verified production release.** This pass closed tooling and E2E-targeting gaps in the source configuration, but it cannot substitute for running the pinned toolchain and browser matrix. No claim of Staff-level production certification is made.

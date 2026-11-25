> Historical snapshot from the FileForge 5.3/5.4 audit cycle. Values and implementation notes in this report describe that earlier version; the active capacity policy is defined in `docs/LIMITS.md` and `src/core/config.ts` (5.5.2).

# FileForge 5.4.1 — third deep audit report

## Audit purpose

This pass starts from the 5.3 delivery and the external review supplied by the owner. The goal is not to increase code volume or force support for every format. The goal is to reduce failure modes, memory spikes, silent data changes and misleading success states. Unsupported or unverified behavior is deliberately rejected instead of receiving a fragile fallback.

## Findings addressed in this pass

### 1. Resource use in the text editor

**Finding:** UTF-8 byte and code-point statistics traversed the complete textarea value on every `input` event. With a multi-megabyte paste or repeated typing, this could trigger repeated long main-thread scans.

**Change:** the editor now debounces metric calculation by 220 ms. Export still validates synchronously in the Worker path before a result is created; the delay affects the informational counter, not data validation. The 5 MiB input limit remains unchanged.

### 2. ZIP central-directory work

**Finding:** declared file count was checked after scanning the central directory. The archive-level limit is low, so rejecting at the first excess file is simpler and bounds parser work earlier.

**Change:** the parser rejects as soon as it sees file entry 51 (the merge limit is 50 files). The existing total-entry, directory-entry, range and declared expansion checks remain in place. A regression test was added for file entry 51.

### 3. Avoidable memory copy during ZIP text import

**Finding:** after bounded extraction, the code copied each extracted `Uint8Array` into a new `ArrayBuffer` solely to pass it to `TextDecoder`.

**Change:** the UTF-8 decoder accepts the bounded `Uint8Array` directly. An abort check also runs between extraction and decoding. The original ZIP and bounded decoded entry are still in memory, but the additional copy of each entry is removed.

### 4. Incorrect output-expansion test fixtures

**Finding:** two tests intended to prove early rejection of JSON/HTML output expansion used 9 MiB input while the actual editor input ceiling is 5 MiB. They would fail at the input validator, not at the output estimator. Their expected error also referenced an obsolete 50 MiB limit.

**Change:** fixtures now use exactly 5 MiB source text, which is within the input ceiling. JSON control-character expansion and HTML quote escaping then exceed the real 25 MiB output ceiling. The tests assert the correct output-limit message.

### 5. Dependency lock bootstrap ordering

**Finding:** `actions/setup-node` in the lock preparation workflow was configured with npm caching even though the workflow's purpose is to create the first `package-lock.json`. Depending on setup-node behavior, cache-key discovery could fail before the lock-generation step.

**Change:** the bootstrap workflow no longer enables npm cache before the first lockfile is created. Normal CI and Deploy retain npm caching after the lockfile is committed and explicitly fail if it is absent.

### 6. History data boundary

**Finding:** `localStorage` is not a trusted database, and typed interfaces do not validate runtime values. History must remain optional and must not break file operations when storage is corrupt, oversized or quota-limited.

**Change carried forward and rechecked:** serialized payload length is checked before JSON parsing; individual records are validated for operation, timestamp, counters, filename, Unicode, path separators, controls and bidi controls. `saveHistory` validates caller data at runtime and ignores storage failures. History remains metadata-only.

### 7. Image decoder preflight and cleanup

**Finding:** image signatures alone are insufficient to bound decoder inputs. A malformed header may claim enormous dimensions or disagree with file structure.

**Change carried forward and rechecked:** PNG IHDR length/type and CRC are checked; GIF signature and logical dimensions are checked; BMP requires a supported DIB header; WebP RIFF length must match the file and recognized VP8 variants supply dimensions. The Worker checks actual decoded bitmap dimensions before canvas creation, processes one image at a time and closes the bitmap/resets canvas backing dimensions in `finally`.

**Residual risk:** the browser's native decoder may allocate memory before `createImageBitmap` resolves. Browser/OS memory use cannot be fully controlled by application JavaScript.

### 8. Text byte preservation and output shape

**Finding:** output wrappers and format-specific escaping can change representation; the product must distinguish exact text formats from structured formats.

**Change carried forward and rechecked:** TXT/Markdown contain only the entered text; malformed UTF-16 surrogates are rejected rather than silently replaced. HTML source text is escaped. JSON round-trips as one string. CSV quotes the field and warns about spreadsheet formula interpretation without mutating the user's value. XML rejects characters that XML 1.0 cannot represent.

### 9. Filename handling at the download boundary

**Finding:** validation at input widgets is not sufficient; the final download API is the last point before the browser receives a filename.

**Change carried forward and rechecked:** download names must be non-empty, bounded, well-formed Unicode, NFC-normalized and free of path separators, controls, bidi override/isolation characters and trailing dot/space. The chosen format owns the extension.

### 10. Production Content Security Policy

**Finding:** the static CSP permitted WebSocket connections to localhost in the published site, even though those connections are needed only for the local Vite development server. The policy also allowed `data:` images/fonts and blob workers although the app uses Blob URLs for image/download previews and same-origin module Workers.

**Change:** the production policy now uses `connect-src 'self'`, `worker-src 'self'`, `font-src 'self'`, `img-src 'self' blob:` and `form-action 'none'`. A Vite plugin adds the narrowly scoped `ws://127.0.0.1:*` source only in serve mode for HMR. The dev server binds to loopback and a strict port. The policy remains a meta CSP; hosting-level response headers and `frame-ancestors` still require deployment configuration and are not claimed.

### 11. Dependency audit gate

**Finding:** `npm audit --audit-level=high` allowed low and moderate advisories to pass the release gate.

**Change:** the release gate now fails for any published advisory severity (`--audit-level=low`). The actual audit still must run in the lockfile workflow and cannot be considered passed until it produces a result from the resolved dependency graph.

## Deliberate feature restrictions

The following behaviors are intentionally not implemented as fallbacks:

- GIF and BMP output through Canvas is not offered because the browser Canvas encoder does not guarantee those encoders. Input GIF/BMP may be rasterized to one supported static output.
- GIF/WebP animation is not preserved through static conversion.
- ZIP64, multi-volume and encrypted ZIP are rejected.
- ZIP DEFLATE import requires `DecompressionStream('deflate-raw')`; no unbounded or in-memory decompression fallback is used.
- Unsupported ZIP filename encodings and compression methods are rejected.
- Files are not uploaded to a FileForge backend; no server-side conversion is claimed.
- No antivirus/malware-scan claim is made.

These restrictions are deliberate reliability choices, not unfinished fallbacks.

## Checks performed for this pass

- Strict static TypeScript check completed without diagnostics using the globally available TypeScript 5.8.3 compiler and temporary external-package declarations. This does not validate against the pinned package compiler and actual library types.
- 25 independent runtime checks passed against transpiled core/engine modules under Node 22.16.0. The harness covers text encoding, file-name/path validation, image-header parsing, text exports, ZIP STORE/DEFLATE extraction, CRC mismatch, aggregate input rejection, bounded skip details and history.
- The text harness used a temporary DOMPurify stub solely to load the text/validation module. It did not test real SVG sanitization.
- All three GitHub Actions YAML files parsed successfully; package, TypeScript and Biome JSON configurations parsed; both project `.mjs` scripts passed Node syntax checks.
- The source tree, manifest and final ZIP must be checked after packaging; their exact results are recorded in the final delivery.

## Not verified — do not infer success

- Actual `npm ci`, lockfile resolution, real Vitest suite, Biome, Vite build, `npm audit` or SBOM.
- Actual Playwright/axe browser runs, including the newly added cancellation E2E case.
- Real JSZip-generated archives in an installed dependency environment; the independent runtime fixture uses Node's built-in raw DEFLATE.
- Real DOMPurify sanitization of an adversarial SVG corpus.
- Physical Android/iOS, Safari, Firefox, Edge, memory stress or production deployment checks.

The environment used for this pass could not connect to npm registry. The repository therefore has no genuine `package-lock.json`. The prepared GitHub Actions lock workflow is the supported reproducible path; it has not been executed yet.

## Final assessment

The third pass closes several correctness, resource-use and process defects and adds regressions for the most material ones. It improves the engineering candidate, but it does not certify Staff level, production readiness, or zero bugs. That requires a reproducible install, the real pinned toolchain, green CI, actual browser/device evidence, a reviewed dependency audit and measured memory behavior.

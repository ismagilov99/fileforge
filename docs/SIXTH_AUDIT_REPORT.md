# FileForge 5.5.2 — sixth deep-audit report

**Scope:** the complete 5.5.1 source tree, the external review supplied by the owner, the current configuration, ZIP parser/extractor, merge engine, text export engine, unit/integration tests and active documentation.

## Executive summary

The owner-provided review identified a reproducible mismatch: ZIP import used a hardcoded folder ceiling of 100 while the active configuration and test expected 150. This was a real bug. It is fixed and covered by positive and negative boundary tests.

The additional pass found three more defects/risks in active code: (1) a ZIP merge precheck counted unsupported non-text entries against the supported-text output-file ceiling; (2) extension detection could be influenced by dots in a parent directory name; and (3) the text export Worker boundary relied too heavily on TypeScript types, although structured-clone messages are runtime data and can be malformed. These paths were hardened and regression tests were added.

## Findings and changes

### 1. ZIP import folder count diverged from configuration — fixed

**Before:** `src/core/zip-security.ts` rejected the 101st explicit directory entry and displayed a hardcoded 100. `src/core/config.ts`, `docs/LIMITS.md` and `tests/zip-security.test.ts` defined the active import limit as 150.

**After:** ZIP creation and ZIP import share `MAX_ZIP_FOLDERS = 150` through `LIMITS.archive.maxFolders` and `LIMITS.merge.maxFolders`. The ZIP parser compares against `LIMITS.merge.maxFolders` and interpolates that same value in its error text.

**Regression tests:** `tests/config.test.ts` asserts the two workflow values are equal and equal to 150. `tests/zip-security.test.ts` verifies exactly 150 explicit directory entries are accepted and 151 are rejected with the configured error text.

### 2. Unsupported ZIP entries consumed the merge text-file quota — fixed

**Before:** the ZIP merge preflight used every non-directory ZIP entry in its preliminary count, even though unsupported image/binary entries are skipped later. A ZIP with a single supported `.txt` and an unsupported `.png` could be rejected when the current merge list was at 99 files.

**After:** preliminary count uses only `TEXT_EXTENSIONS` entries, resolved with the shared basename extension helper. The parser still applies its independent total ZIP file-entry cap, and the import path checks the actual number of decoded supported text files again before committing the archive atomically.

**Regression test:** `tests/merge.test.ts` prepares 99 direct text files plus a ZIP containing one unsupported PNG and one supported TXT; the result has exactly 100 merged text files and one skipped entry.

### 3. Dots in parent directories corrupted extension detection — fixed

**Before:** extension parsing based on splitting the full path at `.` could misclassify `folder.with.dots/Dockerfile` and other extensionless basenames.

**After:** `getFileExtension()` isolates the basename before inspecting its suffix. It supports extensionless names only where the allowlist explicitly recognizes them (`Dockerfile`, `Makefile`, etc.) and retains dotfile behavior such as `.gitignore`. The helper is reused in validation, merge, text language detection and archive sorting.

**Regression tests:** `tests/file-names.test.ts`, `tests/archive.test.ts` and `tests/merge.test.ts` cover dotted parent folders, extensionless filenames and dotfiles.

### 4. ZIP directory record integrity — hardened

The central-directory parser now rejects directory entries containing non-zero compressed or uncompressed data, a non-zero CRC32 or a non-STORE method. `extractZipEntryBounded()` independently verifies the same metadata when it receives a directory entry object. This prevents malformed directory records from being silently treated as harmless empty folders.

**Regression test:** `tests/zip-security.test.ts` creates a directory record with a non-zero CRC and expects preflight rejection.

### 5. Runtime validation at the text/merge export boundary — hardened

`convertText()` explicitly validates that runtime text is a string and that the selected format is supported. `mergeTextFiles()` revalidates format, input array/count, the `includeNames` flag, item/name/content types, well-formed Unicode, UTF-8 byte-size metadata, per-entry size and aggregate size. This protects the Worker boundary from malformed structured-clone input or modified in-memory state; compile-time TypeScript declarations alone are insufficient for runtime data.

**Regression tests:** `tests/text.test.ts` includes invalid non-string payload, unsupported format and inconsistent byte-size cases.

### 6. Active threat-model language — corrected

`docs/THREAT_MODEL.md` no longer describes the 5.4 reduced file/aggregate/pixel budgets. It describes the restored original capacity values plus independent integrity checks and the remaining browser-native decoder memory limitation.

## Verification performed in this authoring environment

- Strict TypeScript 5.8.3 source check over `src/`: passed with temporary ambient declarations for external dependencies. This does not validate real package declarations or the pinned TypeScript 7.0.2 compiler.
- Independent Node 22.16.0 runtime harness: 20 checks passed. Tested text formats and invalid runtime payload, extension resolution, merge count/size validation, STORE and raw DEFLATE ZIP extraction, 150/151 explicit directory boundary, malformed directory CRC, forged STORE metadata rejection before copying, CRC mismatch and the 99-direct-text-plus-one-supported-ZIP-entry merge case.
- Vitest tests currently contain 114 `it(...)` declarations; Playwright contains 16 test declarations. Neither runner was executed.
- Full package installation/build/browser verification could not be performed: no `package-lock.json`, no cached declared packages, no npm registry access from the authoring environment, and local Node/npm are older than the versions pinned in the repository.
- ZIP, Markdown full-source export and `MANIFEST.sha256` are generated and cross-checked before delivery.

## Remaining release gates (not claimed as completed)

- Generate and commit a real `package-lock.json` with Node 24.22.3/npm 11.19.1 using the repository lockfile workflow.
- Run `npm ci`, `npm run check`, `npm run build`, `npm run test:e2e` and `npm run audit` on the locked dependency graph.
- Verify the production preview with Chromium, Firefox, WebKit and axe; check deployed GitHub Pages behavior.
- Profile large file/image/ZIP workloads on target devices and record peak memory, repeated-run behavior and cancellation cleanup.

## Conclusion

The specific folder-limit bug and three additional active-code issues are corrected. The active limit remains **150 explicit ZIP folders** for both archive creation and ZIP import; the test and user-facing message derive from the same configuration value. The project is an improved engineering candidate, not a verified Staff/production release until the remaining release gates are executed.

# Architecture and engineering decisions

## Product boundary

FileForge is a static, browser-only application. It has no application server, account system, database, telemetry endpoint or remote file-processing service. Selected file bytes are processed in the user's browser tab or a dedicated Web Worker. The application cannot make claims about browser extensions, compromised browsers, operating systems or hosting infrastructure outside the repository.

The product has four user-facing workflows:

1. Image conversion to PNG, JPEG or WebP, then ZIP packaging.
2. Text export to TXT, Markdown, HTML, JSON, CSV or XML.
3. ZIP creation from selected files and folders.
4. Merging UTF-8 text files, including supported text entries inside conventional ZIP archives.

## Layer ownership

- `src/main.ts`: composition root only; imports the static template, initializes UI modules and registers application-lifecycle cleanup.
- `src/core/`: pure policies and bounded browser primitives: configuration, errors, validation, filename rules, metadata-only history, download URLs, worker protocol and ZIP preflight/extraction.
- `src/engines/`: application use cases and file-format operations. Engines do not access the DOM.
- `src/workers/`: isolated runtime adapters for image conversion, text export, archive generation and merge-input preparation.
- `src/ui/`: tab-specific rendering, state presentation, theme, operation coordination and user interaction.
- `tests/`: focused unit/integration tests.
- `e2e/`: browser-visible workflows and automated accessibility tests.

The design intentionally avoids a UI framework and backend. Direct DOM rendering is acceptable while the UI remains a small static application, but it is decomposed by feature. Introducing a framework should require a measurable product or maintenance benefit rather than fashion.

## Worker boundaries and concurrency

The UI owns the selected `File` objects and the single active heavy operation. Heavy work is performed in short-lived dedicated workers:

| Worker                   | Responsibility                                                              | Cancellation model                                                              |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `image.worker.ts`        | decode, validate post-decode dimensions, encode and ZIP successful images   | worker message + termination by client; bounded worker timeout                  |
| `export.worker.ts`       | text serialization and merge output generation                              | cancel message + worker termination                                             |
| `archive.worker.ts`      | ZIP generation with progress callbacks                                      | AbortController observed during archive generation callbacks + termination      |
| `merge-import.worker.ts` | bounded ZIP inspection, decompression, UTF-8 decoding and input preparation | AbortController observed between entries and during decompression + termination |

`src/core/worker-client.ts` centralizes worker lifecycle, message correlation, error/messageerror handling, cancellation, timeout and cleanup. Image conversion has a specialised protocol because it reports per-file failures as well as progress.

All full-screen workflows use a single-operation lock. Image preparation and merge/ZIP input preparation also count as active work, so a second CPU- or memory-intensive workflow cannot start while a batch is being inspected. Both preparation flows expose cancellation; cancelling image preparation discards that incoming batch atomically and keeps previously accepted images. The preparation state is reflected in the corresponding file list and `aria-busy` state. This avoids simultaneous ZIP/image jobs causing unnecessary memory peaks.

## Data-flow contracts

### Text export

- TXT and Markdown encode the editor value to UTF-8 without added headers, timestamps, author names, branding or statistics.
- HTML wraps escaped source text in a minimal page shell; it does not add visible headings or metadata.
- JSON serializes source text as one JSON string.
- CSV serializes source text as one quoted field. Spreadsheet applications may still interpret formula-leading values as formulas; the UI warns about this, while preserving source text exactly rather than silently prefixing an apostrophe.
- XML stores source text in a fixed `document` root and rejects XML 1.0-forbidden code points rather than deleting them.
- Unpaired UTF-16 surrogates are rejected before UTF-8 conversion because the browser encoding APIs would otherwise replace them.
- Output size is estimated before allocating the result string, then verified again on the resulting Blob.

### Output naming

Every output has an optional manual name. Empty means an automatically generated base name. The preview is refreshed when either the name or output-format selector changes, and the preview and actual download share the same generated value; after an output attempt, the UI offers a new name for the next run. The selected output format owns the extension. A known conflicting extension is replaced with a warning; a version-like dotted suffix such as `report.v2` is preserved. Path separators, control/bidi characters and reserved device names are normalized or rejected according to input context.

### Image conversion

Input type is determined from signatures where possible, not only from filename or browser MIME metadata. Signature, extension and format must agree. File dimensions are checked from format headers before decode; `ImageBitmap` dimensions are checked again in the Worker before allocating a canvas. The worker processes one image at a time, caps pixel count, verifies the actual MIME returned by `OffscreenCanvas.convertToBlob` and only adds verified outputs to the ZIP. Browser decoder safety remains an external boundary. GIF/WebP animation is not preserved when converted to static output. Only PNG/JPEG/WebP output is offered because Canvas does not guarantee GIF/BMP encoders.

### SVG

SVG source must be UTF-8, within the small SVG size budget, sanitized with the SVG profile and parsed as XML. DTD/entities, active elements, event attributes, external resource references and malformed root structures are rejected. DOMPurify is mandatory for SVG: unavailable sanitizer means fail closed. Sanitization is not a guarantee that every browser SVG implementation is free of vulnerabilities.

### ZIP creation

User filenames/folder names are normalized before insertion. Duplicate names are made unique deterministically. Folder paths are reserved before file names, and path-type collisions are avoided so a file cannot occupy a directory path required by another entry. Already-compressed extensions use STORE; other entries use DEFLATE. A stable timestamp is used to reduce nondeterministic metadata. JSZip creates the result in memory, so limits remain conservative and output size is checked after generation.

### ZIP import

A conventional ZIP is inspected before extraction. Unsupported ZIP64, multi-volume, encrypted, unsupported-method, unsafe-path, symlink/special-file, duplicate, overlapping and malformed entries are rejected. Central directory, local headers, flags, sizes and data descriptors must agree. Deflated entries are piped from a view over the original archive buffer through `DecompressionStream('deflate-raw')` into a buffer bounded by the already validated declared size, avoiding an extra full compressed-entry Blob copy; actual output length and CRC32 are checked before UTF-8 decoding. If the browser cannot perform this operation, import fails closed.

Each ZIP is imported atomically. No selected text entries from that archive are committed until every selected text entry passes extraction, size, CRC and UTF-8 checks. Unsupported non-text entries are reported as skipped rather than extracted.

## State and failure semantics

- UI state remains in `src/ui/state.ts`; the engine and worker layers do not mutate it.
- Only one major operation runs at a time. Input preparation uses independent guarded state.
- Worker clients have timeouts and clean up event listeners, workers and timers on all terminal paths.
- A result is announced only after the returned Blob's MIME, extension and configured size have been checked.
- Unsupported behavior is an explicit error, not a fallback that changes format or weakens validation.
- History is optional; it stores operation metadata only. Storage failures must not block file processing.
- All user-controlled strings are rendered through `textContent`, form values or format-specific escaping. The one `innerHTML` assignment inserts a compile-time static template with no user interpolation.

## Performance budgets

All budgets live in `src/core/config.ts`. Workers reduce main-thread blocking but do not make memory usage free: input Files, decoded pixels, JSZip buffers and output Blobs can coexist. Browser memory availability is not reliably observable. Do not increase limits without profiling representative low-memory Android and desktop devices.

## Deferred features

PDF/DOCX and other office formats, GIF animation preservation, File System Access API integration, persistent drafts, ZIP64 and legacy filename encodings are deliberate scope exclusions. They need explicit product requirements, threat analysis, browser compatibility decisions and tests before implementation.

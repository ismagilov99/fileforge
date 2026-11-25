# Threat model and security boundaries

## Assets

- Original user file contents and filenames.
- Integrity of generated files, their extensions and MIME types.
- Browser tab availability and device memory.
- UI integrity against markup/script injection via filenames, text and archive paths.
- User privacy: FileForge should not transmit selected file content to a FileForge backend because no backend is part of this application.

## Trust assumptions and limits

- Selected files, archive entries, file names, MIME metadata and text are untrusted input.
- Browser, operating system, browser extensions, hosting provider and downloaded application bundle are outside the application's complete control.
- Client-side validation is not malware scanning and does not prove that a file is safe for a browser-native decoder.
- A browser or OS may still terminate a tab under memory pressure. Free memory is not reliably queryable across target browsers.
- No client-side app can credibly promise zero defects or complete protection against all malformed inputs.

## Threats and controls

| Threat                             | Current controls                                                                                                                                                                                                                                                               | Residual risk                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Misleading MIME/extension          | Signature detection for supported image and ZIP types; extension-to-signature check; result MIME verification                                                                                                                                                                  | Magic signatures do not prove full format validity; native decoders remain complex attack surfaces                                                              |
| SVG active content                 | DOMPurify SVG profile; forbidden active tags/attributes; reject DTD/entities, external href/src and non-fragment `url()`; fail closed                                                                                                                                          | Sanitizer/browser SVG behavior evolves; corpus and dependency updates remain necessary                                                                          |
| Path traversal                     | Reject absolute, drive, dot-segment and altered paths; normalize slash direction; reject control/bidi and unsafe names                                                                                                                                                         | ZIP has many dialects; unsupported features are rejected, parser needs ongoing fuzz/regression tests                                                            |
| File/directory collision           | Detect duplicates, ancestor conflicts, path overlap; archive creation reserves directories before file names                                                                                                                                                                   | Platform extraction tools may apply different case/Unicode normalization rules                                                                                  |
| Symlink/special file               | Reject Unix symlink and special modes, reparse-point metadata                                                                                                                                                                                                                  | ZIP metadata differs between creator platforms and may be absent or ambiguous                                                                                   |
| ZIP bomb                           | Cap source archive size, file and explicit-directory entry counts, per-entry and aggregate declared output, compression ratio; stream actual decompression directly from the archive buffer into a prebounded output buffer; verify actual length and CRC32                    | Source archive is buffered; browser decompression implementation and OS memory manager remain external                                                          |
| Corrupt/ambiguous ZIP              | Validate EOCD, central directory, local headers, flags, sizes, data descriptors, ranges and CRC; atomic import                                                                                                                                                                 | ZIP64, multi-volume, encrypted and unsupported encodings intentionally fail closed                                                                              |
| Oversized image/decompression bomb | Restored capacity budgets from the original application, independent per-file/aggregate/output bounds, format-specific header checks including PNG IHDR CRC and WebP RIFF length, actual decoded bitmap dimensions, sequential Worker conversion, prompt bitmap/canvas cleanup | Browser decoder may allocate internally before bitmap dimensions are available; resource use is not fully controllable                                          |
| Main-thread blocking               | Workers for conversion, export, archive creation and merge ZIP input preparation                                                                                                                                                                                               | Image signature/header checks and SVG sanitation still execute on main thread; very large UI state lists can still cost time                                    |
| HTML/script injection              | UI text is inserted using `textContent`; HTML export escapes source text; static template contains no user interpolation; restrictive CSP                                                                                                                                      | Future UI features must preserve this contract; CSP meta is not equivalent to a response header                                                                 |
| Filename spoofing                  | NFC, UTF-8 byte caps, path/control/bidi cleanup, reserved names, format-owned extension                                                                                                                                                                                        | Actual save dialog behavior and platform-specific normalization are browser/OS controlled                                                                       |
| Silent data corruption             | Exact TXT/MD export, strict UTF-8, Unicode validation, MIME/size checks, ZIP CRC32                                                                                                                                                                                             | Browser download managers and OS storage can fail outside app control                                                                                           |
| CSV formula injection after export | CSV is preserved as an exact quoted field; the UI warns about formula-leading values and does not mutate source data                                                                                                                                                           | CSV quoting does not prevent spreadsheet software from evaluating formula-like cells; users must verify untrusted CSV before opening it in spreadsheet software |
| History tampering/storage errors   | Runtime schema validation; serialized payload cap; Unicode/path/control checks; `textContent`; metadata only; storage failures ignored                                                                                                                                         | Same-origin malicious code can alter localStorage; history is not security-critical                                                                             |
| Worker hangs                       | Worker timeout, cancellation and worker termination cleanup                                                                                                                                                                                                                    | A browser may hang or kill the whole tab before JS timeout executes                                                                                             |
| Dependency/supply-chain compromise | Pinned direct dependency versions, Dependabot, strict `npm audit --audit-level=low`, CI lockfile guard and SBOM generation                                                                                                                                                     | No lockfile in this handoff; release blocked until a lockfile is generated and reviewed; npm audit does not catch every issue                                   |

## Content Security Policy

The production meta policy restricts scripts, connections, module Workers and fonts to the same origin; it permits Blob URLs only for local image previews/download-related image handling. The Vite development server adds a loopback-only WebSocket source solely for HMR while serving. The build fails if generated production HTML contains that development exception, a `data:` source or unexpected worker/network directives. Meta CSP cannot provide `frame-ancestors`; the app refuses to initialize inside an iframe as defense in depth, but a real `frame-ancestors` or `X-Frame-Options` response header remains preferable. `Permissions-Policy` is a response header, not a supported `meta http-equiv`; this static GitHub Pages project cannot enforce it here. The current application does not call camera, microphone, geolocation, payment or USB APIs. A host with configurable headers should add appropriate response-header policies.

## Resource budgets

All limits are centrally defined in `src/core/config.ts`. Do not raise limits based only on a desktop development laptop. Measure peak memory, time to first interaction, cancellation latency and repeated-operation behavior on low-memory Android and desktop browsers.

## Fail-closed rules

- Missing SVG sanitizer: reject SVG.
- Unsupported image encoder or mismatched MIME: reject output.
- Unsupported ZIP parser/decompression capability: reject ZIP import.
- Inconsistent local/central headers, data descriptor, file size or CRC: reject archive/entry.
- Invalid UTF-8 or malformed Unicode: reject instead of replacing characters.
- Limit exceeded: stop and explain; do not report success or silently drop bytes.
- Worker protocol failure or timeout: terminate worker and reject the operation.

Partial image batches are allowed only when individual images fail independently; each failed item is surfaced. ZIP import is atomic at archive granularity.

## Release security checklist

- Generate and commit `package-lock.json`; verify exact dependency resolution.
- Review `npm audit --audit-level=low` output; generate and review a CycloneDX SBOM and evaluate dependency updates.
- Run formatting, lint, typecheck, unit/integration tests, production build and Playwright E2E.
- Test ZIP data descriptors (signed and unsigned), DEFLATE, Unicode names, duplicate paths, traversal, symlinks, malformed headers, high ratios, bad CRC and truncation.
- Test SVG scripts, event handlers, external href/src, CSS URL, DTD/entities and `foreignObject`.
- Verify no file bytes are sent over network in browser DevTools.
- Review production CSP in the build output and verify the deployed origin response policy; GitHub Pages meta CSP does not set `frame-ancestors`.
- Test supported desktop/mobile browsers and real mobile devices.
- Profile memory, cancellation, repeated runs and object URL cleanup.

## Vulnerability reporting

Do not publish exploit files or private user data in a public issue. Use GitHub private vulnerability reporting/Security Advisories when available. Include affected version, browser/OS, minimal harmless reproduction and observed impact.

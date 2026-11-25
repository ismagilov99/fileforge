# Security Policy

## Scope

FileForge is a browser-only file utility. The intended security boundary is the user's browser tab: selected files are processed locally and are not intentionally uploaded to a FileForge backend. This is not a guarantee that the browser, extensions, operating system, or network provider cannot observe local activity.

## Reporting a vulnerability

Do not publish exploit files or personal data in a public issue. Report the affected version, browser/OS, reproduction steps, expected result, actual result, and a minimized harmless test fixture. Remove private file contents before sharing diagnostics.

## Security design

- Validate file names, size, content signatures and format-specific structures before processing.
- Treat file extension and MIME type as hints, not proof of content.
- Reject unsupported ZIP encryption, ZIP64, methods, flags, unsafe paths and special files.
- Bound actual decompressed bytes and verify CRC32 before decoding text.
- Sanitize SVG and fail closed if the sanitizer is unavailable.
- Render user-controlled strings with `textContent` or format-specific escaping.
- Keep output and input limits conservative; do not raise limits without memory testing.
- Do not store file contents in history or persistent storage.

## Supported security guarantees and limits

No client-side application can guarantee zero vulnerabilities or prevent the browser/OS from terminating a tab under memory pressure. A successful parse is not proof that an arbitrary file is harmless. New parser edge cases and dependency advisories must be evaluated and added to the test corpus.

## Dependency response

Run `npm audit --audit-level=high`, review dependency updates, regenerate and commit `package-lock.json`, then rerun unit, browser and build checks before release.

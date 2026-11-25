# FileForge 5.5.2 — active capacity limits

This document describes the active values in `src/core/config.ts`. The large input values restore the initial FileForge configuration from the original published `index.html`, `FF.Core.CONFIG` (original source: https://raw.githubusercontent.com/ismagilov99/fileforge/main/index.html, line 516; image and archive checks: lines 617 and 630; merge checks: line 640).

## Restored original values

| Original setting          |     Original value | Current mapping                                                                         |
| ------------------------- | -----------------: | --------------------------------------------------------------------------------------- |
| `MAX_FILES`               |                150 | Image and archive item count: 150                                                       |
| `MAX_FILE_SIZE`           |             50 MiB | Image/archive per-file, merge direct-file and ZIP-entry ceilings: 50 MiB                |
| SVG input                 |             50 MiB | Same as the restored image per-file ceiling; the earlier 5 MiB internal cap is removed. |
| `MAX_TOTAL_SIZE`          |            400 MiB | Image/archive aggregate source bytes: 400 MiB                                           |
| `MAX_TEXT_SIZE`           |             10 MiB | Text editor UTF-8 input: 10 MiB                                                         |
| `MAX_CONSOLIDATED_SIZE`   |             30 MiB | Merged output: 30 MiB                                                                   |
| `MAX_ZIP_INPUT`           |            100 MiB | A single ZIP passed to merge: 100 MiB                                                   |
| `MAX_MERGE_FILES`         |                100 | Merged source files: 100                                                                |
| `CANVAS_MAX_DIM`          |           8,192 px | Image output canvas dimension: 8,192 px                                                 |
| Image pixel preflight     |      67,108,864 px | Allows the full 8,192 × 8,192 canvas area.                                              |
| Input dimension preflight | 65,535 px per side | Additional resource guard; inputs are downscaled to at most 8,192 px per output side.   |
| `MAX_HISTORY`             |                 20 | History records: 20                                                                     |
| `DEFAULT_QUALITY`         |               0.92 | Default JPEG/WebP quality: 92%                                                          |

`MAX_TOTAL_SIZE=400 MiB` was used by the original image and archive input flows. `MAX_FILE_SIZE=50 MiB` was also used for direct text files and text entries read from ZIPs. The original merge flow did not define an aggregate input ceiling; FileForge 5.5 adds a 400 MiB aggregate cap as an explicit stability guard rather than leaving total imported memory unbounded. This aggregate cap is not represented as an original legacy value.

## Additional bounded output and integrity limits

| Area                          | Active value | Why it exists                                                                                 |
| ----------------------------- | -----------: | --------------------------------------------------------------------------------------------- |
| One converted image result    |      450 MiB | Matches the ZIP-wide output ceiling, avoiding an unnecessary smaller per-image cap            |
| ZIP of converted images       |      450 MiB | Bounds the final generated Blob                                                               |
| Archive ZIP result            |      410 MiB | Allows ZIP headers/directories above 400 MiB source data                                      |
| Generated text file           |       70 MiB | Accommodates up to 10 MiB input with worst-case HTML/XML/JSON escaping overhead               |
| Total decoded merge text      |      400 MiB | Prevents unbounded aggregate decompression before final assembly                              |
| ZIP compression ratio         |        100:1 | Retained decompression-bomb guard                                                             |
| Image pixels before decode    |   67,108,864 | Permits the full 8,192 × 8,192 canvas area                                                    |
| Image input side              |    65,535 px | Allows large sources to be downscaled while retaining a separate pathological-dimension guard |
| Explicit archive folders      |          150 | Bounds directory metadata and folder UI state                                                 |
| Explicit imported ZIP folders |          150 | Bounds central-directory parsing work                                                         |

The 400 MiB aggregate merge limit, 150-folder limit, output-specific limits, image pixel guard and source-side dimension guard are additional caps in the new architecture. They do not reduce the original direct-file, ZIP-input, file-count, text-input or consolidated-output values.

## Client-side resource implications

The application processes files in the browser; files are not uploaded to a FileForge processing server. Consequently, low server load does not increase the RAM, CPU time or native decoder budget available to the user's browser tab. Workers keep long operations off the UI thread, but JSZip, decoded image bitmaps, output Blobs and browser internals still consume device memory. An operating system or browser can terminate a tab before an application limit is reached.

For that reason, FileForge retains hard upper bounds, preflight validation, streaming decompression, CRC checks, path validation, cancellation and fail-closed behavior. Restoring the old capacity values does not disable these independent protections. If a device cannot complete a maximum-size operation, the application should show a controlled error whenever the browser remains able to report it; no web application can guarantee recovery from OS-level out-of-memory termination.

## Source of truth

- Runtime values: `src/core/config.ts`.
- Archive folder validation: `src/engines/archive.ts` and `src/ui/archive-tab.ts`.
- ZIP import directory limits: `src/core/zip-security.ts`.
- UI limit hints are generated from `LIMITS`, not separately hard-coded.
- Regression tests: `tests/config.test.ts`, `tests/images.test.ts`, `tests/archive.test.ts`, `tests/zip-security.test.ts` and `tests/text.test.ts`.

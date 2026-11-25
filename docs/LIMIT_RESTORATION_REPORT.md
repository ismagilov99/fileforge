# FileForge 5.5.2 — limit restoration report

## Source of truth

The restored values were read from the original repository source, not guessed from a prior assistant-generated archive: `https://raw.githubusercontent.com/ismagilov99/fileforge/main/index.html`, `FF.Core.CONFIG` at line 516. The original feature handlers use those settings for image selection (line 617), archive selection (line 630) and merge processing (line 640).

The first assistant-generated `FileForge_5_rebuild.zip` was not the user's original codebase: its config had already reduced the image/archive aggregate limit to 100 MiB and merge direct-file/entry limits to 10 MiB. Those values were not used as the restoration source.

## Restored original values

| Original setting        | Original value | Active mapping in 5.5.2                                             |
| ----------------------- | -------------: | ------------------------------------------------------------------- |
| `MAX_FILES`             |            150 | 150 image files / 150 archive files                                 |
| `MAX_FILE_SIZE`         |         50 MiB | 50 MiB per image/archive file, direct merge file and ZIP text entry |
| `MAX_TOTAL_SIZE`        |        400 MiB | 400 MiB total image batch and archive source batch                  |
| `MAX_TEXT_SIZE`         |         10 MiB | 10 MiB UTF-8 text editor input                                      |
| `MAX_CONSOLIDATED_SIZE` |         30 MiB | 30 MiB merged output                                                |
| `MAX_ZIP_INPUT`         |        100 MiB | 100 MiB per ZIP selected for merge                                  |
| `MAX_MERGE_FILES`       |            100 | 100 merged text files                                               |
| `CANVAS_MAX_DIM`        |       8,192 px | 8,192 px maximum output canvas side                                 |
| `MAX_HISTORY`           |             20 | 20 history records                                                  |
| `DEFAULT_QUALITY`       |           0.92 | 92% default JPEG/WebP quality                                       |

## Additional guards retained

These are not represented as original legacy constants. They remain separate integrity/resource controls in the redesigned browser app:

- SVG size follows the 50 MiB per-image limit; the interim 5 MiB cap has been removed.
- Image preflight permits 67,108,864 pixels (8,192 × 8,192) and source sides up to 65,535 px before downscaling to the 8,192 px output limit.
- Image ZIP output is capped at 450 MiB; one converted output image can use the full 450 MiB output budget.
- Archive ZIP output is capped at 410 MiB to allow ZIP metadata above the 400 MiB input budget.
- Text output is capped at 70 MiB, enough for a 10 MiB source expanded by supported HTML/JSON/XML escaping.
- Merge has an additional 400 MiB aggregate source / decoded-text ceiling. The original merge workflow did not specify this aggregate ceiling; it is retained to bound browser memory rather than misrepresented as an original limit.
- Folder counts are capped at 150; the original code did not define an explicit folder-count limit.
- ZIP entry paths, CRC32, declared and actual decompressed sizes, compression ratio, UTF-8, image signatures, output MIME and operation cancellation remain validated.

## Server load versus browser resources

FileForge performs file processing locally in the browser. Therefore, a private GitHub Pages deployment or an idle server does not create extra RAM for the user's browser tab. Web Workers improve responsiveness but do not remove the memory required by source files, decoded pixels, decompression buffers and output Blobs. The restored legacy input ceilings are preserved while independent safety guards remain explicit. An operating system can still terminate a browser tab under memory pressure; no browser application can guarantee otherwise.

## Validation performed for this change

- Reviewed the current config and all active call sites for image, archive, text, merge, ZIP and SVG limits.
- Searched active runtime source and UI for stale 5 MiB SVG, 32 MP and earlier restrictive input-dimension limits; none remain.
- Ran a strict TypeScript check across `src` with temporary ambient declarations for unavailable external packages. This checks internal source typing but is not a substitute for the package's pinned dependency type declarations.
- Confirmed the environment has Node 22.16.0 / npm 10.9.2 while the project pins Node 24.22.3 / npm 11.19.1. Dependencies are not installed and `package-lock.json` is not available in this environment, so Vitest, Biome, Vite production build, Playwright and npm audit were not run.

## Checklist

- [x] Original constants verified against the original source file.
- [x] Image/archive file count, per-file and aggregate limits restored.
- [x] Text editor input limit restored.
- [x] Merge direct file, ZIP input, ZIP entry, file count and result limits restored.
- [x] Canvas output dimension and default quality retained.
- [x] 5 MiB SVG cap removed; SVG follows 50 MiB per-image value.
- [x] 32 MP preflight no longer rejects the full 8,192 × 8,192 image area.
- [x] User-visible hints read values from central config.
- [x] Regression tests assert the restored configuration and image pixel boundary.
- [ ] Run all package tests and browser checks with the pinned Node/npm toolchain.
- [ ] Measure memory and responsiveness on real target devices at the restored high limits.

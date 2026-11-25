# Performance and memory policy

FileForge 5.5 restores the original large input capacities while retaining separate output, pixel, decompression and integrity guards. Expensive operations run in dedicated Workers. Workers protect interface responsiveness but do not eliminate memory usage: selected Files, decoded image, canvas, ZIP internals and output Blob may coexist.

## Memory-sensitive paths

- Image previews use object URLs and revoke them when an item is removed or the page closes.
- SVG inputs may be up to the restored 50 MiB per-image limit and are sanitized before use; sanitization temporarily requires a decoded text representation, so a large SVG can consume substantially more than its on-disk size. Images up to 8 MiB may be fully buffered for SHA-256 duplicate detection. Larger images skip hashing to avoid doubling large allocations.
- Raster dimensions are inspected from headers before decode and checked again from the actual `ImageBitmap` before canvas allocation.
- Image conversion is sequential: one decoded bitmap and one canvas are handled at a time.
- ZIP extraction preflights entry count, declared expansion and compression ratio, then decompresses each supported entry into a buffer bounded by validated size and verifies actual size/CRC32.
- ZIP creation uses JSZip and builds output in memory; the restored default ceiling is 150 files, 50 MiB per source file, 400 MiB aggregate input and 410 MiB output. Input and output may coexist; this is a deliberately large local-device budget, not a guarantee that every browser can complete it.
- Text-editor UTF-8/code-point statistics are debounced after input, avoiding a full multi-megabyte scan on every keystroke. Merge imports and output serialization run in Workers. The merge input cap is 100 selections / 400 MiB aggregate source bytes, each direct text file and ZIP entry is capped at 50 MiB, and total decoded text is capped at 400 MiB. The resulting strings and Blobs still consume memory; the final merged result remains capped at the original 30 MiB.
- Download object URLs are retained briefly to allow a manual fallback link, then revoked; they are also revoked on unload.

## Required profiling for the restored large limits

Measure peak memory, long tasks, CPU time, cancellation latency and object URL cleanup on at least one low-memory Android device and a desktop browser. Test maximum file count, maximum aggregate bytes, highly compressible input, incompressible input, maximum dimensions, cancellation at each stage, repeated operations and switching tabs while idle. The restored limits are already large; do not raise them further based only on desktop testing. Profile the maximum configured workload on the target devices before relying on it for critical work.

## Metrics to record

- Input bytes and item count.
- Time to validation, processing start, completion and cancellation.
- Largest decoded image pixel count.
- ZIP input size, declared and actual extracted bytes, entry count and compression ratio.
- Peak memory when tooling makes it available (do not infer exact memory from JS heap alone).
- Long tasks and main-thread responsiveness.
- Worker termination, rejected job and object URL counts.

Do not collect or transmit user file contents for performance telemetry.

## Restored default budgets (5.5)

- Images: 150 files, 50 MiB per input, 400 MiB aggregate; input dimensions up to 65,535 px per side and 67,108,864 pixels (the full 8,192 × 8,192 output area); canvas output dimension up to 8,192 px; 450 MiB per output image and 450 MiB total ZIP.
- Archive creation: 150 files, 150 folders, 50 MiB per file, 400 MiB aggregate and 410 MiB ZIP output.
- Text editor: 10 MiB UTF-8 input and 70 MiB generated result.
- Merge: 100 selected files, 400 MiB aggregate compressed/original input, 100 MiB per ZIP, 50 MiB per direct text file / ZIP entry, 400 MiB total decoded text, 100 compression-ratio ceiling and 30 MiB final result.
- History: 20 records and 32 KiB maximum serialized metadata.

These budgets restore the original larger allowances; they do not guarantee a tab will survive every browser/OS memory-pressure situation. Native image decoders and JSZip internals are outside the application's exact memory accounting. A server deployment does not add client-side memory because file processing remains local in the browser.

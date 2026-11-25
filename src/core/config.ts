const MIB = 1024 * 1024;
// ZIP creation and ZIP import must enforce the same directory-entry ceiling.
// Keep one value here so the two workflows cannot silently drift apart.
const MAX_ZIP_FOLDERS = 150;

/**
 * Capacity profile restored from the original FileForge application.
 *
 * The original CONFIG used 150 files, 50 MiB per file, 400 MiB aggregate input,
 * 10 MiB text input, 30 MiB consolidated output, 100 MiB ZIP input, 100 merge
 * files and an 8,192 px canvas dimension. This version maps those limits into
 * per-workflow settings while retaining independent integrity/security checks.
 *
 * Larger client-side limits increase the amount of memory a browser tab may
 * require. Workers protect the UI thread; they do not create more device RAM.
 */
export const LIMITS = Object.freeze({
  image: {
    maxFiles: 150,
    maxFileBytes: 50 * MIB,
    maxSvgBytes: 50 * MIB,
    maxTotalBytes: 400 * MIB,
    // Conversion can expand some formats. This is a hard, explicit output cap,
    // but it is no longer lower than the original aggregate input allowance.
    maxOutputBytes: 450 * MIB,
    // A 67 MP RGBA raster is approximately 256 MiB before encoder/ZIP overhead.
    maxOutputFileBytes: 450 * MIB,
    maxDimension: 8192,
    // At least the full 8,192 × 8,192 canvas area is permitted. This replaces
    // the previous 32 MP cap that rejected images the original converter could
    // downscale to its 8,192 px output limit.
    maxPixels: 8192 * 8192,
    // Large source images may be downscaled; this is a resource preflight guard,
    // not the restored source-file/canvas limit.
    maxInputDimension: 65_535,
  },
  archive: {
    maxFiles: 150,
    maxFolders: MAX_ZIP_FOLDERS,
    maxFileBytes: 50 * MIB,
    maxTotalBytes: 400 * MIB,
    // Allows ZIP directory/header overhead on top of the original 400 MiB input.
    maxOutputBytes: 410 * MIB,
  },
  text: {
    maxBytes: 10 * MIB,
    // The 10 MiB input can expand up to ~60 MiB in JSON/HTML/XML escaping.
    // Leave room for that format overhead instead of rejecting valid source.
    maxOutputBytes: 70 * MIB,
  },
  merge: {
    maxFiles: 100,
    maxFolders: MAX_ZIP_FOLDERS,
    maxSkippedDetails: 100,
    maxDirectFileBytes: 50 * MIB,
    maxZipBytes: 100 * MIB,
    // The original app had no aggregate merge-input cap. Keep it bounded at the
    // original 400 MiB general batch budget instead of the later 75 MiB ceiling.
    maxTotalInputBytes: 400 * MIB,
    maxEntryBytes: 50 * MIB,
    maxTotalUncompressedBytes: 400 * MIB,
    // Restored from the original MAX_CONSOLIDATED_SIZE = 30 MiB.
    maxOutputBytes: 30 * MIB,
    // Retained integrity/abuse guard; not a user file-size preference.
    maxCompressionRatio: 100,
  },
  history: {
    maxItems: 20,
    maxSerializedChars: 32 * 1024,
    storageKey: 'fileforge.history.v5',
  },
  preferences: {
    storageKey: 'fileforge.preferences.v5',
  },
});

export const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'html',
  'htm',
  'css',
  'scss',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'xml',
  'sql',
  'sh',
  'bash',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'rb',
  'go',
  'rs',
  'java',
  'php',
  'c',
  'cpp',
  'h',
  'hpp',
  'swift',
  'kt',
  'kts',
  'bat',
  'ps1',
  'conf',
  'env',
  'gitignore',
  'dockerfile',
  'makefile',
  'vue',
  'svelte',
  'graphql',
  'gql',
  'proto',
  'diff',
  'patch',
]);

export const IMAGE_INPUT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']);
export const IMAGE_OUTPUTS = ['png', 'jpeg', 'webp'] as const;
export type ImageOutput = (typeof IMAGE_OUTPUTS)[number];
export type TextFormat = 'txt' | 'md' | 'html' | 'json' | 'csv' | 'xml';
export type MergeFormat = 'txt' | 'md' | 'html' | 'json';

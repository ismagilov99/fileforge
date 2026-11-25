import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'MANIFEST.sha256');
const excludedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.cache',
]);
const excludedFiles = new Set(['MANIFEST.sha256', '.DS_Store']);
const comparePaths = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));
  const result = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) result.push(...(await walk(join(directory, entry.name))));
      continue;
    }
    if (!entry.isFile() || excludedFiles.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    result.push(absolutePath);
  }
  return result;
}

const files = (await walk(root)).sort((left, right) =>
  comparePaths(relative(root, left), relative(root, right)),
);
const rows = [];
for (const file of files) {
  const bytes = await readFile(file);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const name = relative(root, file).split(sep).join('/');
  rows.push(`${digest}  ${name}`);
}
const manifest = `${rows.join('\n')}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(output, 'utf8');
  } catch {
    /* Missing manifest is a failed check below. */
  }
  if (current !== manifest) {
    console.error('MANIFEST.sha256 is stale. Run: npm run manifest:write');
    process.exitCode = 1;
  } else {
    console.log(`Manifest verified: ${rows.length} files.`);
  }
} else {
  await writeFile(output, manifest, 'utf8');
  console.log(`Manifest written: ${rows.length} files.`);
}

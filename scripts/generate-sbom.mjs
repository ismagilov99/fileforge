import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const requestedPath = process.argv[2];
if (!requestedPath) {
  console.error(
    'Укажи путь вне исходного дерева, например: npm run sbom -- "$RUNNER_TEMP/fileforge-sbom.cdx.json"',
  );
  process.exit(2);
}

const outputPath = resolve(requestedPath);
const npmExecPath = process.env['npm_execpath'];
let result;
if (npmExecPath && existsSync(npmExecPath)) {
  result = spawnSync(process.execPath, [npmExecPath, 'sbom', '--sbom-format', 'cyclonedx'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
} else {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  result = spawnSync(command, ['sbom', '--sbom-format', 'cyclonedx'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    shell: process.platform === 'win32',
  });
}

if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Не удалось создать CycloneDX SBOM.\n');
  process.exit(result.status ?? 1);
}

let document;
try {
  document = JSON.parse(result.stdout);
} catch {
  throw new Error('npm вернул некорректный JSON вместо CycloneDX SBOM. Артефакт не записан.');
}
if (
  document.bomFormat !== 'CycloneDX' ||
  typeof document.specVersion !== 'string' ||
  !Array.isArray(document.components)
) {
  throw new Error('Полученный SBOM не прошёл структурную проверку CycloneDX.');
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(`CycloneDX SBOM создан: ${outputPath} (${document.components.length} компонентов).`);

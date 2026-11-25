import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const htmlPath = resolve(import.meta.dirname, '..', 'dist', 'index.html');
let html;
try {
  html = await readFile(htmlPath, 'utf8');
} catch {
  console.error('Production CSP check failed: dist/index.html is missing. Run the Vite build first.');
  process.exit(1);
}

const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
const cspTag = metaTags.find((tag) => /\bhttp-equiv=["']Content-Security-Policy["']/i.test(tag));
const content = cspTag?.match(/\bcontent="([^"]+)"/i)?.[1];
if (!content) {
  console.error('Production CSP check failed: Content-Security-Policy meta tag is missing or malformed.');
  process.exit(1);
}

const directives = new Map();
for (const item of content.split(';')) {
  const [name, ...values] = item.trim().split(/\s+/);
  if (name) {
    const directive = name.toLowerCase();
    if (directives.has(directive)) {
      console.error(`Production CSP check failed: duplicate ${directive} directive.`);
      process.exitCode = 1;
    } else {
      directives.set(directive, values);
    }
  }
}

function requireDirective(name, expected) {
  const actual = directives.get(name);
  if (!actual || actual.join(' ') !== expected.join(' ')) {
    console.error(
      `Production CSP check failed: ${name} must be exactly ${expected.join(' ') || '<empty>'}; got ${actual?.join(' ') ?? '<missing>'}.`,
    );
    process.exitCode = 1;
  }
}

requireDirective('default-src', ["'self'"]);
requireDirective('base-uri', ["'none'"]);
requireDirective('object-src', ["'none'"]);
requireDirective('script-src', ["'self'"]);
requireDirective('style-src', ["'self'", "'unsafe-inline'"]);
requireDirective('connect-src', ["'self'"]);
requireDirective('worker-src', ["'self'"]);
requireDirective('font-src', ["'self'"]);
requireDirective('form-action', ["'none'"]);
requireDirective('frame-src', ["'none'"]);
requireDirective('manifest-src', ["'self'"]);
requireDirective('media-src', ["'none'"]);

const imageSources = directives.get('img-src') ?? [];
if (imageSources.length !== 2 || !imageSources.includes("'self'") || !imageSources.includes('blob:')) {
  console.error('Production CSP check failed: img-src must allow only same-origin and Blob images.');
  process.exitCode = 1;
}

const allowedDirectives = new Set([
  'default-src',
  'base-uri',
  'object-src',
  'script-src',
  'style-src',
  'img-src',
  'worker-src',
  'connect-src',
  'font-src',
  'form-action',
  'frame-src',
  'manifest-src',
  'media-src',
]);
for (const name of directives.keys()) {
  if (!allowedDirectives.has(name)) {
    console.error(`Production CSP check failed: unexpected ${name} directive.`);
    process.exitCode = 1;
  }
}

if (content.includes('ws:') || content.includes('data:') || content.includes('unsafe-eval')) {
  console.error('Production CSP check failed: development WebSocket, data: or unsafe-eval source found.');
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  'Production CSP verified: same-origin scripts, connections and module Workers; Blob-only local image previews; no dev WebSocket or data: source.',
);

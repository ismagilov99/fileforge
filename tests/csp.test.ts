import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const csp = indexHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1] ?? '';
const directives = new Map(
  csp.split(';').map((entry) => {
    const [name, ...values] = entry.trim().split(/\s+/);
    return [name ?? '', values.join(' ')];
  }),
);

describe('Content Security Policy', () => {
  it('keeps production network and Worker sources same-origin', () => {
    expect(directives.get('connect-src')).toBe("'self'");
    expect(directives.get('worker-src')).toBe("'self'");
    expect(directives.get('font-src')).toBe("'self'");
  });

  it('allows only local Blob previews, not arbitrary data images', () => {
    expect(directives.get('img-src')).toBe("'self' blob:");
  });

  it('prevents script execution, embedded objects and form submission', () => {
    expect(directives.get('script-src')).toBe("'self'");
    expect(directives.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(directives.get('manifest-src')).toBe("'self'");
    expect(directives.get('media-src')).toBe("'none'");
    expect(directives.get('object-src')).toBe("'none'");
    expect(directives.get('base-uri')).toBe("'none'");
    expect(directives.get('form-action')).toBe("'none'");
    expect(csp).not.toMatch(/unsafe-eval|data:|ws:/);
  });

  it('adds a loopback HMR WebSocket source only in Vite serve mode', () => {
    expect(viteConfig).toContain("apply: 'serve'");
    expect(viteConfig).toContain("connect-src 'self' ws://127.0.0.1:*");
  });

  it('does not claim to enforce a Permissions-Policy through unsupported meta http-equiv', () => {
    expect(indexHtml).not.toMatch(/http-equiv=["']Permissions-Policy["']/i);
  });
});

import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/core/config';
import { convertText, mergeTextFiles } from '../src/engines/text';

describe('text export', () => {
  const source = 'Привет.\n  Мир <script>alert(1)</script>\n';

  it('exports TXT byte-for-byte as the original string in UTF-8', async () => {
    const result = convertText(source, 'txt');
    expect(result.extension).toBe('txt');
    expect(await result.blob.text()).toBe(source);
  });

  it('exports Markdown without generated metadata', async () => {
    const result = convertText(source, 'md');
    expect(await result.blob.text()).toBe(source);
    expect(await result.blob.text()).not.toContain('FileForge');
    expect(await result.blob.text()).not.toContain('Создано');
  });

  it('escapes markup in HTML without adding visible headings or dates', async () => {
    const result = convertText(source, 'html');
    const html = await result.blob.text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('Создано в FileForge');
    expect(html).not.toContain('<h1>');
  });

  it('encodes the exact source as a JSON string, not as metadata fields', async () => {
    const result = convertText(source, 'json');
    expect(JSON.parse(await result.blob.text())).toBe(source);
  });

  it('writes CSV as a single correctly escaped field without mutating formula-like source text', async () => {
    const value = '=HYPERLINK("https://example.invalid","open")';
    const result = convertText(value, 'csv');
    expect(await result.blob.text()).toBe(`"${value.replace(/"/g, '""')}"`);
  });

  it('rejects XML-forbidden control characters instead of deleting them', () => {
    expect(() => convertText('hello\u0000world', 'xml')).toThrow();
  });

  it('rejects unpaired UTF-16 surrogates instead of silently replacing them', () => {
    expect(() => convertText('before\uD800after', 'txt')).toThrow(/Unicode-последовательность/i);
  });

  it('accepts the full 10 MiB source when JSON escaping expands it but remains within the output budget', () => {
    const controlHeavyText = '\u0000'.repeat(10 * 1024 * 1024);
    const result = convertText(controlHeavyText, 'json');
    expect(result.blob.size).toBeGreaterThan(50 * 1024 * 1024);
    expect(result.blob.size).toBeLessThanOrEqual(70 * 1024 * 1024);
  });

  it('accepts the full 10 MiB source when HTML escaping expands it but remains within the output budget', () => {
    const quoteHeavyText = '"'.repeat(10 * 1024 * 1024);
    const result = convertText(quoteHeavyText, 'html');
    expect(result.blob.size).toBeGreaterThan(50 * 1024 * 1024);
    expect(result.blob.size).toBeLessThanOrEqual(70 * 1024 * 1024);
  });

  it('escapes source filenames in generated Markdown headings', async () => {
    const result = mergeTextFiles([{ name: '# <script>.txt', content: 'safe', size: 4 }], 'md', true);
    const output = await result.blob.text();
    expect(output).not.toContain('## # <script>');
    expect(output).toContain('\\#');
  });

  it('omits source names from merged JSON unless the user enables the option', async () => {
    const files = [
      { name: 'a.txt', content: 'alpha', size: 5 },
      { name: 'b.txt', content: 'beta', size: 4 },
    ];
    const withoutNames = mergeTextFiles(files, 'json', false);
    expect(JSON.parse(await withoutNames.blob.text())).toEqual(['alpha', 'beta']);
    const withNames = mergeTextFiles(files, 'json', true);
    expect(JSON.parse(await withNames.blob.text())).toEqual([
      { name: 'a.txt', content: 'alpha' },
      { name: 'b.txt', content: 'beta' },
    ]);
  });

  it('rejects JSON expansion over the merge output budget before building the result', () => {
    const controlHeavyText = '\u0000'.repeat(5_500_000);
    expect(() =>
      mergeTextFiles(
        [{ name: 'large.txt', content: controlHeavyText, size: controlHeavyText.length }],
        'json',
        false,
      ),
    ).toThrow(/лимит результата 30 МБ/i);
  });

  it('rejects a non-string runtime text payload before measuring it', () => {
    expect(() => convertText({ value: 'not text' } as never, 'txt')).toThrow(/текстовой строкой/i);
  });

  it('rejects an unsupported runtime text format instead of returning an invalid result', () => {
    expect(() => convertText('safe text', 'pdf' as never)).toThrow(/неподдерживаемый формат/i);
  });

  it('rejects an unsupported runtime merge format instead of creating an undefined Blob', () => {
    expect(() =>
      mergeTextFiles([{ name: 'a.txt', content: 'safe', size: 4 }], 'pdf' as never, false),
    ).toThrow(/неподдерживаемый формат/i);
  });

  it('enforces merge limits again inside the export engine', () => {
    const files = Array.from({ length: 101 }, (_, index) => ({
      name: `${index}.txt`,
      content: 'x',
      size: 1,
    }));
    expect(() => mergeTextFiles(files, 'txt', false)).toThrow(
      new RegExp(`не более ${LIMITS.merge.maxFiles}`, 'i'),
    );
  });

  it('rejects inconsistent merge metadata instead of trusting a supplied size', () => {
    expect(() => mergeTextFiles([{ name: 'a.txt', content: 'actual', size: 1 }], 'txt', false)).toThrow(
      /не совпадает с фактическим содержимым/i,
    );
  });

  it('merges files without generated FileForge metadata', async () => {
    const result = mergeTextFiles(
      [
        { name: 'a.txt', content: 'alpha', size: 5 },
        { name: 'b.txt', content: 'beta', size: 4 },
      ],
      'txt',
      false,
    );
    const output = await result.blob.text();
    expect(output).toBe('alpha\n\nbeta');
    expect(output).not.toContain('FileForge');
  });
});

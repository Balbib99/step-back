import { describe, expect, it } from 'vitest';
import {
  cleanSummary,
  cleanTitle,
  decodeEntities,
  isPublicHttpsUrl,
  normalizeUrl,
  stripHtml,
} from './text.js';

describe('decodeEntities', () => {
  it('decodes named, decimal and hexadecimal entities', () => {
    expect(
      decodeEntities('D&#8217;Angelo &amp; Pete Prisco&#039;s &#x27;x&#x27; &quot;q&quot;'),
    ).toBe("D’Angelo & Pete Prisco's 'x' \"q\"");
  });

  it('decodes once: an escaped entity stays as text', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });

  it('leaves what it does not know as written', () => {
    expect(decodeEntities('&unknown; &#99999999999;')).toBe('&unknown; &#99999999999;');
  });
});

describe('stripHtml with hostile input', () => {
  // A feed author could send a description made of "<": the patterns that drop tags went
  // quadratic on it and stalled the only thread (about 0.9 s for 32 KB).
  it.each([
    ['a run of <', '<'],
    ['an unclosed <script', '<script'],
    ['an unclosed <a', '<a '],
  ])('is fast with five million characters of %s', (_name, unit) => {
    const started = performance.now();
    stripHtml(unit.repeat(Math.ceil(5_000_000 / unit.length)));
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('is fast through cleanSummary and cleanTitle too', () => {
    const started = performance.now();
    cleanSummary('<'.repeat(5_000_000));
    cleanTitle('<'.repeat(5_000_000));
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('still gives the text of an ordinary long description', () => {
    expect(stripHtml(`<p>${'word '.repeat(100)}</p>`.repeat(3)).startsWith('word word')).toBe(true);
  });

  it('keeps a lone < that is not a tag', () => {
    expect(stripHtml('1 < 2 and <b>bold</b>')).toBe('1 < 2 and bold');
  });
});

describe('stripHtml and cleanTitle', () => {
  it('keeps the text, drops tags, scripts and extra whitespace', () => {
    expect(stripHtml('<p>One</p>\n<p>two &amp; <b>three</b></p><script>alert(1)</script>')).toBe(
      'One two & three',
    );
    expect(cleanTitle('  A\n  title  ')).toBe('A title');
  });
});

describe('cleanSummary', () => {
  it('drops the backlink WordPress adds, in Spanish and in English', () => {
    expect(
      cleanSummary(
        '<p>El resumen.</p>\n<p>La entrada <a href="x">Título</a> se publicó primero en <a href="y">Gigantes del Basket</a>.</p>',
      ),
    ).toBe('El resumen.');
    expect(cleanSummary('<p>Summary.</p><p>The post Title appeared first on Site.</p>')).toBe(
      'Summary.',
    );
  });

  it('is null when nothing is left', () => {
    expect(cleanSummary('  <p> </p> ')).toBeNull();
    expect(cleanSummary(undefined)).toBeNull();
    expect(cleanSummary(null)).toBeNull();
  });

  it('cuts long text at a word, with an ellipsis', () => {
    const summary = cleanSummary('word '.repeat(200))!;
    expect(summary.length).toBeLessThanOrEqual(281);
    expect(summary.endsWith('word…')).toBe(true);
  });
});

describe('normalizeUrl', () => {
  it('makes the same article the same address', () => {
    const plain = 'https://www.example.com/nba/story';
    for (const variant of [
      'https://WWW.example.com/nba/story/',
      'https://www.example.com/nba/story?utm_source=x&utm_medium=y',
      'https://www.example.com/nba/story#comments',
      '  https://www.example.com/nba/story  ',
    ]) {
      expect(normalizeUrl(variant)).toBe(plain);
    }
  });

  it('keeps the parameters that identify the page', () => {
    expect(normalizeUrl('https://x.com/watch?v=abc&utm_campaign=z')).toBe(
      'https://x.com/watch?v=abc',
    );
  });

  it('rejects what is not a web address', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeUrl('not a url')).toBeUndefined();
    expect(normalizeUrl('')).toBeUndefined();
  });
});

describe('isPublicHttpsUrl', () => {
  it('accepts https addresses with a public name', () => {
    expect(isPublicHttpsUrl('https://a.espncdn.com/photo/x.jpg')).toBe(true);
  });

  it.each([
    'http://a.espncdn.com/x.jpg',
    'https://localhost/x',
    'https://caddy/x',
    'https://step-back:3000/x',
    'https://127.0.0.1/x',
    'https://192.168.1.1/x',
    'https://[::1]/x',
    'https://printer.local/x',
    'https://localhost./x',
    'https://router.lan./x',
    'https://printer.local../x',
    'https://user:pass@a.example.com/x',
    'ftp://a.example.com/x',
    'nonsense',
  ])('refuses %s: the server must not be made to call inside the network', (url) => {
    expect(isPublicHttpsUrl(url)).toBe(false);
  });
});

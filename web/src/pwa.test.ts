// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// What Android needs to offer "Install app", checked against the real files in web/public.

const publicFile = (path: string) => new URL(`../public/${path}`, import.meta.url);
const read = (path: string) => readFileSync(publicFile(path), 'utf8');

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
const manifest = JSON.parse(read('manifest.webmanifest')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  lang: string;
  icons: Icon[];
};

/** Width and height written in a PNG header. */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(publicFile(path));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('manifest', () => {
  it('has the fields an installable app needs', () => {
    expect(manifest.name).toBe('step-back');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('es');
  });

  it('uses the app background colour, so the launch screen matches it', () => {
    expect(manifest.background_color).toBe('#0e1015');
    expect(manifest.theme_color).toBe('#0e1015');
  });

  it('has 192 and 512 px icons, and a maskable one', () => {
    const find = (size: string, purpose: string) =>
      manifest.icons.find((icon) => icon.sizes === size && icon.purpose === purpose);
    expect(find('192x192', 'any')).toBeDefined();
    expect(find('512x512', 'any')).toBeDefined();
    expect(find('512x512', 'maskable')).toBeDefined();
  });

  it('points every icon at a real PNG of the size it announces', () => {
    for (const icon of manifest.icons) {
      const path = icon.src.replace(/^\//, '');
      expect(existsSync(publicFile(path)), `${icon.src} exists`).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(path)).toEqual([w, h]);
      expect(icon.type).toBe('image/png');
    }
  });

  it('is in scope: the start page is inside it', () => {
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });
});

describe('index.html', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('links the manifest asking for credentials, because the site is behind a password', () => {
    expect(html).toMatch(
      /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials"/,
    );
  });

  it('links icons that exist', () => {
    const hrefs = [
      ...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g),
    ].map((match) => match[1]!);
    expect(hrefs.length).toBe(2);
    for (const href of hrefs) expect(existsSync(publicFile(href.replace(/^\//, '')))).toBe(true);
  });

  it('sets the theme colour of the browser bar', () => {
    expect(html).toContain('<meta name="theme-color" content="#0e1015"');
  });

  it('keeps the apple touch icon at 180 px', () => {
    expect(pngSize('icons/apple-touch-icon.png')).toEqual([180, 180]);
  });
});

describe('service worker', () => {
  it('exists and has a fetch handler, which Android requires to offer the install', () => {
    const worker = read('sw.js');
    expect(worker).toContain("addEventListener('fetch'");
  });

  it('caches nothing for now: that is T25', () => {
    expect(read('sw.js')).not.toMatch(/caches\./);
  });
});

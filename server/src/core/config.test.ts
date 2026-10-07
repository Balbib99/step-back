import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('.env.example', () => {
  it('is a valid configuration when copied as-is', () => {
    const example = parseEnv(
      readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8'),
    );
    expect(() => loadConfig(example)).not.toThrow();
  });
});

function problemsFor(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies the defaults from SPEC-core with an empty environment', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 3000,
      dbPath: './data/step-back.db',
      timeZone: 'Europe/Madrid',
      favoriteTeams: ['MIN', 'LAL', 'PHI'],
      deeplApiKey: undefined,
      vapid: undefined,
    });
  });

  it('parses and normalises the values it is given', () => {
    const config = loadConfig({
      PORT: '8080',
      FAVORITE_TEAMS: ' min, lal ',
      DEEPL_API_KEY: 'abc:fx',
    });
    expect(config.port).toBe(8080);
    expect(config.favoriteTeams).toEqual(['MIN', 'LAL']);
    expect(config.deeplApiKey).toBe('abc:fx');
  });

  it('treats empty optional variables as unset', () => {
    expect(loadConfig({ DEEPL_API_KEY: '' }).deeplApiKey).toBeUndefined();
  });

  it('names the variable when a value is invalid', () => {
    expect(problemsFor({ PORT: 'abc' })).toEqual([expect.stringMatching(/^PORT:/)]);
    expect(problemsFor({ TZ_DISPLAY: 'Mars/Olympus' })).toEqual([
      expect.stringMatching(/^TZ_DISPLAY:/),
    ]);
    expect(problemsFor({ FAVORITE_TEAMS: 'MIN,LA LAKERS' })).toEqual([
      expect.stringMatching(/^FAVORITE_TEAMS:/),
    ]);
  });

  it('reports every problem at once, not just the first', () => {
    const problems = problemsFor({ PORT: '0', LOG_LEVEL: 'loud' });
    expect(problems).toHaveLength(2);
  });

  it('requires all VAPID variables when any is set and names the missing ones', () => {
    const problems = problemsFor({ VAPID_PUBLIC_KEY: 'pub' });
    expect(problems).toEqual([
      expect.stringMatching(/^VAPID_PRIVATE_KEY:/),
      expect.stringMatching(/^VAPID_SUBJECT:/),
    ]);
  });

  it('enables push when the three VAPID variables are present', () => {
    const config = loadConfig({
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:me@example.com',
    });
    expect(config.vapid).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:me@example.com',
    });
  });

  it('never echoes secret values in the error message', () => {
    try {
      loadConfig({ PORT: 'abc', DEEPL_API_KEY: 'super-secret' });
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret');
    }
  });
});

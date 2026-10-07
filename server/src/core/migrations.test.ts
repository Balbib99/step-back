import { describe, expect, it } from 'vitest';
import { gamesModule } from '../modules/games/index.js';
import { highlightsModule } from '../modules/highlights/index.js';
import { newsModule } from '../modules/news/index.js';
import { standingsModule } from '../modules/standings/index.js';
import { translationModule } from '../modules/translation/index.js';
import { CORE_MIGRATIONS } from './core-migrations.js';
import { openDb } from './db.js';
import { runMigrations, type Migration } from './migrations.js';

const create = (id: number, table: string): Migration => ({
  id,
  name: table,
  sql: `CREATE TABLE ${table} (id INTEGER PRIMARY KEY);`,
});

const tables = (db: ReturnType<typeof openDb>) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);

describe('runMigrations', () => {
  it('applies the real core migrations and creates kv_cache and job_runs', () => {
    const db = openDb(':memory:');
    const applied = runMigrations(db, CORE_MIGRATIONS);
    expect(applied).toEqual([1]);
    expect(tables(db)).toEqual(expect.arrayContaining(['kv_cache', 'job_runs']));
  });

  it('is idempotent: a second run applies nothing', () => {
    const db = openDb(':memory:');
    const migrations = [create(1, 'a'), create(2, 'b')];
    expect(runMigrations(db, migrations)).toEqual([1, 2]);
    expect(runMigrations(db, migrations)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 2 });
  });

  it('applies only the new migrations when one is added later, in id order', () => {
    const db = openDb(':memory:');
    runMigrations(db, [create(1, 'a')]);
    expect(runMigrations(db, [create(3, 'c'), create(1, 'a'), create(2, 'b')])).toEqual([2, 3]);
  });

  it('rolls back a failing migration and does not record it', () => {
    const db = openDb(':memory:');
    const broken: Migration = {
      id: 2,
      name: 'broken',
      sql: 'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;',
    };
    expect(() => runMigrations(db, [create(1, 'a'), broken])).toThrow();
    expect(tables(db)).not.toContain('half');
    expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([{ id: 1 }]);
  });

  it('rejects duplicate ids before touching the database', () => {
    const db = openDb(':memory:');
    expect(() => runMigrations(db, [create(1, 'a'), create(1, 'b')])).toThrow(/Duplicate/);
    expect(tables(db)).not.toContain('a');
  });

  it('rejects an already applied migration whose SQL was edited', () => {
    const db = openDb(':memory:');
    runMigrations(db, [create(1, 'a')]);
    const edited = { ...create(1, 'a'), sql: 'CREATE TABLE a (id INTEGER, extra TEXT);' };
    expect(() => runMigrations(db, [edited])).toThrow(/modified after being applied/);
  });
});

describe('the migrations of the app', () => {
  const all = [
    ...CORE_MIGRATIONS,
    ...(gamesModule.migrations ?? []),
    ...(standingsModule.migrations ?? []),
    ...(newsModule.migrations ?? []),
    ...(highlightsModule.migrations ?? []),
    ...(translationModule.migrations ?? []),
  ];

  it('have unique ids, each module continuing after the previous one', () => {
    const ids = all.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('apply together on an empty database and leave every table in place', () => {
    const db = openDb(':memory:');
    expect(runMigrations(db, all)).toEqual(all.map((migration) => migration.id));
    expect(tables(db)).toEqual(
      expect.arrayContaining([
        'kv_cache',
        'job_runs',
        'teams',
        'games',
        'standings',
        'schema_migrations',
      ]),
    );
  });
});

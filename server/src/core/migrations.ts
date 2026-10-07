import { createHash } from 'node:crypto';
import type { Db } from './db.js';

/**
 * A schema change. Ids are global across modules (core 1, games 2, ...), so two modules cannot
 * pick the same one. Migrations are TypeScript constants rather than .sql files so that a
 * bundled build needs no files next to it.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Applies pending migrations in id order, each in its own transaction.
 * Safe to call on every start: applied migrations are skipped, and an applied migration
 * whose SQL has since been edited is rejected instead of silently diverging.
 * Returns the ids applied by this call.
 */
export function runMigrations(db: Db, migrations: Migration[]): number[] {
  const ids = new Set<number>();
  for (const migration of migrations) {
    if (ids.has(migration.id)) {
      throw new Error(`Duplicate migration id ${String(migration.id).padStart(4, '0')}`);
    }
    ids.add(migration.id);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      checksum   TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Map(
    db
      .prepare('SELECT id, checksum FROM schema_migrations')
      .all()
      .map((row) => {
        const { id, checksum: sum } = row as { id: number; checksum: string };
        return [id, sum] as const;
      }),
  );

  const record = db.prepare(
    'INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const appliedNow: number[] = [];

  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    const sum = checksum(migration.sql);
    const previous = applied.get(migration.id);
    if (previous !== undefined) {
      if (previous !== sum) {
        throw new Error(
          `Migration ${String(migration.id).padStart(4, '0')}_${migration.name} was modified after being applied`,
        );
      }
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, migration.name, sum, Date.now());
    })();
    appliedNow.push(migration.id);
  }

  return appliedNow;
}

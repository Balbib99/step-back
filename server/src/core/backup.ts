import { existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';

export interface BackupResult {
  tables: number;
}

/**
 * A consistent copy of a live SQLite database (SQLite's own online backup: safe while the app
 * is writing), checked before it is trusted. A copy that does not pass is deleted, so a file
 * that exists is a file that can be restored.
 */
export async function backupDatabase(source: string, destination: string): Promise<BackupResult> {
  if (source === ':memory:' || !existsSync(source)) {
    throw new Error(`there is no database at ${source}`);
  }
  if (existsSync(destination)) throw new Error(`${destination} already exists`);

  const db = new Database(source, { fileMustExist: true });
  try {
    await db.backup(destination);
  } catch (error) {
    rmSync(destination, { force: true });
    throw error;
  } finally {
    db.close();
  }

  const copy = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const verdict = copy.pragma('integrity_check', { simple: true });
    if (verdict !== 'ok') throw new Error(`the copy is damaged: ${String(verdict)}`);
    const { n } = copy
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get() as {
      n: number;
    };
    return { tables: n };
  } catch (error) {
    copy.close();
    rmSync(destination, { force: true });
    throw error;
  } finally {
    if (copy.open) copy.close();
  }
}

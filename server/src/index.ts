import { existsSync } from 'node:fs';
import { APP_NAME } from '@step-back/shared';
import { ConfigError, loadConfig } from './core/config.js';
import { openDb } from './core/db.js';
import { createLogger } from './core/logger.js';
import { CORE_MIGRATIONS_DIR, loadMigrationsFromDir, runMigrations } from './core/migrations.js';

if (existsSync('.env')) process.loadEnvFile('.env');

try {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = openDb(config.dbPath);
  const applied = runMigrations(db, loadMigrationsFromDir(CORE_MIGRATIONS_DIR));
  logger.info(
    { port: config.port, favorites: config.favoriteTeams, migrations: applied },
    `${APP_NAME} starting`,
  );
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

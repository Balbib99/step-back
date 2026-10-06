import { existsSync } from 'node:fs';
import { APP_NAME } from '@step-back/shared';
import { ConfigError, loadConfig } from './core/config.js';
import { createLogger } from './core/logger.js';

if (existsSync('.env')) process.loadEnvFile('.env');

try {
  const config = loadConfig();
  const logger = createLogger(config);
  logger.info({ port: config.port, favorites: config.favoriteTeams }, `${APP_NAME} starting`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

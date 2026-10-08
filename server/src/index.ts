import { existsSync } from 'node:fs';
import { APP_NAME } from '@step-back/shared';
import { buildApp } from './core/app.js';
import { backupDatabase } from './core/backup.js';
import { cleanupModule } from './core/cleanup.js';
import { ConfigError, loadConfig } from './core/config.js';
import { gamesModule } from './modules/games/index.js';
import { highlightsModule } from './modules/highlights/index.js';
import { newsModule } from './modules/news/index.js';
import { pushModule } from './modules/push/index.js';
import { standingsModule } from './modules/standings/index.js';
import { translationModule } from './modules/translation/index.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  const config = loadConfig();
  // Feature modules (games, news, ...) are added to this list as they are built.
  const { server, scheduler } = await buildApp({
    config,
    modules: [
      cleanupModule,
      gamesModule,
      standingsModule,
      newsModule,
      highlightsModule,
      translationModule,
      pushModule,
    ],
  });

  const shutdown = (signal: string) => {
    server.log.info({ signal }, 'shutting down');
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await server.listen({ host: config.host, port: config.port });
  scheduler.start();
  server.log.info({ favorites: config.favoriteTeams }, `${APP_NAME} ready`);
}

/**
 * `node server.mjs backup <file>`: a checked copy of the database, for deploy/backup.sh. It does
 * not start the server, so it can run next to the one that is running.
 */
async function backup(destination: string | undefined): Promise<void> {
  if (!destination) throw new Error('usage: node server.mjs backup <destination file>');
  const { tables } = await backupDatabase(loadConfig().dbPath, destination);
  console.log(`backup written to ${destination} (${tables} tables, integrity ok)`);
}

const command = process.argv[2] === 'backup' ? backup(process.argv[3]) : main();
command.catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else if (process.argv[2] === 'backup')
    console.error(error instanceof Error ? error.message : error);
  else console.error(error);
  process.exit(1);
});

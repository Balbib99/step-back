import { existsSync } from 'node:fs';
import { APP_NAME } from '@step-back/shared';
import { buildApp } from './core/app.js';
import { ConfigError, loadConfig } from './core/config.js';
import { gamesModule } from './modules/games/index.js';
import { newsModule } from './modules/news/index.js';
import { standingsModule } from './modules/standings/index.js';

if (existsSync('.env')) process.loadEnvFile('.env');

async function main(): Promise<void> {
  const config = loadConfig();
  // Feature modules (games, news, ...) are added to this list as they are built.
  const { server, scheduler } = await buildApp({
    config,
    modules: [gamesModule, standingsModule, newsModule],
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

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error(error);
  process.exit(1);
});

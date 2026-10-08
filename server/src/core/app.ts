import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { createKvCache } from './cache.js';
import type { Config } from './config.js';
import { openDb, type Db } from './db.js';
import { createHttpClient } from './http.js';
import { createJobRuns } from './job-runs.js';
import { createLogger, type Logger } from './logger.js';
import { CORE_MIGRATIONS } from './core-migrations.js';
import { runMigrations } from './migrations.js';
import type { AppModule, ModuleContext } from './modules.js';
import { registerCoreRoutes } from './routes.js';
import { registerSameOriginCheck } from './same-origin.js';
import { registerSecurityHeaders } from './security-headers.js';
import { createScheduler, type Scheduler } from './scheduler.js';
import { registerWeb, sendSinglePage, wantsSinglePage } from './web.js';

export interface BuildAppOptions {
  config: Config;
  modules?: AppModule[];
  logger?: Logger;
  /** Injectable so tests never touch the network. */
  fetch?: typeof fetch;
}

export interface App {
  server: FastifyInstance;
  scheduler: Scheduler;
  context: ModuleContext;
  db: Db;
}

const USER_AGENT = 'step-back/0.1 (personal NBA dashboard)';

export async function buildApp(options: BuildAppOptions): Promise<App> {
  const { config, modules = [] } = options;

  const moduleIds = modules.map((module) => module.id);
  const duplicate = moduleIds.find((id, index) => moduleIds.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate module id: ${duplicate}`);

  const logger = options.logger ?? createLogger(config);
  const db = openDb(config.dbPath);

  try {
    runMigrations(db, [
      ...CORE_MIGRATIONS,
      ...modules.flatMap((module) => module.migrations ?? []),
    ]);
  } catch (error) {
    db.close();
    throw error;
  }

  const jobRuns = createJobRuns(db);
  const context: ModuleContext = {
    config,
    logger,
    db,
    jobRuns,
    cache: createKvCache(db),
    http: createHttpClient({
      userAgent: USER_AGENT,
      ...(options.fetch && { fetch: options.fetch }),
    }),
  };
  const scheduler = createScheduler({ jobRuns, logger });

  const server: FastifyInstance = Fastify({
    loggerInstance: logger.child({ component: 'http' }) as FastifyBaseLogger,
  });

  registerSecurityHeaders(server);
  registerSameOriginCheck(server);

  const servesWeb = config.webDir !== undefined;
  server.setNotFoundHandler((request, reply) => {
    if (servesWeb && wantsSinglePage(request)) return sendSinglePage(reply);
    return reply.code(404).send({ error: 'not_found' });
  });
  server.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    // Never leak internals for server errors; client errors keep Fastify's own message.
    void reply.code(status).send({
      error: status >= 500 ? 'internal_error' : error.code,
      message: status >= 500 ? undefined : error.message,
    });
  });

  registerCoreRoutes(server, {
    context,
    moduleIds,
    scheduler,
    jobRuns,
    startedAt: Date.now(),
  });

  for (const module of modules) {
    const { routes, jobs } = module;
    if (routes) {
      await server.register(async (instance) => void (await routes(instance, context)), {
        prefix: '/api',
      });
    }
    for (const job of jobs?.(context) ?? []) scheduler.add(job);
  }

  if (config.webDir) {
    try {
      await registerWeb(server, config.webDir);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  server.addHook('onClose', async () => {
    await scheduler.stop();
    db.close();
  });

  return { server, scheduler, context, db };
}

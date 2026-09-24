import { buildApp } from './app';
import { bootstrap } from './bootstrap';
import { loadConfig } from './config';
import { runMigrations } from './db/client';

const config = loadConfig();
const app = await buildApp(config);

if (config.RUN_MIGRATIONS ?? true) {
  await runMigrations(app.db);
  app.log.info('database migrations applied');
}
await bootstrap(app);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: config.HOST, port: config.PORT });

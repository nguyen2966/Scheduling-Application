import { existsSync } from 'node:fs';
import { createApp } from './src/app.js';
import { loadConfig } from './src/config.js';
import { openDatabase, schemaVersion } from './src/db/connection.js';

let database;
try {
  const config = loadConfig();
  if (!existsSync(config.databasePath)) {
    throw new Error('Database not found. Run npm run db:setup before starting the app.');
  }
  database = openDatabase(config.databasePath);
  if (database.prepare('PRAGMA user_version').get().user_version !== schemaVersion) {
    throw new Error('Database schema is not initialized or supported. Run npm run db:setup against a fresh database.');
  }

  const app = createApp({ database, businessNow: () => new Date(config.referenceTime) });
  const server = app.listen(config.port, config.host);
  server.once('listening', () => {
    const address = server.address();
    const host = config.host.includes(':') ? `[${config.host}]` : config.host;
    console.log(`API listening at http://${host}:${address.port}/api/v1`);
  });
  server.once('error', (error) => {
    database.close();
    console.error(`Application startup failed: ${error.message}`);
    process.exitCode = 1;
  });

  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    server.close(() => database.close());
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  if (database?.isOpen) database.close();
  console.error(`Application startup failed: ${error.message}`);
  process.exitCode = 1;
}

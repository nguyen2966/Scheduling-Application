import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const seedDataDirectory = resolve(projectRoot, 'data');

// Resolve relative paths against the project, independent of the caller's cwd.
export function resolveDatabasePath(path = process.env.DATABASE_PATH) {
  return resolve(projectRoot, path || 'data/bright-path.sqlite');
}

export function loadConfig(environment = process.env) {
  const portText = environment.PORT ?? '3000';
  if (!/^\d+$/.test(portText) || Number(portText) > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  const host = environment.HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || host.trim() === '' || /\s/.test(host)) {
    throw new Error('HOST must be a nonblank hostname or IP address without spaces.');
  }
  return {
    port: Number(portText),
    host,
    databasePath: resolveDatabasePath(environment.DATABASE_PATH || 'data/bright-path.sqlite'),
    timeZone: 'Asia/Ho_Chi_Minh',
  };
}

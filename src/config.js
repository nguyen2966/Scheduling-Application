import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInstant } from './shared/calendar-date.js';

export const schedulingTimeZone = 'Asia/Ho_Chi_Minh';
export const defaultReferenceTime = '2026-03-03T06:00:00.000Z';
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
  const referenceTime = environment.REFERENCE_TIME ?? defaultReferenceTime;
  if (!isInstant(referenceTime)) {
    throw new Error('REFERENCE_TIME must be an ISO 8601 instant with an explicit timezone.');
  }
  return {
    port: Number(portText),
    host,
    databasePath: resolveDatabasePath(environment.DATABASE_PATH || 'data/bright-path.sqlite'),
    timeZone: schedulingTimeZone,
    referenceTime,
  };
}

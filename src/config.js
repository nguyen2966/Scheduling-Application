import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const seedDataDirectory = resolve(projectRoot, 'data');

// Resolve relative paths against the project, independent of the caller's cwd.
export function resolveDatabasePath(path = process.env.DATABASE_PATH) {
  return resolve(projectRoot, path || 'data/bright-path.sqlite');
}

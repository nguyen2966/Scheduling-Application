import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from '../config.js';

export const schemaVersion = 1;

export function openDatabase(path = resolveDatabasePath(), { readOnly = false } = {}) {
  const databasePath = path === ':memory:' ? path : resolveDatabasePath(path);
  if (!readOnly && databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath, { readOnly, timeout: 5000 });
  try {
    database.exec('PRAGMA foreign_keys = ON');
    if (database.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
      throw new Error('SQLite foreign key enforcement could not be enabled.');
    }
    if (database.prepare("SELECT json_valid('{}') AS supported").get().supported !== 1) {
      throw new Error('This SQLite build must support JSON functions.');
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

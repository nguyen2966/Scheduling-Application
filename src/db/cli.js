import { parseArgs } from 'node:util';
import { resolveDatabasePath } from '../config.js';
import { openDatabase } from './connection.js';
import { setupDatabase } from './import-seed.js';
import { verifySeedDatabase } from './verify-seed.js';

let database;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { db: { type: 'string' } },
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !['setup', 'verify'].includes(command)) {
    throw new Error('Usage: npm run db:setup -- [--db path.sqlite] or npm run db:verify -- [--db path.sqlite]');
  }
  if (values.db === '') throw new Error('--db requires a nonempty database path.');
  const path = resolveDatabasePath(values.db);
  database = openDatabase(path, { readOnly: command === 'verify' });
  const counts = command === 'setup' ? setupDatabase(database) : verifySeedDatabase(database);
  console.log(`${command === 'setup' ? 'Imported seed data into' : 'Verified seed baseline in'} ${path}`);
  console.log(JSON.stringify(counts, null, 2));
} catch (error) {
  console.error(`Database command failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  database?.close();
}

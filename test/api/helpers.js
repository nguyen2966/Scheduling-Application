import { once } from 'node:events';
import { openDatabase } from '../../src/db/connection.js';
import { setupDatabase } from '../../src/db/import-seed.js';

export const roomItems = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map((room_id) => ({ room_id }));
export const responseTime = '2026-03-03T06:00:00.000Z';
export const now = () => new Date(responseTime);

export function responseDouble() {
  return {
    headers: {},
    status(value) { this.statusCode = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; },
  };
}

export function seededDatabase(t) {
  const database = openDatabase(':memory:');
  t.after(() => { if (database.isOpen) database.close(); });
  setupDatabase(database, { now });
  return database;
}

export async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

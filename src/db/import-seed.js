import { readFileSync } from 'node:fs';
import { schemaVersion } from './connection.js';
import { loadSeedData } from './seed-data.js';

function initializeSchema(database) {
  const version = database.prepare('PRAGMA user_version').get().user_version;
  if (version === schemaVersion) return;
  if (version !== 0) throw new Error(`Unsupported database schema version ${version}.`);
  const existingTable = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
  ).get();
  if (existingTable) throw new Error('Refusing to initialize an unrecognized nonempty database.');
  database.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  database.exec(`PRAGMA user_version = ${schemaVersion}`);
}

// This is an explicit seed-only operation, never an application-startup hook.
export function setupDatabase(database, { dataDirectory, now = () => new Date() } = {}) {
  const seed = loadSeedData(dataDirectory);
  const importedAt = now().toISOString();

  database.exec('BEGIN IMMEDIATE');
  try {
    initializeSchema(database);
    for (const table of ['bookings', 'booking_changes', 'tutors', 'rooms']) {
      if (database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count > 0) {
        throw new Error(`Refusing to import: ${table} already contains data. Choose a new database path; existing records were not overwritten.`);
      }
    }

    const insertTutor = database.prepare(
      'INSERT INTO tutors (tutor_id, tutor_name, subject, phone) VALUES (?, ?, ?, ?)',
    );
    for (const tutor of seed.tutors) {
      insertTutor.run(tutor.tutor_id, tutor.tutor_name, tutor.subject, tutor.phone);
    }
    const insertRoom = database.prepare('INSERT INTO rooms (room_id) VALUES (?)');
    for (const room of seed.rooms) insertRoom.run(room);

    const insertBooking = database.prepare(`
      INSERT INTO bookings (lesson_id, date, start_time, duration_min, student,
        tutor_id, room, status, cancelled_at, note, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertHistory = database.prepare(`
      INSERT INTO booking_changes
        (lesson_id, action, changed_at, before_snapshot, after_snapshot,
         reason, needs_manual_communication)
      VALUES (?, 'imported', ?, NULL, ?, NULL, NULL)
    `);
    for (const booking of seed.bookings) {
      try {
        insertBooking.run(booking.lesson_id, booking.date, booking.start_time,
          booking.duration_min, booking.student, booking.tutor_id, booking.room,
          booking.status, booking.cancelled_at, booking.note, booking.version);
        insertHistory.run(booking.lesson_id, importedAt, JSON.stringify(booking));
      } catch (error) {
        throw new Error(`Cannot import lesson ${booking.lesson_id}: ${error.message}`, { cause: error });
      }
    }
    database.exec('COMMIT');
    return { tutors: seed.tutors.length, rooms: seed.rooms.length,
      bookings: seed.bookings.length, booking_changes: seed.bookings.length };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
